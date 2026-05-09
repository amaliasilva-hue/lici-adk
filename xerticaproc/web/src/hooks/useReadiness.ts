"use client";
import * as React from "react";
import useSWR from "swr";
import { gerarDocumento, getReadiness } from "@/lib/copilot/api";
import type {
  DocType,
  DocumentReadiness,
  DocumentoGeradoLite,
} from "@/lib/copilot/types";

export function readinessKey(cid: string, docType: DocType): string {
  return `/readiness/${cid}/${docType}`;
}

export function useReadiness(contratacaoId: string, docType: DocType = "etp") {
  const key = contratacaoId ? readinessKey(contratacaoId, docType) : null;
  const { data, error, isLoading, mutate } = useSWR<DocumentReadiness>(
    key,
    () => getReadiness(contratacaoId, docType),
    { revalidateOnFocus: false, refreshInterval: 0 },
  );
  return { data, error, isLoading, refresh: () => mutate() };
}

export function useGenerateDocument() {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [readinessFail, setReadinessFail] =
    React.useState<DocumentReadiness | null>(null);
  const [doc, setDoc] = React.useState<DocumentoGeradoLite | null>(null);

  const generate = React.useCallback(
    async (cid: string, docType: DocType): Promise<DocumentoGeradoLite | null> => {
      setPending(true);
      setError(null);
      setReadinessFail(null);
      setDoc(null);
      try {
        const d = await gerarDocumento(cid, docType);
        setDoc(d);
        return d;
      } catch (e: unknown) {
        if (e instanceof Error && e.message === "readiness_failed") {
          const r = (e as Error & { readiness?: DocumentReadiness }).readiness;
          setReadinessFail(r ?? null);
        } else {
          setError(e instanceof Error ? e.message : String(e));
        }
        return null;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  const reset = React.useCallback(() => {
    setError(null);
    setReadinessFail(null);
    setDoc(null);
  }, []);

  return { pending, error, readinessFail, doc, generate, reset };
}
