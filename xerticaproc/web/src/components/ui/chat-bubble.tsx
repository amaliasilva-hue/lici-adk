"use client";
import * as React from "react";
import { cn } from "@/lib/cn";
import type { MensagemRole } from "@/lib/copilot/types";

interface Props {
  role: MensagemRole;
  children: React.ReactNode;
  pending?: boolean;
}

export function ChatBubble({ role, children, pending }: Props) {
  const isUser = role === "user";
  return (
    <div className={cn("flex w-full animate-slide-up", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
          isUser
            ? "bg-x-blue/40 border border-x-blue/50 text-x-ink"
            : "glass-1 text-x-ink",
          pending && "opacity-70",
        )}
      >
        {children}
        {pending && (
          <span className="ml-1 inline-block h-2 w-2 rounded-full bg-x-cyan-glow animate-pulse-cyan align-middle" />
        )}
      </div>
    </div>
  );
}
