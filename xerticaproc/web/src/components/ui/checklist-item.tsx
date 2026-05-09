"use client";
import * as React from "react";
import { cn } from "@/lib/cn";
import type { ChecklistItem } from "@/lib/copilot/types";
import { StatusDot } from "./status-dot";
import { Button } from "./button";

interface Props {
  item: ChecklistItem;
  onConfirm?: (item: ChecklistItem) => void;
  onDispensar?: (item: ChecklistItem) => void;
  onPergunte?: (item: ChecklistItem) => void;
}

export function ChecklistItemRow({ item, onConfirm, onDispensar, onPergunte }: Props) {
  const [open, setOpen] = React.useState(false);
  const isInferido = item.status === "inferido";
  const isPendente = item.status === "pendente";
  const isBlocking = item.criticidade === "bloqueante" && isPendente && item.owner !== "orgao";

  return (
    <li
      className={cn(
        "card-tight transition-colors",
        isBlocking && "border-x-red/40",
        item.status === "confirmado" && "border-x-green/30",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        <StatusDot status={item.status} blocking={isBlocking} />
        <span className="flex-1 text-sm text-x-ink truncate">{item.label}</span>
        {item.criticidade === "bloqueante" && (
          <span className="chip chip-red">BLOQ</span>
        )}
        {item.owner === "orgao" && <span className="chip">ORGAO</span>}
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-x-line/60 pt-2 animate-fade-in">
          {item.valor != null && (
            <div className="text-xs text-x-ink-dim">
              <span className="text-x-ink-mute">Valor: </span>
              <span className="text-x-ink">{String(item.valor)}</span>
            </div>
          )}
          {item.justificativa && (
            <div className="text-xs text-x-ink-dim italic">{item.justificativa}</div>
          )}
          <div className="flex flex-wrap gap-2">
            {isInferido && onConfirm && (
              <Button size="sm" variant="primary" onClick={() => onConfirm(item)}>
                Confirmar
              </Button>
            )}
            {isPendente && onPergunte && (
              <Button size="sm" variant="outline" onClick={() => onPergunte(item)}>
                Pergunte-me
              </Button>
            )}
            {onDispensar && item.status !== "dispensado" && (
              <Button size="sm" variant="ghost" onClick={() => onDispensar(item)}>
                Dispensar
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
