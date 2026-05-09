"use client";
import * as React from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { getChecklist, patchChecklist } from "@/lib/copilot/api";
import type {
  ChecklistItem,
  ChecklistPatch,
  ChecklistResponse,
} from "@/lib/copilot/types";

export function checklistKey(contratacaoId: string): string {
  return `/proc/contratacoes/${contratacaoId}/checklist`;
}

export function useChecklist(contratacaoId: string) {
  const key = checklistKey(contratacaoId);
  const { data, error, isLoading, mutate } = useSWR<ChecklistResponse>(
    key,
    () => getChecklist(contratacaoId),
    { revalidateOnFocus: false },
  );

  const patch = React.useCallback(
    async (itemKey: string, payload: ChecklistPatch) => {
      const updated = await patchChecklist(contratacaoId, itemKey, payload);
      mutate(prev => {
        if (!prev) return prev;
        const next: Record<string, ChecklistItem[]> = {};
        for (const [cat, list] of Object.entries(prev.by_category)) {
          next[cat] = list.map(it =>
            it.item_key === itemKey ? { ...it, ...updated } : it,
          );
        }
        return { ...prev, by_category: next };
      }, { revalidate: false });
      // revalida em seguida para refrescar summary
      await globalMutate(key);
      return updated;
    },
    [contratacaoId, key, mutate],
  );

  const refresh = React.useCallback(() => globalMutate(key), [key]);

  return { data, error, isLoading, mutate, patch, refresh };
}
"use client";
import * as React from "react";
import useSWR, { mutate as globalMutate } from "swr";
import type { ChecklistItem, ChecklistResponse } from "@/lib/copilot/types";
import { getChecklist, patchChecklist } from "@/lib/copilot/api";

export function checklistKey(contratacaoId: string): string {
  return `/proc/contratacoes/${contratacaoId}/checklist`;
}

export function useChecklist(contratacaoId: string) {
  const key = checklistKey(contratacaoId);
  const { data, error, isLoading, mutate } = useSWR<ChecklistResponse>(
    key,
    () => getChecklist(contratacaoId),
    { revalidateOnFocus: false },
  );

  const patch = React.useCallback(
    async (
      itemKey: string,
      payload: Partial<ChecklistItem> & { justificativa?: string },
    ) => {
      const updated = await patchChecklist(contratacaoId, itemKey, payload);
      mutate(prev => {
        if (!prev) return prev;
        const itens = prev.itens.map(it =>
          it.item_key === itemKey ? { ...it, ...updated } : it,
        );
        return { ...prev, itens };
      }, { revalidate: false });
      return updated;
    },
    [contratacaoId, mutate],
  );

  const refresh = React.useCallback(() => {
    return globalMutate(key);
  }, [key]);

  return { data, error, isLoading, mutate, patch, refresh };
}
