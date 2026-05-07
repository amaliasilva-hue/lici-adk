"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

function ErrorContent() {
  const params = useSearchParams();
  const error = params.get("error");

  const message =
    error === "AccessDenied"
      ? "Acesso negado. Somente colaboradores @xertica.com podem acessar esta plataforma."
      : error === "Configuration"
      ? "Erro de configuração do servidor. Entre em contato com o suporte."
      : "Ocorreu um erro durante o login. Tente novamente.";

  return (
    <div
      className="relative min-h-screen overflow-hidden flex items-center justify-center"
      style={{ background: "#080F1A" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(231,76,60,0.12) 0%, transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,188,212,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,188,212,0.025) 1px, transparent 1px)",
          backgroundSize: "52px 52px",
        }}
      />

      <div
        className="relative z-10 w-full max-w-[420px] mx-4 px-10 py-12 text-center"
        style={{
          background: "linear-gradient(145deg, rgba(18,34,52,0.97) 0%, rgba(10,22,37,0.99) 100%)",
          border: "1px solid rgba(231,76,60,0.2)",
          borderRadius: "28px",
          boxShadow: "0 40px 80px rgba(0,0,0,0.7)",
        }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-6 text-2xl"
          style={{ background: "rgba(231,76,60,0.1)", border: "1px solid rgba(231,76,60,0.2)" }}
        >
          ⚠️
        </div>

        <div className="flex items-baseline justify-center mb-2">
          <span className="font-display font-bold text-2xl" style={{ color: "#00BCD4" }}>xertica</span>
          <span className="font-display font-extralight text-2xl text-slate-300">proc</span>
        </div>

        <p className="text-sm text-slate-400 mt-4 mb-8 leading-relaxed">{message}</p>

        <Link
          href="/auth/signin"
          className="inline-flex items-center justify-center gap-2 w-full py-3.5 px-6 rounded-2xl text-sm font-medium transition-all"
          style={{
            background: "rgba(0,188,212,0.1)",
            border: "1px solid rgba(0,188,212,0.2)",
            color: "#00BCD4",
          }}
        >
          Voltar ao login
        </Link>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  );
}
