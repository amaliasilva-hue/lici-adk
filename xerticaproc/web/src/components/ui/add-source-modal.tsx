"use client";
import * as React from "react";
import { Link2, FileText, Upload, Image as ImageIcon, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import type { FonteUsuarioIn } from "@/lib/copilot/types";

type Tab = "url" | "texto_colado" | "arquivo" | "print";

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "url",          label: "URL",     icon: Link2 },
  { id: "texto_colado", label: "Texto",   icon: FileText },
  { id: "arquivo",      label: "Arquivo", icon: Upload },
  { id: "print",        label: "Print",   icon: ImageIcon },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: FonteUsuarioIn) => Promise<void> | void;
}

export function AddSourceModal({ open, onClose, onSubmit }: Props) {
  const [tab, setTab] = React.useState<Tab>("url");
  const [url, setUrl] = React.useState("");
  const [texto, setTexto] = React.useState("");
  const [gcsUri, setGcsUri] = React.useState("");
  const [produto, setProduto] = React.useState("");
  const [observacao, setObservacao] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setUrl(""); setTexto(""); setGcsUri(""); setProduto("");
      setObservacao(""); setTab("url"); setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const canSubmit =
    (tab === "url" && url.trim().length > 0) ||
    (tab === "texto_colado" && texto.trim().length > 0) ||
    ((tab === "arquivo" || tab === "print") && gcsUri.trim().length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      await onSubmit({
        tipo: tab,
        url: tab === "url" ? url : undefined,
        texto_colado: tab === "texto_colado" ? texto : undefined,
        arquivo_gcs_uri:
          tab === "arquivo" || tab === "print" ? gcsUri : undefined,
        produto: produto || undefined,
        observacao: observacao || undefined,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-x-ink">
            Adicionar fonte de preço
          </h3>
          <button
            onClick={onClose}
            className="text-x-ink-mute hover:text-x-ink"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 flex gap-1 border-b border-x-line/60 pb-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === id
                  ? "bg-x-cyan/15 text-x-cyan-glow"
                  : "text-x-ink-dim hover:text-x-ink hover:bg-x-line/30",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {tab === "url" && (
            <div>
              <label className="text-xs text-x-ink-dim">URL (PNCP, Compras.gov, *.gov.br)</label>
              <input
                className="input mt-1"
                placeholder="https://pncp.gov.br/app/contratos/..."
                value={url}
                onChange={e => setUrl(e.target.value)}
                autoFocus
              />
            </div>
          )}
          {tab === "texto_colado" && (
            <div>
              <label className="text-xs text-x-ink-dim">Texto da fonte</label>
              <textarea
                className="textarea mt-1 min-h-[140px]"
                placeholder="Cole aqui o texto do contrato/ata/proposta…"
                value={texto}
                onChange={e => setTexto(e.target.value)}
                autoFocus
              />
            </div>
          )}
          {(tab === "arquivo" || tab === "print") && (
            <div>
              <label className="text-xs text-x-ink-dim">
                {tab === "arquivo" ? "URI GCS do PDF" : "URI GCS da imagem"}
              </label>
              <input
                className="input mt-1"
                placeholder="gs://xerticaproc-uploads/..."
                value={gcsUri}
                onChange={e => setGcsUri(e.target.value)}
                autoFocus
              />
              <p className="mt-1 text-[11px] text-x-ink-mute">
                Upload direto via UI será adicionado em sprint posterior.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs text-x-ink-dim">Produto (opcional)</label>
            <input
              className="input mt-1"
              placeholder="Ex.: Gemini Enterprise Plus"
              value={produto}
              onChange={e => setProduto(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-x-ink-dim">Observação (opcional)</label>
            <input
              className="input mt-1"
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={busy} disabled={!canSubmit}>
              Adicionar fonte
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
