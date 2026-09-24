import { useState, type FormEvent } from 'react';
import { ArrowRight, Waves } from 'lucide-react';
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

  const inputClass =
    'w-full rounded-md bg-app-soft px-3 py-2.5 text-sm text-app-text placeholder:text-app-muted/70 focus:bg-app-panel focus:outline-none focus:ring-2 focus:ring-app-accent';

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-app-soft via-app-bg to-app-soft-strong/60">
      <header className="flex h-14 items-center gap-3 bg-app-panel px-8 shadow-[0_1px_8px_rgba(0,0,0,0.06)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-app-accent text-white">
          <Waves size={18} />
        </div>
        <span className="text-base font-bold tracking-tight text-app-text">Lobster SC.OS</span>
        <span className="text-sm font-medium text-app-accent">Ernawa</span>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md overflow-hidden rounded-lg bg-app-panel shadow-lg">
          <div className="space-y-1 bg-app-bg px-8 pb-6 pt-8">
            <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-app-text">Masuk ke Workspace</h1>
            <p className="text-sm text-app-muted">Sistem operasional rantai pasok lobster Ernawa</p>
          </div>

          <div className="space-y-5 px-8 py-6">
            {error && (
              <AlertBanner variant="danger" title="Gagal masuk">
                {error}
              </AlertBanner>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-app-text">
                  Email <span className="text-app-danger">*</span>
                </span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="nama@ernawa.id"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-app-text">
                  Katasandi <span className="text-app-danger">*</span>
                </span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                />
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-app-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-app-accent-hover disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Masuk'}
                {!submitting && <ArrowRight size={16} />}
              </button>
            </form>
          </div>
        </div>
      </main>

      <footer className="bg-app-panel px-8 py-3 text-xs text-app-muted">© Ernawa — Lobster SC.OS</footer>
    </div>
  );
}
