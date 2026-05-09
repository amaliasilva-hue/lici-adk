"use client";
import * as React from "react";
import useSWR from "swr";
import { listEventos, markEventosRead } from "@/lib/copilot/api";
import type { EventoOut } from "@/lib/copilot/types";

export function NotificationBell({ contratacaoId }: { contratacaoId: string }) {
  const [open, setOpen] = React.useState(false);
  const { data, mutate } = useSWR<EventoOut[]>(
    contratacaoId ? `/eventos/${contratacaoId}` : null,
    () => listEventos(contratacaoId, { limit: 30 }),
    { refreshInterval: 15000, revalidateOnFocus: true },
  );
  const eventos = data ?? [];
  const unread = eventos.filter((e) => !e.lido).length;

  const onToggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      await markEventosRead(contratacaoId);
      await mutate();
    }
  };

  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="relative rounded-full p-2 hover:bg-x-bg-subtle"
        aria-label="Notificações"
      >
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-x-line bg-white shadow-lg">
          <div className="border-b border-x-line px-3 py-2 text-sm font-medium">
            Notificações ({eventos.length})
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {eventos.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-x-ink-mute">
                Sem eventos ainda.
              </li>
            )}
            {eventos.map((e) => (
              <li key={e.id} className="border-b border-x-line/50 px-3 py-2 text-xs">
                <div className="font-medium text-x-ink">{labelEvento(e.tipo)}</div>
                <div className="text-[11px] text-x-ink-mute">
                  {new Date(e.criado_em).toLocaleString("pt-BR")}
                </div>
                {Object.keys(e.payload).length > 0 && (
                  <div className="mt-1 text-[11px] text-x-ink-mute">
                    {Object.entries(e.payload)
                      .slice(0, 3)
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(" · ")}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function labelEvento(tipo: string): string {
  if (tipo.startsWith("documento_gerado.")) {
    return `Documento ${tipo.split(".")[1]?.toUpperCase()} gerado`;
  }
  if (tipo === "fonte_validada") return "Fonte de preço validada";
  if (tipo.startsWith("aprovacao.")) {
    const dec = tipo.split(".")[1];
    return `Aprovação: ${dec}`;
  }
  return tipo;
}
