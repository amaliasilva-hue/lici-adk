"use client";

import { AuthGate } from "@/app/auth-gate";
import { api, type DocumentoGerado } from "@/lib/api";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function TrPage() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentoGerado | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.contratacoes
      .getTr(id)
      .then(setDoc)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <AuthGate>
      <div className="min-h-screen p-8">
        <div className="max-w-4xl mx-auto">
          <a href={`/contratacoes/${id}`} className="text-slate-400 hover:text-white text-sm">
            ← Contratação
          </a>
          <div className="flex items-center justify-between mt-4 mb-6">
            <h1 className="font-display font-bold text-2xl text-white">
              Termo de Referência (TR)
            </h1>
            {doc && (
              <CopyButton text={doc.conteudo_markdown} />
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
              <div className="flex gap-4 mb-6 text-xs text-slate-400">
                <span>Versão {doc.versao}</span>
                <span>•</span>
                <span>Gerado em {new Date(doc.gerado_em).toLocaleString("pt-BR")}</span>
              </div>

              {doc.pendencias.length > 0 && (
                <div className="mb-6 p-4 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                  <p className="text-yellow-300 text-sm font-semibold mb-2">
                    ⚠ {doc.pendencias.length} pendência(s) a resolver:
                  </p>
                  <ul className="space-y-1">
                    {doc.pendencias.map((p, i) => (
                      <li key={i} className="text-yellow-200 text-sm">• {p}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="card !bg-[#0A1929]">
                <pre className="whitespace-pre-wrap font-sans text-sm text-slate-200 leading-relaxed">
                  {doc.conteudo_markdown}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </AuthGate>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        })
      }
      className="px-4 py-2 bg-surface-border hover:bg-slate-700 text-slate-200 rounded-lg text-sm transition-colors"
    >
      {copied ? "✓ Copiado" : "Copiar Markdown"}
    </button>
  );
}
