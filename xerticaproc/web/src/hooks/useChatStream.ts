"use client";
import * as React from "react";
import { chatStream, getHistory } from "@/lib/copilot/api";
import { waitForApiToken } from "@/lib/api";
import type {
  Anexo,
  ChatHistoryResponse,
  MensagemOut,
  StreamEvent,
  SuggestedAction,
} from "@/lib/copilot/types";

interface UseChatStreamOpts {
  onChecklistUpdated?: () => void;
  onPriceSourcesAdded?: () => void;
  onTurnComplete?: (messageId: string) => void;
}

export function useChatStream(contratacaoId: string, opts: UseChatStreamOpts = {}) {
  const [messages, setMessages] = React.useState<MensagemOut[]>([]);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [suggestedActions, setSuggestedActions] = React.useState<SuggestedAction[]>([]);
  const draftRef = React.useRef<string>("");
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setError(null);
    getHistory(contratacaoId, { limit: 50 })
      .then((h: ChatHistoryResponse) => { if (!cancelled) setMessages(h.messages); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [contratacaoId]);

  const send = React.useCallback(
    async (text: string, anexos?: Anexo[]) => {
      if ((!text.trim() && !(anexos && anexos.length)) || pending) return;
      
      // Ensure token is available before sending
      const token = await waitForApiToken(6000);
      if (!token) {
        setError("Token não disponível. Faça login novamente.");
        return;
      }

      const now = new Date().toISOString();
      const userMsg: MensagemOut = {
        id: `local-user-${Date.now()}`,
        role: "user",
        conteudo: text,
        anexos: anexos,
        criado_em: now,
      };
      const assistantId = `local-asst-${Date.now()}`;
      const assistantStub: MensagemOut = {
        id: assistantId,
        role: "assistant",
        conteudo: "",
        criado_em: now,
      };
      setMessages((prev) => [...prev, userMsg, assistantStub]);
      setPending(true);
      setError(null);
      setSuggestedActions([]);
      draftRef.current = "";

      const ctl = new AbortController();
      abortRef.current = ctl;

      const onEvent = (ev: StreamEvent) => {
        if (ev.event === "assistant_token") {
          draftRef.current += ev.data.text;
          const draft = draftRef.current;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, conteudo: draft } : m)),
          );
        } else if (ev.event === "checklist_updated") {
          opts.onChecklistUpdated?.();
        } else if (ev.event === "price_sources_added") {
          opts.onPriceSourcesAdded?.();
        } else if (ev.event === "turn_complete") {
          const finalContent = draftRef.current;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    id: ev.data.message_id,
                    conteudo: finalContent,
                    meta: { intent: ev.data.intent },
                  }
                : m,
            ),
          );
          if (ev.data.suggested_actions) {
            setSuggestedActions(ev.data.suggested_actions);
          }
          opts.onTurnComplete?.(ev.data.message_id);
        } else if (ev.event === "error") {
          setError(ev.data.message);
        }
      };

      try {
        await chatStream(contratacaoId, text, onEvent, ctl.signal, anexos);
      } catch (e) {
        setError(String(e));
      } finally {
        setPending(false);
        abortRef.current = null;
      }
    },
    [contratacaoId, opts, pending],
  );

  const cancel = React.useCallback(() => abortRef.current?.abort(), []);

  return { messages, pending, error, suggestedActions, send, cancel };
}
