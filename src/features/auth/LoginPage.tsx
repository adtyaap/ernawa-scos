import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner } from '../../components/shared/AlertBanner';

// Login minimal: email+password -> signInWithPassword(). Sesi disimpan
// otomatis oleh supabase-js (localStorage); RequireAuth mendengarkan
// perubahan sesi lewat AuthProvider dan otomatis me-render AppShell begitu
// login berhasil — tidak perlu redirect manual di sini.
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-app-bg px-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-app-border bg-app-panel p-6">
        <div>
          <p className="text-lg font-bold text-app-text">
            Lobster SC<span className="text-app-accent">.OS</span>
          </p>
          <p className="text-xs text-app-muted">Ernawa — masuk untuk melanjutkan</p>
        </div>

        {error && (
          <AlertBanner variant="danger" title="Gagal masuk">
            {error}
          </AlertBanner>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-app-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {submitting ? 'Memproses...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}
