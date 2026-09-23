import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency } from '../../lib/format';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

type Category = 'settlement_in' | 'kas_panjar_topup_out' | 'supplier_payment' | 'opex' | 'other_in' | 'other_out' | 'adjustment';
type Track = 'trading' | 'budidaya';

// Kategori yang boleh diinput manual lewat form ini. settlement_in &
// kas_panjar_topup_out auto-tercatat lewat trigger DB dari Settlement/Kas
// Panjar (migration 0040) -- sengaja TIDAK ditawarkan di sini supaya tidak
// dobel-hitung. adjustment cuma lewat tombol "Koreksi" (reversal), bukan
// entri baru langsung.
const MANUAL_CATEGORIES: Category[] = ['supplier_payment', 'opex', 'other_in', 'other_out'];

const CATEGORY_LABEL: Record<Category, string> = {
  settlement_in: 'Pelunasan Piutang (otomatis)',
  kas_panjar_topup_out: 'Top-up Kas Panjar (otomatis)',
  supplier_payment: 'Bayar Supplier',
  opex: 'Biaya Operasional (Opex)',
  other_in: 'Masuk Lainnya',
  other_out: 'Keluar Lainnya',
  adjustment: 'Koreksi',
};

// Arah kas tiap kategori manual -- menentukan tanda (+/-) dari angka yang
// diketik user (selalu positif di form, lebih natural daripada minta user
// mengetik minus).
const CATEGORY_DIRECTION: Record<Category, 1 | -1> = {
  settlement_in: 1,
  kas_panjar_topup_out: -1,
  supplier_payment: -1,
  opex: -1,
  other_in: 1,
  other_out: -1,
  adjustment: 1,
};

interface LedgerRow {
  id: string;
  track: Track;
  amount: number;
  category: Category;
  description: string | null;
  event_at: string;
  reversal_of: string | null;
  created_by: string;
  poster: { full_name: string } | null;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

// Ledger Kas/Bank PERUSAHAAN (beda dari Kas Panjar yang per-PIC/site) --
// saldo gabungan (bukan multi-rekening), breakdown WAJIB per track (CLAUDE.md
// #1). Owner: baca+tulis penuh (RLS company_cash_ledger owner-only).
// Investor: baca-saja lewat investor_company_cash_ledger() (tidak pernah
// SELECT tabel mentah, pola sama seperti Finance investor lainnya, migration
// 0022). Lead/Staf: tidak relevan (data finansial level perusahaan, bukan
// operasional lapangan) -- sama seperti Kas Panjar mengecualikan Investor.
export function KasBankPerusahaanPage() {
  const { profile, profileLoading, session } = useAuth();
  const isOwner = profile?.role === 'owner';
  const isInvestor = profile?.role === 'investor';

  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formTrack, setFormTrack] = useState<Track>('trading');
  const [formCategory, setFormCategory] = useState<Category>('opex');
  const [formAmount, setFormAmount] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  async function loadAll() {
    setLoading(true);
    setLoadError(null);

    const { data, error } = isOwner
      ? await supabase
          .from('company_cash_ledger')
          .select('id, track, amount, category, description, event_at, reversal_of, created_by, poster:users!company_cash_ledger_created_by_fkey(full_name)')
          .order('event_at', { ascending: false })
      : await supabase.rpc('investor_company_cash_ledger');

    if (error) {
      setLoadError(error.message);
    } else {
      setRows((data as unknown as LedgerRow[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (profileLoading) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const amountNum = Number(formAmount);
    if (!amountNum || submitting || !session?.user.id) return;

    const signedAmount = Math.abs(amountNum) * CATEGORY_DIRECTION[formCategory];

    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.from('company_cash_ledger').insert({
      track: formTrack,
      category: formCategory,
      amount: signedAmount,
      description: formDescription.trim() || null,
      created_by: session.user.id,
      event_at: new Date().toISOString(),
    });

    setSubmitting(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFeedback({ variant: 'success', message: `${CATEGORY_LABEL[formCategory]} ${formatCurrency(Math.abs(amountNum))} berhasil dicatat.` });
    setFormAmount('');
    setFormDescription('');
    await loadAll();
  }

  async function handleReverse(row: LedgerRow) {
    if (!reversalReason.trim() || submitting) return;
    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.rpc('create_company_cash_reversal', { p_id: row.id, p_reason: reversalReason.trim() });

    setSubmitting(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFeedback({ variant: 'success', message: 'Koreksi berhasil dicatat sebagai baris reversal.' });
    setReversingId(null);
    setReversalReason('');
    await loadAll();
  }

  const reversedIds = new Set(rows.filter((r) => r.reversal_of).map((r) => r.reversal_of as string));

  const balancePerTrack: Record<Track, number> = { trading: 0, budidaya: 0 };
  for (const r of rows) balancePerTrack[r.track] += r.amount;
  const balanceTotal = balancePerTrack.trading + balancePerTrack.budidaya;

  const historyColumns: DataTableColumn<LedgerRow>[] = [
    { key: 'event_at', header: 'Waktu', render: (row) => formatDateTime(row.event_at) },
    {
      key: 'track',
      header: 'Track',
      render: (row) => <StatusBadge label={row.track === 'trading' ? 'Trading' : 'Budidaya'} tone={row.track === 'trading' ? 'info' : 'success'} />,
    },
    {
      key: 'category',
      header: 'Jenis',
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge label={row.reversal_of ? 'Reversal' : CATEGORY_LABEL[row.category]} tone={row.reversal_of ? 'warning' : 'neutral'} />
          {reversedIds.has(row.id) && <StatusBadge label="Dikoreksi" tone="danger" />}
        </div>
      ),
    },
    { key: 'amount', header: 'Jumlah', render: (row) => formatCurrency(row.amount) },
    { key: 'description', header: 'Keterangan', render: (row) => row.description ?? '-' },
    { key: 'poster', header: 'Dicatat oleh', render: (row) => row.poster?.full_name ?? '-' },
    ...(isOwner
      ? [
          {
            key: 'aksi',
            header: 'Aksi',
            render: (row: LedgerRow) => {
              if (row.reversal_of || reversedIds.has(row.id)) return <span className="text-xs text-app-muted">-</span>;
              if (reversingId !== row.id) {
                return (
                  <button
                    type="button"
                    onClick={() => {
                      setReversingId(row.id);
                      setReversalReason('');
                      setFeedback(null);
                    }}
                    className="rounded px-2 py-1 text-xs font-medium text-app-accent hover:bg-app-accent/10"
                  >
                    Koreksi
                  </button>
                );
              }
              return (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={reversalReason}
                    onChange={(e) => setReversalReason(e.target.value)}
                    placeholder="Alasan koreksi (wajib)"
                    className={inputClass}
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleReverse(row)}
                      disabled={!reversalReason.trim() || submitting}
                      className="rounded bg-app-accent px-2 py-1 text-xs font-semibold text-black disabled:opacity-40"
                    >
                      Konfirmasi
                    </button>
                    <button
                      type="button"
                      onClick={() => setReversingId(null)}
                      className="rounded border border-app-border px-2 py-1 text-xs text-app-muted hover:bg-white/5"
                    >
                      Tutup
                    </button>
                  </div>
                </div>
              );
            },
          },
        ]
      : []),
  ];

  if (!isOwner && !isInvestor) {
    return (
      <div className="max-w-3xl space-y-2">
        <h1 className="text-xl font-semibold text-app-text">Finance &gt; Kas &amp; Bank Perusahaan</h1>
        <AlertBanner variant="warning" title="Tidak relevan untuk peran Anda">
          Halaman ini menampilkan data kas/bank level perusahaan, hanya untuk Owner dan Investor.
        </AlertBanner>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Finance &gt; Kas &amp; Bank Perusahaan</h1>
        <p className="text-sm text-app-muted">
          Saldo kas/bank gabungan perusahaan (bukan Kas Panjar per PIC). Pelunasan piutang &amp; top-up Kas Panjar tercatat otomatis; sisanya dicatat manual oleh Owner. Koreksi lewat baris reversal, bukan mengubah baris asal.
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}>
          {feedback.message}
        </AlertBanner>
      )}
      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat data">
          {loadError}
        </AlertBanner>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-app-border bg-app-panel p-4">
          <p className="text-xs font-medium text-app-muted">Saldo Trading</p>
          <p className="text-lg font-semibold text-app-text">{formatCurrency(balancePerTrack.trading)}</p>
        </div>
        <div className="rounded-lg border border-app-border bg-app-panel p-4">
          <p className="text-xs font-medium text-app-muted">Saldo Budidaya</p>
          <p className="text-lg font-semibold text-app-text">{formatCurrency(balancePerTrack.budidaya)}</p>
        </div>
        <div className="rounded-lg border border-app-border bg-app-panel p-4">
          <p className="text-xs font-medium text-app-muted">Total Gabungan</p>
          <p className="text-lg font-semibold text-app-text">{formatCurrency(balanceTotal)}</p>
        </div>
      </div>

      {isOwner && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4">
          <h2 className="text-sm font-semibold text-app-text">Catat Transaksi Manual</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Track *</span>
              <select value={formTrack} onChange={(e) => setFormTrack(e.target.value as Track)} className={inputClass}>
                <option value="trading">Trading</option>
                <option value="budidaya">Budidaya</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Jenis *</span>
              <select value={formCategory} onChange={(e) => setFormCategory(e.target.value as Category)} className={inputClass}>
                {MANUAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Jumlah (Rp) *</span>
              <input
                type="number"
                min="1"
                step="1"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                className={inputClass}
                placeholder="Mis. 500000"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Keterangan</span>
              <input
                type="text"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className={inputClass}
                placeholder="Mis. Bayar listrik kantor bulan ini"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={submitting || !formAmount}
            className="rounded-md bg-app-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {submitting ? 'Menyimpan...' : 'Simpan'}
          </button>
        </form>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-app-text">Riwayat</h2>
        <DataTable columns={historyColumns} rows={rows} getRowId={(row) => row.id} emptyLabel={loading ? 'Memuat...' : 'Belum ada transaksi.'} />
      </div>
    </div>
  );
}
