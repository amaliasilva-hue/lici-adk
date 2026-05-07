"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export default function SignInPage() {
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    await signIn("google", { callbackUrl: "/" });
  };

  return (
    <>
      <style>{`
        @keyframes floatA {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.18; }
          33% { transform: translate(30px, -20px) scale(1.05); opacity: 0.24; }
          66% { transform: translate(-15px, 25px) scale(0.97); opacity: 0.16; }
        }
        @keyframes floatB {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.2; }
          40% { transform: translate(-25px, 20px) scale(1.04); opacity: 0.26; }
          70% { transform: translate(20px, -15px) scale(0.98); opacity: 0.17; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .xp-orb-a { animation: floatA 12s ease-in-out infinite; }
        .xp-orb-b { animation: floatB 15s ease-in-out infinite; }
        .xp-spin  { animation: spin 0.9s linear infinite; }
      `}</style>

      {/* Full-page wrapper */}
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#080F1A",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Orb A */}
        <div className="xp-orb-a" style={{
          position: "absolute", top: "-160px", left: "-160px",
          width: "640px", height: "640px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,188,212,0.22) 0%, transparent 65%)",
          pointerEvents: "none",
        }} />
        {/* Orb B */}
        <div className="xp-orb-b" style={{
          position: "absolute", bottom: "-160px", right: "-160px",
          width: "560px", height: "560px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(30,95,168,0.26) 0%, transparent 65%)",
          pointerEvents: "none",
        }} />
        {/* Grid */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "linear-gradient(rgba(0,188,212,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(0,188,212,0.04) 1px, transparent 1px)",
          backgroundSize: "52px 52px",
        }} />

        {/* Card */}
        <div style={{
          position: "relative", zIndex: 10,
          width: "100%", maxWidth: "420px", margin: "16px",
          background: "linear-gradient(145deg, rgba(18,34,52,0.97) 0%, rgba(10,22,37,0.99) 100%)",
          border: "1px solid rgba(0,188,212,0.2)",
          borderRadius: "28px",
          boxShadow: "0 0 0 1px rgba(0,188,212,0.04) inset, 0 40px 80px rgba(0,0,0,0.7)",
        }}>
          {/* Top shimmer */}
          <div style={{
            position: "absolute", top: 0, left: "64px", right: "64px", height: "1px",
            background: "linear-gradient(90deg, transparent 0%, rgba(0,188,212,0.7) 50%, transparent 100%)",
          }} />

          <div style={{ padding: "48px 40px 40px" }}>
            {/* Wordmark */}
            <div style={{ marginBottom: "8px", display: "flex", alignItems: "baseline" }}>
              <span style={{
                fontFamily: "var(--font-poppins), system-ui, sans-serif",
                fontWeight: 700, fontSize: "2.6rem", lineHeight: 1,
                color: "#00BCD4", letterSpacing: "-1px",
                textShadow: "0 0 32px rgba(0,188,212,0.4)",
              }}>xertica</span>
              <span style={{
                fontFamily: "var(--font-poppins), system-ui, sans-serif",
                fontWeight: 300, fontSize: "2.6rem", lineHeight: 1,
                color: "#cbd5e1", letterSpacing: "-1px",
              }}>proc</span>
            </div>

            {/* Tagline */}
            <p style={{ fontSize: "13px", color: "#64748b", marginBottom: "36px", lineHeight: "1.6" }}>
              Elaboração de{" "}
              <span style={{ color: "#94a3b8", fontWeight: 500 }}>ETP · TR · Mapa de Preços</span>
              {" "}com IA generativa · Lei 14.133/2021
            </p>

            {/* Feature pills */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "36px" }}>
              {[
                { icon: "⚡", text: "Gemini AI" },
                { icon: "📋", text: "ETP automático" },
                { icon: "⚖️", text: "NLLC compliance" },
                { icon: "🔍", text: "Pesquisa de preços" },
              ].map(({ icon, text }) => (
                <span key={text} style={{
                  display: "inline-flex", alignItems: "center", gap: "6px",
                  padding: "6px 12px", fontSize: "12px", borderRadius: "99px",
                  background: "rgba(0,188,212,0.08)",
                  border: "1px solid rgba(0,188,212,0.18)",
                  color: "rgba(0,188,212,0.85)",
                }}>
                  <span>{icon}</span><span>{text}</span>
                </span>
              ))}
            </div>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
              <div style={{ flex: 1, height: "1px", background: "rgba(30,53,80,0.9)" }} />
              <span style={{ fontSize: "10px", color: "#334155", textTransform: "uppercase", letterSpacing: "0.15em" }}>login</span>
              <div style={{ flex: 1, height: "1px", background: "rgba(30,53,80,0.9)" }} />
            </div>

            {/* Google button */}
            <button
              onClick={handleSignIn}
              disabled={loading}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                gap: "10px", padding: "14px 24px", borderRadius: "16px",
                fontSize: "14px", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
                border: "none", outline: "none", transition: "all 0.2s",
                background: loading ? "rgba(255,255,255,0.07)" : "linear-gradient(135deg, #ffffff 0%, #f0f4f8 100%)",
                color: loading ? "#64748b" : "#0f1923",
                boxShadow: loading ? "none" : "0 4px 16px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.15) inset",
              }}
            >
              {loading ? (
                <>
                  <div className="xp-spin" style={{
                    width: "18px", height: "18px", borderRadius: "50%",
                    border: "2px solid #475569", borderTopColor: "transparent",
                  }} />
                  <span>Conectando...</span>
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  <span>Entrar com Google Workspace</span>
                </>
              )}
            </button>

            {/* Footer */}
            <p style={{ marginTop: "20px", textAlign: "center", fontSize: "11px", color: "rgba(100,116,139,0.7)" }}>
              Acesso restrito · colaboradores{" "}
              <span style={{ color: "rgba(0,188,212,0.55)", fontWeight: 500 }}>@xertica.com</span>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
      {/* Animated glow orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 w-[700px] h-[700px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(0,188,212,0.18) 0%, transparent 65%)",
          animation: "floatA 12s ease-in-out infinite",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(30,95,168,0.22) 0%, transparent 65%)",
          animation: "floatB 15s ease-in-out infinite",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-[30%] w-[300px] h-[300px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(0,188,212,0.06) 0%, transparent 70%)",
          transform: "translate(-50%, -50%)",
          animation: "floatA 18s ease-in-out infinite reverse",
        }}
      />

      {/* Subtle grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,188,212,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(0,188,212,0.035) 1px, transparent 1px)",
          backgroundSize: "52px 52px",
        }}
      />

      {/* Noise texture overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundRepeat: "repeat",
          backgroundSize: "128px 128px",
        }}
      />

      {/* Main card */}
      <div
        className="relative z-10 w-full max-w-[420px] mx-4"
        style={{
          background:
            "linear-gradient(145deg, rgba(18,34,52,0.97) 0%, rgba(10,22,37,0.99) 100%)",
          border: "1px solid rgba(0,188,212,0.18)",
          borderRadius: "28px",
          boxShadow:
            "0 0 0 1px rgba(0,188,212,0.04) inset, 0 40px 80px rgba(0,0,0,0.7), 0 0 120px rgba(0,188,212,0.04)",
        }}
      >
        {/* Top shimmer */}
        <div
          className="absolute top-0 left-16 right-16 h-[1px]"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(0,188,212,0.7) 50%, transparent 100%)",
          }}
        />

        <div className="px-10 pt-12 pb-10">
          {/* Wordmark */}
          <div className="mb-1 flex items-baseline">
            <span
              className="font-display font-bold text-[2.6rem] leading-none"
              style={{
                color: "#00BCD4",
                letterSpacing: "-1px",
                textShadow: "0 0 32px rgba(0,188,212,0.35)",
              }}
            >
              xertica
            </span>
            <span
              className="font-display font-extralight text-[2.6rem] leading-none text-slate-300"
              style={{ letterSpacing: "-1px" }}
            >
              proc
            </span>
          </div>

          {/* Tagline */}
          <p className="text-[13px] text-slate-500 mb-10 leading-relaxed">
            Elaboração de{" "}
            <span className="text-slate-300 font-medium">ETP · TR · Mapa de Preços</span>
            {" "}com IA generativa · Lei 14.133/2021
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 mb-9">
            {[
              { icon: "⚡", text: "Gemini AI" },
              { icon: "📋", text: "ETP automático" },
              { icon: "⚖️", text: "NLLC compliance" },
              { icon: "🔍", text: "Pesquisa de preços" },
            ].map(({ icon, text }) => (
              <span
                key={text}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full"
                style={{
                  background: "rgba(0,188,212,0.08)",
                  border: "1px solid rgba(0,188,212,0.15)",
                  color: "rgba(0,188,212,0.85)",
                }}
              >
                <span>{icon}</span>
                <span>{text}</span>
              </span>
            ))}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px" style={{ background: "rgba(30,53,80,0.8)" }} />
            <span className="text-[10px] text-slate-700 uppercase tracking-[0.15em]">
              login
            </span>
            <div className="flex-1 h-px" style={{ background: "rgba(30,53,80,0.8)" }} />
          </div>

          {/* Google CTA */}
          <button
            onClick={handleSignIn}
            disabled={loading}
            className="group w-full flex items-center justify-center gap-3 rounded-2xl font-semibold text-sm transition-all duration-200 active:scale-[0.98]"
            style={{
              padding: "14px 24px",
              background: loading
                ? "rgba(255,255,255,0.06)"
                : "linear-gradient(135deg, #ffffff 0%, #f0f4f8 100%)",
              color: loading ? "rgba(148,163,184,0.6)" : "#0f1923",
              border: loading ? "1px solid rgba(255,255,255,0.08)" : "none",
              boxShadow: loading
                ? "none"
                : "0 1px 0 rgba(255,255,255,0.15) inset, 0 4px 16px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)",
            }}
          >
            {loading ? (
              <>
                <div className="w-[18px] h-[18px] rounded-full border-2 border-slate-600 border-t-transparent animate-spin" />
                <span>Conectando...</span>
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                <span>Entrar com Google Workspace</span>
              </>
            )}
          </button>

          {/* Footer note */}
          <p className="mt-5 text-center text-[11px]" style={{ color: "rgba(100,116,139,0.7)" }}>
            Acesso restrito · colaboradores{" "}
            <span style={{ color: "rgba(0,188,212,0.5)", fontWeight: 500 }}>
              @xertica.com
            </span>
          </p>
        </div>
      </div>

      <style>{`
        @keyframes floatA {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -20px) scale(1.05); }
          66% { transform: translate(-15px, 25px) scale(0.97); }
        }
        @keyframes floatB {
          0%, 100% { transform: translate(0, 0) scale(1); }
          40% { transform: translate(-25px, 20px) scale(1.04); }
          70% { transform: translate(20px, -15px) scale(0.98); }
        }
      `}</style>
    </div>
  );
}
