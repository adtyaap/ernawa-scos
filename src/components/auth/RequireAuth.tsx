import type { ReactNode } from 'react';
import { useAuth } from '../../lib/authContext';
import { LoginPage } from '../../features/auth/LoginPage';

// Tanpa sesi, RLS menolak SEMUA akses (anon tidak diberi policy apa pun) —
// jadi render LoginPage sebagai pengganti AppShell, bukan sekadar redirect,
// supaya tidak ada jalan untuk "melihat" shell tanpa sesi valid.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-app-bg text-sm text-app-muted">Memuat sesi...</div>;
  }

  if (!session) {
    return <LoginPage />;
  }

  return <>{children}</>;
}
