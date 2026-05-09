"use client";
import * as React from "react";
import useSWR from "swr";
import { addAprovacao, listAprovacoes } from "@/lib/copilot/api";
import type { Aprovacao, AprovacaoDecisao } from "@/lib/copilot/types";

interface Props {
  contratacaoId: string;
  documentoId: string;
}

export function AprovacaoPanel({ contratacaoId, documentoId }: Props) {
  const { data, mutate } = useSWR<Aprovacao[]>(
    `/aprovacoes/${contratacaoId}`,
    () => listAprovacoes(contratacaoId),
    { revalidateOnFocus: false },
  );
  const aprovacoes = (data ?? []).filter((a) => a.documento_id === documentoId);

  const [aprovadoPor, setAprovadoPor] = React.useState("");
  const [papel, setPapel] = React.useState("Gestor");
  const [decisao, setDecisao] = React.useState<AprovacaoDecisao>("aprovado");
  const [comentario, setComentario] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    if (!aprovadoPor.trim()) {
      setError("Informe o nome do responsável");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await addAprovacao(contratacaoId, documentoId, {
        aprovado_por: aprovadoPor.trim(),
        papel: papel.trim() || "Gestor",
        decisao,
        comentario: comentario.trim() || null,
      });
      setComentario("");
      await mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-x-line bg-x-bg-subtle/40 p-3">
      <div className="text-sm font-medium">Aprovações</div>
      {aprovacoes.length === 0 && (
        <div className="text-xs text-x-ink-mute">Nenhuma aprovação registrada.</div>
      )}
      {aprovacoes.length > 0 && (
        <ul className="space-y-1.5">
          {aprovacoes.map((a) => (
            <li key={a.id} className="text-xs">
              <span
                className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  a.decisao === "aprovado"
                    ? "bg-green-100 text-green-800"
                    : a.decisao === "rejeitado"
                    ? "bg-red-100 text-red-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {a.decisao}
              </span>
              <span className="font-medium">{a.aprovado_por}</span>{" "}
              <span className="text-x-ink-mute">({a.papel})</span>
              {a.comentario && (
                <div className="mt-0.5 text-[11px] text-x-ink-mute">
                  “{a.comentario}”
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <input
          className="rounded border border-x-line px-2 py-1"
          placeholder="Seu nome"
          value={aprovadoPor}
          onChange={(e) => setAprovadoPor(e.target.value)}
        />
        <input
          className="rounded border border-x-line px-2 py-1"
          placeholder="Papel (Gestor, Jurídico…)"
          value={papel}
          onChange={(e) => setPapel(e.target.value)}
        />
        <select
          className="rounded border border-x-line px-2 py-1"
          value={decisao}
          onChange={(e) => setDecisao(e.target.value as AprovacaoDecisao)}
        >
          <option value="aprovado">Aprovado</option>
          <option value="retorno">Retorno p/ ajustes</option>
          <option value="rejeitado">Rejeitado</option>
        </select>
        <button
          onClick={submit}
          disabled={pending}
          className="rounded bg-x-accent px-2 py-1 text-white disabled:opacity-50"
        >
          {pending ? "Enviando…" : "Registrar"}
        </button>
      </div>
      <textarea
        className="w-full rounded border border-x-line px-2 py-1 text-xs"
        rows={2}
        placeholder="Comentário (opcional)"
        value={comentario}
        onChange={(e) => setComentario(e.target.value)}
      />
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
