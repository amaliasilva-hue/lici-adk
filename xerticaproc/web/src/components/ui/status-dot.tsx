import * as React from "react";
import { cn } from "@/lib/cn";
import type { ChecklistStatus } from "@/lib/copilot/types";

const statusToDot: Record<ChecklistStatus, string> = {
  confirmado: "dot dot-confirmado",
  inferido:   "dot dot-inferido",
  pendente:   "dot dot-pendente",
  dispensado: "dot dot-dispensado",
};

const statusLabel: Record<ChecklistStatus, string> = {
  confirmado: "Confirmado",
  inferido:   "Inferido",
  pendente:   "Pendente",
  dispensado: "Dispensado",
};

export function StatusDot({
  status, className, blocking,
}: { status: ChecklistStatus; className?: string; blocking?: boolean }) {
  const cls = blocking && status === "pendente" ? "dot dot-bloqueante" : statusToDot[status];
  const label = blocking && status === "pendente" ? "Bloqueante" : statusLabel[status];
  return <span title={label} className={cn(cls, className)} />;
}

export function StatusLabel({ status }: { status: ChecklistStatus }) {
  return (
    <span className="text-[11px] uppercase tracking-wide text-x-ink-mute">
      {statusLabel[status]}
    </span>
  );
}
import * as React from "react";
import { cn } from "@/lib/cn";
import type { ChecklistStatus } from "@/lib/copilot/types";

const statusToDot: Record<ChecklistStatus, string> = {
  confirmado: "dot dot-confirmado",
  inferido:   "dot dot-inferido",
  pendente:   "dot dot-pendente",
  bloqueante: "dot dot-bloqueante",
  dispensado: "dot dot-dispensado",
};

const statusLabel: Record<ChecklistStatus, string> = {
  confirmado: "Confirmado",
  inferido:   "Inferido",
  pendente:   "Pendente",
  bloqueante: "Bloqueante",
  dispensado: "Dispensado",
};

export function StatusDot({ status, className }: { status: ChecklistStatus; className?: string }) {
  return (
    <span title={statusLabel[status]} className={cn(statusToDot[status], className)} />
  );
}

export function StatusLabel({ status }: { status: ChecklistStatus }) {
  return <span className="text-[11px] uppercase tracking-wide text-x-ink-mute">{statusLabel[status]}</span>;
}
