"use client";
import * as React from "react";
import useSWR from "swr";
import {
  addNegativeSearch,
  addSource,
  listNegativeSearches,
  listSources,
  patchSource,
} from "@/lib/copilot/api";
import type {
  FonteUsuario,
  FonteUsuarioIn,
  FonteUsuarioPatch,
  PesquisaNegativa,
  PesquisaNegativaIn,
} from "@/lib/copilot/types";

export function sourcesKey(contratacaoId: string) {
  return `/proc/contratacoes/${contratacaoId}/fontes`;
}
export function negativeKey(contratacaoId: string) {
  return `/proc/contratacoes/${contratacaoId}/pesquisas-negativas`;
}

export function useSources(contratacaoId: string) {
  const key = sourcesKey(contratacaoId);
  const { data, error, isLoading, mutate } = useSWR<FonteUsuario[]>(
    key,
    () => listSources(contratacaoId),
    { revalidateOnFocus: false, refreshInterval: 0 },
  );

  const add = React.useCallback(
    async (payload: FonteUsuarioIn) => {
      const created = await addSource(contratacaoId, payload);
      await mutate();
      // re-pollar 1x após 4s para pegar status validada
      setTimeout(() => { void mutate(); }, 4000);
      return created;
    },
    [contratacaoId, mutate],
  );

  const update = React.useCallback(
    async (sourceId: string, payload: FonteUsuarioPatch) => {
      const updated = await patchSource(contratacaoId, sourceId, payload);
      await mutate();
      return updated;
    },
    [contratacaoId, mutate],
  );

  return { data, error, isLoading, mutate, add, update };
}

export function useNegativeSearches(contratacaoId: string) {
  const key = negativeKey(contratacaoId);
  const { data, error, isLoading, mutate } = useSWR<PesquisaNegativa[]>(
    key,
    () => listNegativeSearches(contratacaoId),
    { revalidateOnFocus: false },
  );
  const add = React.useCallback(
    async (payload: PesquisaNegativaIn) => {
      const created = await addNegativeSearch(contratacaoId, payload);
      await mutate();
      return created;
    },
    [contratacaoId, mutate],
  );
  return { data, error, isLoading, mutate, add };
}
