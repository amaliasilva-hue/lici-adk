"use client";
import * as React from "react";
import { Eye, FileText, Image as ImageIcon, RefreshCw, Trash2, X } from "lucide-react";
import {
  bibliotecaConteudoUrl,
  bibliotecaThumbUrl,
  deleteBibliotecaDoc,
  listBiblioteca,
  reindexBibliotecaDoc,
} from "@/lib/copilot/api";
import { buildApiHeaders } from "@/lib/api";
import type { Documento, DocumentoStatus } from "@/lib/copilot/types";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";

const statusToTone: Record<DocumentoStatus, "amber" | "green" | "red" | "mute"> = {
  processando: "amber",
  pronto: "green",
  falhou: "red",
  arquivado: "mute",
};

function fmtSize(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function isPdf(d: Documento) {
  return d.mime === "application/pdf";
}
function isImage(d: Documento) {
  return d.mime.startsWith("image/");
}

export function BibliotecaPanel({ contratacaoId }: { contratacaoId: string }) {
  const [items, setItems] = React.useState<Documento[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [viewer, setViewer] = React.useState<Documento | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await listBiblioteca(contratacaoId, { limit: 100 });
      setItems(r.items);
    } catch (e) {
      console.error("listBiblioteca falhou", e);
    } finally {
      setLoading(false);
    }
  }, [contratacaoId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-refresh enquanto há item processando
  React.useEffect(() => {
    const hasProcessing = items.some((d) => d.status === "processando");
    if (!hasProcessing) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [items, refresh]);

  const handleDelete = async (d: Documento) => {
    if (!confirm(`Remover "${d.nome}" da biblioteca?`)) return;
    try {
      await deleteBibliotecaDoc(contratacaoId, d.id);
      setItems((prev) => prev.filter((x) => x.id !== d.id));
    } catch (e) {
      console.error(e);
      alert("Falha ao remover");
    }
  };

  const handleReindex = async (d: Documento) => {
    try {
      await reindexBibliotecaDoc(contratacaoId, d.id);
      void refresh();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Biblioteca</CardTitle>
          <span className="text-xs text-x-ink-mute">
            {items.length} {items.length === 1 ? "documento" : "documentos"}
          </span>
        </CardHeader>

        {loading && items.length === 0 && (
          <div className="text-sm text-x-ink-mute px-2 py-4">Carregando…</div>
        )}
        {!loading && items.length === 0 && (
          <div className="text-sm text-x-ink-mute px-2 py-4">
            Nenhum documento ainda. Anexe arquivos no chat (📎) — eles aparecerão aqui.
          </div>
        )}

        <ul className="space-y-2">
          {items.map((d) => (
            <li
              key={d.id}
              className="card-tight flex gap-2 items-start group"
            >
              {/* thumb */}
              <BibliotecaThumb d={d} contratacaoId={contratacaoId} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-1">
                  <div className="text-[13px] text-x-ink truncate font-medium">
                    {d.nome}
                  </div>
                  <Chip tone={statusToTone[d.status]}>
                    {d.status === "processando" ? "processando…" : d.status}
                  </Chip>
                </div>
                <div className="text-[11px] text-x-ink-mute mt-0.5">
                  {d.pages ? `${d.pages} pág · ` : ""}{fmtSize(d.bytes_size)}
                  {d.mime && ` · ${shortMime(d.mime)}`}
                </div>
                <div className="flex gap-1 mt-1.5 opacity-80">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewer(d)}
                    disabled={d.status !== "pronto" && !isImage(d) && !isPdf(d)}
                    title="Visualizar"
                  >
                    <Eye className="h-3 w-3" /> Ver
                  </Button>
                  {d.status === "falhou" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleReindex(d)}
                      title="Reprocessar"
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(d)}
                    title="Remover"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {viewer && (
        <DocumentViewer
          documento={viewer}
          contratacaoId={contratacaoId}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}

function shortMime(mime: string): string {
  if (mime === "application/pdf") return "PDF";
  if (mime.startsWith("image/")) return mime.slice(6).toUpperCase();
  if (mime.includes("wordprocessingml")) return "DOCX";
  if (mime.includes("spreadsheetml")) return "XLSX";
  if (mime.startsWith("text/")) return "TXT";
  return mime.split("/")[1]?.toUpperCase() ?? mime;
}

// ── Thumb (busca via authFetch e expõe blob URL) ─────────────────────────
function BibliotecaThumb({
  d,
  contratacaoId,
}: {
  d: Documento;
  contratacaoId: string;
}) {
  const [src, setSrc] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!d.thumb_uri) return;
    let revoked = false;
    let url: string | null = null;
    (async () => {
      try {
        const headers = await buildApiHeaders(undefined, { contentType: null });
        const r = await fetch(bibliotecaThumbUrl(contratacaoId, d.id), { headers });
        if (!r.ok) return;
        const blob = await r.blob();
        url = URL.createObjectURL(blob);
        if (!revoked) setSrc(url);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [d.id, d.thumb_uri, contratacaoId]);

  return (
    <div className="h-12 w-12 rounded bg-x-bg-elev/60 grid place-items-center overflow-hidden flex-shrink-0">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={d.nome} className="object-cover h-full w-full" />
      ) : isImage(d) ? (
        <ImageIcon className="h-5 w-5 text-x-ink-mute" />
      ) : (
        <FileText className="h-5 w-5 text-x-ink-mute" />
      )}
    </div>
  );
}

// ── Viewer modal (PDF/imagem via blob URL autenticado) ───────────────────
function DocumentViewer({
  documento,
  contratacaoId,
  onClose,
}: {
  documento: Documento;
  contratacaoId: string;
  onClose: () => void;
}) {
  const [src, setSrc] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let revoked = false;
    let url: string | null = null;
    (async () => {
      try {
        const headers = await buildApiHeaders(undefined, { contentType: null });
        const r = await fetch(
          bibliotecaConteudoUrl(contratacaoId, documento.id),
          { headers },
        );
        if (!r.ok) {
          setError(`Falha (${r.status})`);
          return;
        }
        const blob = await r.blob();
        url = URL.createObjectURL(blob);
        if (!revoked) setSrc(url);
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [contratacaoId, documento.id]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-x-bg-elev rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-x-line">
          <div className="min-w-0">
            <div className="text-sm text-x-ink truncate">{documento.nome}</div>
            <div className="text-[11px] text-x-ink-mute">
              {shortMime(documento.mime)}
              {documento.pages ? ` · ${documento.pages} pág` : ""}
              {` · ${fmtSize(documento.bytes_size)}`}
            </div>
          </div>
          <div className="flex gap-2 items-center">
            {src && (
              <a
                href={src}
                download={documento.nome}
                className="text-xs text-x-cyan-glow hover:underline"
              >
                baixar
              </a>
            )}
            <button
              className="rounded p-1 hover:bg-x-bg-deep"
              onClick={onClose}
              aria-label="fechar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-x-bg-deep">
          {error && (
            <div className="p-6 text-sm text-x-red-glow">Erro carregando: {error}</div>
          )}
          {!src && !error && (
            <div className="p-6 text-sm text-x-ink-mute">Carregando documento…</div>
          )}
          {src && isPdf(documento) && (
            <iframe
              src={src}
              className="w-full h-full"
              title={documento.nome}
            />
          )}
          {src && isImage(documento) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={documento.nome}
              className="max-w-full max-h-full mx-auto"
            />
          )}
          {src && !isPdf(documento) && !isImage(documento) && (
            <div className="p-6 text-sm text-x-ink-mute">
              Pré-visualização indisponível para este formato.
              {documento.text_excerpt && (
                <pre className="mt-4 whitespace-pre-wrap text-[12px] text-x-ink bg-x-bg-elev p-3 rounded max-h-[60vh] overflow-auto">
                  {documento.text_excerpt}
                </pre>
              )}
              <div className="mt-4">
                <a
                  href={src}
                  download={documento.nome}
                  className="text-x-cyan-glow hover:underline"
                >
                  Baixar arquivo
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
