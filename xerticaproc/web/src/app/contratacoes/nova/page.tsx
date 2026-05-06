"use client";

import { AuthGate } from "@/app/auth-gate";
import { api, type EntradaDemanda } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useState } from "react";

const NATUREZAS = [
  { value: "servico", label: "Serviço" },
  { value: "bem", label: "Bem / Material" },
  { value: "obra", label: "Obra" },
  { value: "solucao_ti", label: "Solução de TI" },
] as const;

export default function NovaContratacaoPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<Partial<EntradaDemanda>>({
    natureza_objeto: "servico",
    palavras_chave: [],
  });

  const [kwInput, setKwInput] = useState("");

  function set<K extends keyof EntradaDemanda>(key: K, val: EntradaDemanda[K]) {
    setForm((p) => ({ ...p, [key]: val }));
  }

  function addKw() {
    const kw = kwInput.trim();
    if (kw && !form.palavras_chave?.includes(kw)) {
      set("palavras_chave", [...(form.palavras_chave ?? []), kw]);
    }
    setKwInput("");
  }

  function removeKw(kw: string) {
    set(
      "palavras_chave",
      (form.palavras_chave ?? []).filter((k) => k !== kw)
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.id_orgao || !form.nome_orgao || !form.objeto_resumido || !form.descricao_necessidade) {
      setError("Preencha todos os campos obrigatórios.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.contratacoes.create(form as EntradaDemanda);
      router.push(`/contratacoes/${result.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthGate>
      <div className="min-h-screen p-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <a href="/" className="text-slate-400 hover:text-white text-sm">← Dashboard</a>
            <h1 className="font-display font-bold text-2xl text-white mt-4">
              Nova Contratação
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Preencha os dados da demanda para iniciar o processo de elaboração de ETP e TR.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-6">
            <div className="card space-y-4">
              <h2 className="font-display font-semibold text-white">Órgão Contratante</h2>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Código do Órgão *" htmlFor="id_orgao">
                  <input
                    id="id_orgao"
                    className="input"
                    placeholder="ex: 26000"
                    value={form.id_orgao ?? ""}
                    onChange={(e) => set("id_orgao", e.target.value)}
                    required
                  />
                </Field>
                <Field label="UASG" htmlFor="uasg">
                  <input
                    id="uasg"
                    className="input"
                    placeholder="ex: 153163"
                    value={form.uasg ?? ""}
                    onChange={(e) => set("uasg", e.target.value)}
                  />
                </Field>
              </div>

              <Field label="Nome do Órgão *" htmlFor="nome_orgao">
                <input
                  id="nome_orgao"
                  className="input"
                  placeholder="ex: Ministério da Educação"
                  value={form.nome_orgao ?? ""}
                  onChange={(e) => set("nome_orgao", e.target.value)}
                  required
                />
              </Field>
            </div>

            <div className="card space-y-4">
              <h2 className="font-display font-semibold text-white">Objeto da Contratação</h2>

              <Field label="Objeto Resumido *" htmlFor="objeto_resumido">
                <input
                  id="objeto_resumido"
                  className="input"
                  placeholder="ex: Contratação de serviço de suporte técnico especializado"
                  value={form.objeto_resumido ?? ""}
                  onChange={(e) => set("objeto_resumido", e.target.value)}
                  required
                />
              </Field>

              <Field label="Natureza do Objeto" htmlFor="natureza">
                <select
                  id="natureza"
                  className="input"
                  value={form.natureza_objeto ?? "servico"}
                  onChange={(e) =>
                    set(
                      "natureza_objeto",
                      e.target.value as EntradaDemanda["natureza_objeto"]
                    )
                  }
                >
                  {NATUREZAS.map((n) => (
                    <option key={n.value} value={n.value}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Descrição da Necessidade *" htmlFor="descricao">
                <textarea
                  id="descricao"
                  className="input min-h-32 resize-y"
                  placeholder="Descreva a necessidade que origina esta contratação, conforme o DFD..."
                  value={form.descricao_necessidade ?? ""}
                  onChange={(e) => set("descricao_necessidade", e.target.value)}
                  required
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Valor Estimado Máximo (R$)" htmlFor="valor">
                  <input
                    id="valor"
                    type="number"
                    min={0}
                    step={0.01}
                    className="input"
                    placeholder="ex: 500000.00"
                    value={form.valor_estimado_maximo ?? ""}
                    onChange={(e) =>
                      set(
                        "valor_estimado_maximo",
                        e.target.value ? Number(e.target.value) : undefined
                      )
                    }
                  />
                </Field>
                <Field label="Prazo de Vigência (meses)" htmlFor="prazo">
                  <input
                    id="prazo"
                    type="number"
                    min={1}
                    max={60}
                    className="input"
                    placeholder="ex: 12"
                    value={form.prazo_vigencia_meses ?? ""}
                    onChange={(e) =>
                      set(
                        "prazo_vigencia_meses",
                        e.target.value ? Number(e.target.value) : undefined
                      )
                    }
                  />
                </Field>
              </div>
            </div>

            <div className="card space-y-4">
              <h2 className="font-display font-semibold text-white">Palavras-chave para Pesquisa</h2>
              <p className="text-slate-400 text-xs">
                Usadas para consultar PNCP, Compras.gov e Painel de Preços.
              </p>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="ex: suporte ti"
                  value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addKw();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={addKw}
                  className="px-4 py-2 bg-surface-border hover:bg-slate-600 text-white rounded-lg text-sm transition-colors"
                >
                  + Adicionar
                </button>
              </div>
              {(form.palavras_chave?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2">
                  {form.palavras_chave?.map((kw) => (
                    <span
                      key={kw}
                      className="badge-blue flex items-center gap-1"
                    >
                      {kw}
                      <button
                        type="button"
                        onClick={() => removeKw(kw)}
                        className="ml-1 text-blue-300 hover:text-white"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <div className="p-4 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-brand-blue hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? "Criando…" : "Criar Contratação →"}
            </button>
          </form>
        </div>
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          background: #0F1F31;
          border: 1px solid #1E3550;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          color: #e2e8f0;
          font-size: 0.875rem;
          outline: none;
          transition: border-color 0.15s;
        }
        .input:focus {
          border-color: #00BCD4;
        }
        .input::placeholder {
          color: #64748b;
        }
      `}</style>
    </AuthGate>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-400 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
