'use client';
import { useSession, signIn, signOut } from 'next-auth/react';

export function AuthGate() {
  const { data: session, status } = useSession();
  if (status === 'loading') return <span className="text-sm text-slate-400">…</span>;
  if (!session) {
    return (
      <button onClick={() => signIn('google')} className="btn btn-primary text-sm">
        Entrar com Google
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-slate-600">{session.user?.email}</span>
      <button onClick={() => signOut()} className="btn btn-ghost text-sm">Sair</button>
    </div>
  );
}
