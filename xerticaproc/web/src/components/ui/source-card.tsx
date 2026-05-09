import * as React from "react";
import { cn } from "@/lib/cn";
import type { ClassificacaoPreco, FonteUsuario } from "@/lib/copilot/types";

const classChip: Record<ClassificacaoPreco, string> = {
  direta:        "chip chip-green",
  indireta:      "chip chip-cyan",
  parametrica:   "chip chip-cyan",
  complementar:  "chip chip-amber",
  outlier:       "chip chip-amber",
  descartada:    "chip chip-red",
};

const statusChip: Record<FonteUsuario["status"], string> = {
  pendente:   "chip chip-amber",
  validada:   "chip chip-green",
  descartada: "chip chip-red",
};

export function SourceCard({
  source, onReclassify, onDiscard,
}: {
  source: FonteUsuario;
  onReclassify?: (s: FonteUsuario) => void;
  onDiscard?: (s: FonteUsuario) => void;
}) {
  const valorMensal = source.valor_mensal_unitario;
  return (
    <div className="card-tight space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-x-ink truncate">
            {source.produto || source.url || source.tipo}
          </div>
          {source.url && (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-x-cyan-glow hover:underline truncate block"
            >
              {source.url}
            </a>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={statusChip[source.status]}>{source.status}</span>
          {source.classificacao && (
            <span className={classChip[source.classificacao]}>
              {source.classificacao}
            </span>
          )}
        </div>
      </div>
      {valorMensal != null && (
        <div className="text-xs text-x-ink-dim">
          R$ <span className="text-x-ink font-medium">{valorMensal.toFixed(2)}</span> /unid./mês
          {source.score != null && (
            <span className="ml-2 text-x-ink-mute">score {source.score.toFixed(2)}</span>
          )}
        </div>
      )}
      {source.observacao && (
        <div className="text-[11px] italic text-x-ink-mute">{source.observacao}</div>
      )}
      {(onReclassify || onDiscard) && source.status !== "descartada" && (
        <div className="flex gap-2 pt-1">
          {onReclassify && (
            <button
              className="text-[11px] text-x-ink-dim hover:text-x-cyan-glow"
              onClick={() => onReclassify(source)}
            >
              Reclassificar
            </button>
          )}
          {onDiscard && (
            <button
              className={cn("text-[11px] text-x-ink-dim hover:text-red-300")}
              onClick={() => onDiscard(source)}
            >
              Descartar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
