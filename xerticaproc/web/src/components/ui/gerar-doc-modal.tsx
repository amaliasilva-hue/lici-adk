"use client";
import * as React from "react";
import { X, FileText, Download, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useGenerateDocument } from "@/hooks/useReadiness";
import type { DocType, DocumentReadiness } from "@/lib/copilot/types";

interface Props {
  open: boolean;
  onClose: () => void;
  contratacaoId: string;
  docType?: DocType;
  initialReadiness?: DocumentReadiness | null;
}

export function GerarDocModal({
  open,
  onClose,
  contratacaoId,
  docType = "etp",
  initialReadiness = null,
}: Props) {
  const { pending, error, readinessFail, doc, generate, reset } =
    useGenerateDocument();

  React.useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  if (!open) return null;

  const blocking = readinessFail?.blocking_missing ?? initialReadiness?.blocking_missing ?? [];
  const orgaoOpen =
    readinessFail?.open_fields_for_orgao ?? initialReadiness?.open_fields_for_orgao ?? [];
  const score = readinessFail?.score ?? initialReadiness?.score ?? 0;
  const canGen = (initialReadiness?.can_generate ?? false) && !readinessFail;

  const downloadMd = () => {
    if (!doc) return;
    const blob = new Blob([doc.content_md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.doc_type}-v${doc.versao}-${doc.contratacao_id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-x-line bg-x-bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-x-line px-5 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-x-cyan-400" />
            <h2 className="font-display text-lg">
              Gerar {docType.toUpperCase()}
            </h2>
            {doc && <Chip tone="green">v{doc.versao}</Chip>}
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-x-ink-mute hover:text-x-ink"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Estado: documento gerado */}
          {doc && (
            <>
              <div className="flex items-center gap-2 text-sm text-x-ink-mute">
                <span>Score: <strong className="text-x-ink">{(doc.readiness_snapshot.score * 100).toFixed(0)}%</strong></span>
                <span>·</span>
                <span>{doc.readiness_snapshot.open_fields_for_orgao.length} placeholder(s) institucional(is)</span>
              </div>
              <pre className="whitespace-pre-wrap rounded-lg border border-x-line bg-black/40 p-4 text-xs leading-relaxed text-x-ink">
                {doc.content_md}
              </pre>
            </>
          )}

          {/* Estado: bloqueado (422 ou initial readiness com bloqueantes) */}
          {!doc && (blocking.length > 0 || readinessFail) && (
            <>
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-400" />
                <div>
                  <div className="font-medium text-amber-200">
                    Faltam {blocking.length} item(ns) bloqueante(s) para gerar o {docType.toUpperCase()}.
                  </div>
                  <div className="text-xs text-x-ink-mute">
                    Score atual: {(score * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-xs uppercase tracking-wider text-x-ink-mute">
                  Itens bloqueantes
                </h3>
                <ul className="space-y-1.5">
                  {blocking.map((m) => (
                    <li
                      key={m.item_key}
                      className="rounded border border-x-line px-3 py-1.5 text-sm"
                    >
                      <div>{m.label}</div>
                      <div className="text-[11px] text-x-ink-mute">
                        {m.item_key} · owner: {m.owner}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {/* Estado: pronto para gerar */}
          {!doc && blocking.length === 0 && !readinessFail && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              Pronto para gerar. Score:{" "}
              <strong>{(score * 100).toFixed(0)}%</strong>
              {orgaoOpen.length > 0 && (
                <div className="mt-1 text-xs text-x-ink-mute">
                  {orgaoOpen.length} campo(s) institucional(is) ficarão como placeholders no documento (responsabilidade do órgão).
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
              Erro: {error}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-x-line px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          {!doc && (
            <Button
              variant="primary"
              loading={pending}
              disabled={blocking.length > 0 && !canGen}
              onClick={() => void generate(contratacaoId, docType)}
            >
              Gerar agora
            </Button>
          )}
          {doc && (
            <Button variant="primary" onClick={downloadMd}>
              <Download className="h-4 w-4" />
              Baixar .md
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
