import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

const MIN_LENGTH = 10;

// Ganti katasandi akun sendiri (mis. setelah menerima katasandi sementara dari
// Owner). Memakai supabase.auth.updateUser — hanya menyentuh akun yang sedang
// login, tidak butuh hak khusus.
export function GantiKatasandiPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;

    if (password.length < MIN_LENGTH) {
      setFeedback({ variant: 'danger', message: `Katasandi minimal ${MIN_LENGTH} karakter.` });
      return;
    }
    if (password !== confirm) {
      setFeedback({ variant: 'danger', message: 'Konfirmasi katasandi tidak sama.' });
      return;
    }

    setSaving(true);
    setFeedback(null);

    const { error } = await supabase.auth.updateUser({ password });

    setSaving(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setPassword('');
    setConfirm('');
    setFeedback({ variant: 'success', message: 'Katasandi berhasil diganti.' });
  }

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Admin &gt; Ganti Katasandi</h1>
        <p className="text-sm text-app-muted">Ganti katasandi akun yang sedang Anda pakai.</p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}>
          {feedback.message}
        </AlertBanner>
      )}

      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Katasandi baru *</span>
          <input
            id="password-baru"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Ulangi katasandi baru *</span>
          <input
            id="password-konfirmasi"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={saving || !password || !confirm}
          className="rounded-md bg-app-accent hover:bg-app-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {saving ? 'Menyimpan...' : 'Ganti Katasandi'}
        </button>
      </form>
    </div>
  );
}
