"use client";

import { AuthGate } from "@/app/auth-gate";
import { api, type DocumentoGerado } from "@/lib/api";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function EtpPage() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentoGerado | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.contratacoes
      .getEtp(id)
      .then(setDoc)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <AuthGate>
      <DocumentView
        title="Estudo Técnico Preliminar (ETP)"
        parentId={id}
        doc={doc}
        loading={loading}
        error={error}
      />
    </AuthGate>
  );
}

function DocumentView({
  title,
  parentId,
  doc,
  loading,
  error,
}: {
  title: string;
  parentId: string;
  doc: DocumentoGerado | null;
  loading: boolean;
  error: string | null;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!doc) return;
    navigator.clipboard.writeText(doc.conteudo_markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <a
          href={`/contratacoes/${parentId}`}
          className="text-slate-400 hover:text-white text-sm"
        >
          ← Contratação
        </a>
        <div className="flex items-center justify-between mt-4 mb-6">
          <h1 className="font-display font-bold text-2xl text-white">{title}</h1>
          {doc && (
            <button
              onClick={copy}
              className="px-4 py-2 bg-surface-border hover:bg-slate-700 text-slate-200 rounded-lg text-sm transition-colors"
            >
              {copied ? "✓ Copiado" : "Copiar Markdown"}
            </button>
          )}
        </div>

        {loading && <p className="text-slate-500">Carregando…</p>}
        {error && (
          <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {doc && (
          <>
            {/* Meta */}
            <div className="flex gap-4 mb-6 text-xs text-slate-400">
              <span>Versão {doc.versao}</span>
              <span>•</span>
              <span>
                Gerado em{" "}
                {new Date(doc.gerado_em).toLocaleString("pt-BR")}
              </span>
              {doc.tokens_usados && (
                <>
                  <span>•</span>
                  <span>{doc.tokens_usados.toLocaleString()} tokens</span>
                </>
              )}
            </div>

            {/* Pendências */}
            {doc.pendencias.length > 0 && (
              <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                <p className="text-yellow-300 text-sm font-semibold mb-2">
                  ⚠ {doc.pendencias.length} pendência(s) a resolver:
                </p>
                <ul className="space-y-1">
                  {doc.pendencias.map((p, i) => (
                    <li key={i} className="text-yellow-200 text-sm">
                      • {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Document content */}
            <div className="card !bg-[#0A1929] prose prose-invert prose-sm max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm text-slate-200 leading-relaxed">
                {doc.conteudo_markdown}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
