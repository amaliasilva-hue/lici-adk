"use client";
import * as React from "react";
import { useParams } from "next/navigation";
import { Paperclip, Plus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { ChatBubble } from "@/components/ui/chat-bubble";
import { ChecklistItemRow } from "@/components/ui/checklist-item";
import { Chip } from "@/components/ui/chip";
import { AddSourceModal } from "@/components/ui/add-source-modal";
import { GerarDocModal } from "@/components/ui/gerar-doc-modal";
import { NotificationBell } from "@/components/ui/notification-bell";
import { SourceCard } from "@/components/ui/source-card";
import { useChatStream } from "@/hooks/useChatStream";
import { useChecklist } from "@/hooks/useChecklist";
import { useReadiness } from "@/hooks/useReadiness";
import { useNegativeSearches, useSources } from "@/hooks/useSources";
import { getRevisorReport, pacoteEvidenciasUrl, uploadAnexo } from "@/lib/copilot/api";
import { useAuth } from "@/lib/auth-context";
import { AuthGate } from "@/app/auth-gate";
import type {
  Anexo,
  ChecklistItem,
  DocType,
  FonteUsuarioIn,
  RevisorReport,
} from "@/lib/copilot/types";

function CopilotWorkspacPageContent() {
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
  const [pendingAnexos, setPendingAnexos] = React.useState<Anexo[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showAddSource, setShowAddSource] = React.useState(false);
  const [gerarDocType, setGerarDocType] = React.useState<DocType | null>(null);
  const [revisor, setRevisor] = React.useState<RevisorReport | null>(null);
  const [revisorPending, setRevisorPending] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const handleRevisar = async () => {
    setRevisorPending(true);
    try {
      setRevisor(await getRevisorReport(contratacaoId));
    } catch (e) {
      console.error(e);
    } finally {
      setRevisorPending(false);
    }
  };

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [chat.messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t && pendingAnexos.length === 0) return;
    setInput("");
    const anexosToSend = pendingAnexos;
    setPendingAnexos([]);
    void chat.send(t || "(arquivos anexados)", anexosToSend);
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: Anexo[] = [];
      for (const f of files) {
        try {
          const a = await uploadAnexo(contratacaoId, f);
          uploaded.push(a);
        } catch (err) {
          console.error("upload falhou", f.name, err);
        }
      }
      setPendingAnexos((prev) => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
    }
  };

  const removePendingAnexo = (idx: number) =>
    setPendingAnexos((prev) => prev.filter((_, i) => i !== idx));

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
                <NotificationBell contratacaoId={contratacaoId} />
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

          <form onSubmit={handleSubmit} className="mt-3 flex flex-col gap-2">
            {pendingAnexos.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pendingAnexos.map((a, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-md bg-x-bg-2 px-2 py-1 text-xs text-x-ink"
                  >
                    <Paperclip className="h-3 w-3" />
                    {a.nome}
                    <button
                      type="button"
                      onClick={() => removePendingAnexo(i)}
                      className="text-x-ink-mute hover:text-x-ink"
                      aria-label="Remover anexo"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.csv,.txt,.md"
                className="hidden"
                onChange={handleFilePick}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={uploading}
                onClick={() => fileInputRef.current?.click()}
                title="Anexar arquivo (PDF, imagem, DOCX, XLSX)"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <textarea
                className="textarea flex-1"
                placeholder="Descreva o que precisa contratar, faca perguntas, cole uma URL de preco ou anexe documentos..."
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
              <Button
                type="submit"
                loading={chat.pending}
                disabled={!input.trim() && pendingAnexos.length === 0}
              >
                <Send className="h-4 w-4" />
                Enviar
              </Button>
            </div>
          </form>
        </main>

        <aside className="min-h-0 overflow-y-auto space-y-3 pl-1">
          <Card>
            <CardHeader><CardTitle>Atalhos</CardTitle></CardHeader>
            <div className="flex flex-col gap-2">
              <Button variant="outline" size="sm" onClick={() => setGerarDocType("etp")}>
                Gerar ETP
              </Button>
              <Button variant="outline" size="sm" onClick={() => setGerarDocType("tr")}>
                Gerar TR
              </Button>
              <Button variant="outline" size="sm" onClick={() => setGerarDocType("mapa_precos")}>
                Gerar Mapa de Preços
              </Button>
              <a
                href={pacoteEvidenciasUrl(contratacaoId)}
                target="_blank"
                rel="noreferrer"
                className="btn-outline px-2.5 py-1 text-xs text-center"
              >
                Baixar pacote (.zip)
              </a>
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Revisor</CardTitle>
              <Button size="sm" variant="ghost" loading={revisorPending} onClick={handleRevisar}>
                Rodar
              </Button>
            </CardHeader>
            {revisor ? (
              <>
                <div className="flex flex-wrap gap-1 mb-2">
                  <Chip tone="red">{revisor.summary.error} erro</Chip>
                  <Chip tone="amber">{revisor.summary.warn} alerta</Chip>
                  <Chip tone="mute">{revisor.summary.info} info</Chip>
                </div>
                {revisor.findings.length === 0 ? (
                  <p className="text-xs text-x-ink-mute">Sem achados — tudo limpo.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {revisor.findings.map((f) => (
                      <li key={f.code} className="card-tight text-xs">
                        <div className="flex items-center gap-1">
                          <Chip tone={f.severity === "error" ? "red" : f.severity === "warn" ? "amber" : "mute"}>
                            {f.code}
                          </Chip>
                          <span className="font-medium">{f.title}</span>
                        </div>
                        <div className="text-[11px] text-x-ink-mute mt-0.5">{f.detail}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-xs text-x-ink-mute">Clique em <strong>Rodar</strong> para checar coerência entre documentos, fontes e checklist.</p>
            )}
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
        open={gerarDocType !== null}
        onClose={() => {
          setGerarDocType(null);
          readiness.refresh();
          checklist.refresh();
        }}
        contratacaoId={contratacaoId}
        docType={gerarDocType ?? "etp"}
        initialReadiness={gerarDocType === "etp" ? readiness.data ?? null : null}
      />
    </>
  );
}

export default function CopilotWorkspacePage() {
  return (
    <AuthGate>
      <CopilotWorkspacPageContent />
    </AuthGate>
  );
}
