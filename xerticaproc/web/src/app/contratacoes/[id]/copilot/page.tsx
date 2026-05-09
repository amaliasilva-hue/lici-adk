"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ChatBubble } from "@/components/ui/chat-bubble";
import { ChecklistItemRow } from "@/components/ui/checklist-item";
import { Chip } from "@/components/ui/chip";
import { AddSourceModal } from "@/components/ui/add-source-modal";
import { GerarDocModal } from "@/components/ui/gerar-doc-modal";
import { SourceCard } from "@/components/ui/source-card";
import { useChatStream } from "@/hooks/useChatStream";
import { useChecklist } from "@/hooks/useChecklist";
import { useReadiness } from "@/hooks/useReadiness";
import { useNegativeSearches, useSources } from "@/hooks/useSources";
import type { ChecklistItem, FonteUsuarioIn } from "@/lib/copilot/types";

export default function CopilotWorkspacePage() {
  const params = useParams<{ id: string }>();
  const contratacaoId = params?.id ?? "";

  const checklist = useChecklist(contratacaoId);
  const sources = useSources(contratacaoId);
  const negatives = useNegativeSearches(contratacaoId);
  const readiness = useReadiness(contratacaoId, "etp");
  const chat = useChatStream(contratacaoId, {
    onChecklistUpdated: () => {
      checklist.refresh();
      readiness.refresh();
    },
    onPriceSourcesAdded: () => sources.mutate(),
  });

  const [input, setInput] = React.useState("");
  const [showAddSource, setShowAddSource] = React.useState(false);
  const [showGerarEtp, setShowGerarEtp] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat.messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    setInput("");
    void chat.send(t);
  };

  const handleConfirm = (it: ChecklistItem) =>
    void checklist.patch(it.item_key, { status: "confirmado" });
  const handleDispensar = (it: ChecklistItem) => {
    const just = window.prompt(`Justificativa para dispensar "${it.label}":`);
    if (!just) return;
    void checklist.patch(it.item_key, { status: "dispensado", justificativa: just });
  };
  const handlePergunte = (it: ChecklistItem) =>
    void chat.send(`Me pergunte sobre: ${it.label}`);

  const handleAddSource = async (payload: FonteUsuarioIn) => {
    await sources.add(payload);
  };

  const summary = checklist.data?.summary;
  const grouped = checklist.data?.by_category ?? {};
  const sourceList = sources.data ?? [];
  const negList = negatives.data ?? [];

  return (
    <>
      <div className="grid h-screen grid-cols-[300px_1fr_340px] gap-4 p-4">
        <aside className="min-h-0 overflow-y-auto pr-1">
          <Card className="mb-3">
            <CardHeader>
              <CardTitle>Checklist</CardTitle>
              {summary && (
                <span className="text-xs text-x-ink-mute">
                  {summary.confirmado}/{summary.total}
                </span>
              )}
            </CardHeader>
            {summary && (
              <div className="flex flex-wrap gap-1">
                <Chip tone="green">{summary.confirmado} ok</Chip>
                <Chip tone="amber">{summary.inferido} inferidos</Chip>
                <Chip tone="mute">{summary.pendente} pendentes</Chip>
                {summary.bloqueante_pendente > 0 && (
                  <Chip tone="red">{summary.bloqueante_pendente} bloq</Chip>
                )}
              </div>
            )}
          </Card>

          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} className="mb-4">
              <h4 className="px-2 mb-2 font-display text-[11px] uppercase tracking-wider text-x-ink-mute">
                {cat}
              </h4>
              <ul className="space-y-1.5">
                {items.map((it) => (
                  <ChecklistItemRow
                    key={it.item_key}
                    item={it}
                    onConfirm={handleConfirm}
                    onDispensar={handleDispensar}
                    onPergunte={handlePergunte}
                  />
                ))}
              </ul>
            </div>
          ))}
          {checklist.isLoading && (
            <div className="text-sm text-x-ink-mute">Carregando checklist...</div>
          )}
        </aside>

        <main className="flex min-h-0 flex-col">
          <Card className="mb-3">
            <CardHeader>
              <CardTitle>Copiloto - Contratacao {contratacaoId}</CardTitle>
              <div className="flex items-center gap-1.5">
                <Chip tone="cyan">conversacao</Chip>
                {readiness.data && (
                  <Chip
                    tone={readiness.data.can_generate ? "green" : "amber"}
                    title={readiness.data.recommendations ?? undefined}
                  >
                    ETP {Math.round(readiness.data.score * 100)}%
                    {readiness.data.blocking_missing.length > 0
                      ? ` · ${readiness.data.blocking_missing.length} bloq`
                      : " · pronto"}
                  </Chip>
                )}
              </div>
            </CardHeader>
          </Card>

          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
            {chat.messages.map((m) => (
              <ChatBubble
                key={m.id}
                role={m.role}
                pending={chat.pending && m.role === "assistant" && m.id.startsWith("local-asst-")}
              >
                {m.conteudo || (m.role === "assistant" ? " " : "")}
              </ChatBubble>
            ))}
            {chat.error && <div className="text-xs text-red-300">Erro: {chat.error}</div>}
            {chat.suggestedActions.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {chat.suggestedActions.map((a, i) => (
                  <Button key={i} size="sm" variant="outline" onClick={() => chat.send(a.command)}>
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
            <textarea
              className="textarea flex-1"
              placeholder="Descreva o que precisa contratar, faca perguntas ou cole uma URL de preco..."
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
            />
            <Button type="submit" loading={chat.pending} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
              Enviar
            </Button>
          </form>
        </main>

        <aside className="min-h-0 overflow-y-auto space-y-3 pl-1">
          <Card>
            <CardHeader><CardTitle>Atalhos</CardTitle></CardHeader>
            <div className="flex flex-col gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowGerarEtp(true)}>
                Gerar ETP
              </Button>
              <Button variant="outline" size="sm" onClick={() => chat.send("Quais itens ainda faltam para emitir o TR?")}>
                O que falta para o TR?
              </Button>
              <Button variant="outline" size="sm" onClick={() => chat.send("Mostre o mapa de precos atual")}>
                Mapa de precos
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fontes de preco</CardTitle>
              <Button size="sm" variant="primary" onClick={() => setShowAddSource(true)}>
                <Plus className="h-3.5 w-3.5" />
                Nova
              </Button>
            </CardHeader>
            {sourceList.length === 0 ? (
              <p className="text-xs text-x-ink-mute">
                Nenhuma fonte ainda. Clique em <strong>Nova</strong> ou cole uma URL no chat.
              </p>
            ) : (
              <div className="space-y-2">
                {sourceList.map((s) => (
                  <SourceCard
                    key={s.id}
                    source={s}
                    onDiscard={() => sources.update(s.id, { status: "descartada" })}
                  />
                ))}
              </div>
            )}
          </Card>

          {negList.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Buscas negativas</CardTitle>
                <Chip tone="amber">{negList.length}</Chip>
              </CardHeader>
              <ul className="space-y-1.5">
                {negList.map((n) => (
                  <li key={n.id} className="card-tight text-xs">
                    <div className="text-x-ink">{n.termo}</div>
                    <div className="text-[11px] text-x-ink-mute">
                      {n.fontes_consultadas.join(", ")}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <AddSourceModal
        open={showAddSource}
        onClose={() => setShowAddSource(false)}
        onSubmit={handleAddSource}
      />
      <GerarDocModal
        open={showGerarEtp}
        onClose={() => {
          setShowGerarEtp(false);
          readiness.refresh();
          checklist.refresh();
        }}
        contratacaoId={contratacaoId}
        docType="etp"
        initialReadiness={readiness.data ?? null}
      />
    </>
  );
}
