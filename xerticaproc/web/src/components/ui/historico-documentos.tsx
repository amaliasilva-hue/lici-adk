"use client";
import * as React from "react";
import useSWR from "swr";
import { listDocumentos } from "@/lib/copilot/api";
import type { DocType, DocumentoGeradoLite } from "@/lib/copilot/types";

interface Props {
  contratacaoId: string;
  docType?: DocType;
}

export function HistoricoDocumentos({ contratacaoId, docType }: Props) {
  const { data } = useSWR<DocumentoGeradoLite[]>(
    contratacaoId ? `/documentos/${contratacaoId}` : null,
    () => listDocumentos(contratacaoId),
    { revalidateOnFocus: false, refreshInterval: 30000 },
  );
  const [selA, setSelA] = React.useState<string | null>(null);
  const [selB, setSelB] = React.useState<string | null>(null);

  const docs = (data ?? []).filter((d) => !docType || d.doc_type === docType);
  const docA = docs.find((d) => d.id === selA);
  const docB = docs.find((d) => d.id === selB);

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-medium text-x-ink-mute">
          Versões geradas {docType ? `(${docType.toUpperCase()})` : ""}
        </div>
        {docs.length === 0 && (
          <div className="text-xs text-x-ink-mute">Nenhuma versão gerada ainda.</div>
        )}
        <ul className="space-y-1.5">
          {docs.map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between rounded border border-x-line px-2 py-1 text-xs"
            >
              <div>
                <span className="font-medium">
                  {d.doc_type.toUpperCase()} v{d.versao}
                </span>{" "}
                <span className="text-x-ink-mute">
                  {new Date(d.gerado_em).toLocaleString("pt-BR")}
                </span>{" "}
                <span className="text-x-ink-mute">
                  · score {(d.readiness_snapshot.score * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    selA === d.id ? "bg-x-accent text-white" : "border border-x-line"
                  }`}
                  onClick={() => setSelA(selA === d.id ? null : d.id)}
                >
                  A
                </button>
                <button
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    selB === d.id ? "bg-x-accent text-white" : "border border-x-line"
                  }`}
                  onClick={() => setSelB(selB === d.id ? null : d.id)}
                >
                  B
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {docA && docB && docA.id !== docB.id && (
        <DiffView a={docA.content_md} b={docB.content_md} labelA={`v${docA.versao}`} labelB={`v${docB.versao}`} />
      )}
    </div>
  );
}

function DiffView({ a, b, labelA, labelB }: { a: string; b: string; labelA: string; labelB: string }) {
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const setA = new Set(linesA);
  const setB = new Set(linesB);
  const removed = linesA.filter((l) => !setB.has(l));
  const added = linesB.filter((l) => !setA.has(l));

  return (
    <div className="rounded border border-x-line p-2 text-xs">
      <div className="mb-1 font-medium">
        Diff {labelA} ↔ {labelB}{" "}
        <span className="text-x-ink-mute">
          (-{removed.length} +{added.length})
        </span>
      </div>
      <div className="grid grid-cols-1 gap-1 font-mono">
        {removed.slice(0, 50).map((l, i) => (
          <div key={`r${i}`} className="bg-red-50 text-red-800">
            − {l}
          </div>
        ))}
        {added.slice(0, 50).map((l, i) => (
          <div key={`a${i}`} className="bg-green-50 text-green-800">
            + {l}
          </div>
        ))}
        {removed.length + added.length > 100 && (
          <div className="text-[10px] text-x-ink-mute">…truncado em 100 linhas…</div>
        )}
      </div>
    </div>
  );
}
