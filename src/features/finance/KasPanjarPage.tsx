import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency } from '../../lib/format';
import type { Site } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

type Category = 'topup' | 'expense' | 'return' | 'adjustment';

const CATEGORY_LABEL: Record<Category, string> = {
  topup: 'Top-up',
  expense: 'Pengeluaran',
  return: 'Pengembalian',
  adjustment: 'Koreksi Manual',
};

interface BalanceRow {
  pic_user_id: string;
  pic_name: string;
  site_id: string;
  site_name: string;
  track: 'trading' | 'budidaya';
  balance: number;
}

interface HistoryRow {
  id: string;
  amount: number;
  category: Category;
  event_at: string;
  reversal_of: string | null;
  pic: { full_name: string } | null;
  site: { name: string } | null;
  poster: { full_name: string } | null;
}

interface UserOption {
  id: string;
  full_name: string;
  role: string | null;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

// Kas Panjar: saldo dihitung PER (PIC, site) — bukan satu angka per orang —
// supaya tidak tercampur lintas track kalau satu PIC ditugaskan ke lebih dari
// satu site (CLAUDE.md #1). Guard saldo negatif ada di DB (migration 0027).
// Owner bisa top-up/koreksi siapa pun; Lead/Staf cuma bisa catat
// pengeluaran/pengembalian MILIK SENDIRI (RLS, bukan cuma UI).
export function KasPanjarPage() {
  const { profile, profileLoading, session } = useAuth();
  const isOwner = profile?.role === 'owner';
  const isInvestor = profile?.role === 'investor';

  const [sites, setSites] = useState<Site[]>([]);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formSiteId, setFormSiteId] = useState('');
  const [formPicId, setFormPicId] = useState(''); // owner saja
  // Default 'expense' dulu (valid utk kedua role) -- nilai final ('topup'
  // utk owner) di-set di effect di bawah setelah profile selesai resolve,
  // supaya tidak ikut kena bug closure-beku yang sama seperti loadAll().
  const [formCategory, setFormCategory] = useState<Category>('expense');
  const [formAmount, setFormAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState('');

  async function loadAll() {
    setLoading(true);
    setLoadError(null);

    const [{ data: siteData }, { data: balanceData, error: balanceError }, { data: historyData }, { data: userData }] =
      await Promise.all([
        supabase.from('sites').select('id, name, type').order('name'),
        supabase.from('v_cash_balance').select('*').order('site_name'),
        supabase
          .from('cash_ledger')
          .select(
            'id, amount, category, event_at, reversal_of, pic:users!cash_ledger_pic_user_id_fkey(full_name), site:sites(name), poster:users!cash_ledger_created_by_fkey(full_name)',
          )
          .order('event_at', { ascending: false })
          .limit(50),
        isOwner ? supabase.from('users').select('id, full_name, role') : Promise.resolve({ data: null }),
      ]);

    setSites((siteData as Site[]) ?? []);
    if (balanceError) {
      setLoadError(balanceError.message);
    } else {
      setBalances((balanceData as BalanceRow[]) ?? []);
    }
    setHistory((historyData as unknown as HistoryRow[]) ?? []);
    setUsers(((userData as UserOption[] | null) ?? []).filter((u) => u.role === 'lead_lapangan' || u.role === 'staf_lapangan'));
    setLoading(false);
  }

  // Tunggu authContext selesai fetch profile (role) dulu -- kalau tidak,
  // loadAll() bisa terlanjur jalan dengan isOwner=false (closure beku) saat
  // profile belum resolve (mis. akses langsung URL / refresh halaman), dan
  // dropdown PIC owner jadi kosong permanen walau sudah login sebagai owner
  // (ketahuan lewat uji Playwright end-to-end, tidak muncul kalau navigasi
  // client-side dari halaman lain karena profile sudah ke-cache duluan).
  useEffect(() => {
    if (profileLoading) return;
    setFormCategory(isOwner ? 'topup' : 'expense');
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading]);

  const myBalances = isOwner ? balances : balances.filter((b) => b.pic_user_id === session?.user.id);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const amountNum = Number(formAmount);
    if (!formSiteId || !amountNum || submitting || !session?.user.id) return;
    if (isOwner && !formPicId) return;

    // expense/return dicatat sebagai pengurang saldo (amount negatif) di
    // ledger walau usernya mengetik angka positif di form — lebih natural
    // buat orang lapangan daripada minta mereka mengetik minus.
    const signedAmount = formCategory === 'expense' ? -Math.abs(amountNum) : Math.abs(amountNum);
    const picId = isOwner ? formPicId : session.user.id;

    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.from('cash_ledger').insert({
      site_id: formSiteId,
      pic_user_id: picId,
      created_by: session.user.id,
      category: formCategory,
      amount: signedAmount,
      event_at: new Date().toISOString(),
    });

    setSubmitting(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFeedback({ variant: 'success', message: `${CATEGORY_LABEL[formCategory]} ${formatCurrency(Math.abs(amountNum))} berhasil dicatat.` });
    setFormAmount('');
    setFormPicId('');
    await loadAll();
  }

  async function handleReverse(row: HistoryRow) {
    if (!reversalReason.trim() || submitting) return;
    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.rpc('create_cash_reversal', { p_ledger_id: row.id, p_reason: reversalReason.trim() });

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

  const reversedIds = new Set(history.filter((h) => h.reversal_of).map((h) => h.reversal_of as string));

  const balanceColumns: DataTableColumn<BalanceRow>[] = [
    ...(isOwner ? [{ key: 'pic_name', header: 'PIC', render: (row: BalanceRow) => row.pic_name }] : []),
    { key: 'site_name', header: 'Site', render: (row) => row.site_name },
    {
      key: 'track',
      header: 'Track',
      render: (row) => <StatusBadge label={row.track === 'trading' ? 'Trading' : 'Budidaya'} tone={row.track === 'trading' ? 'info' : 'success'} />,
    },
    { key: 'balance', header: 'Saldo', render: (row) => formatCurrency(row.balance) },
  ];

  const historyColumns: DataTableColumn<HistoryRow>[] = [
    { key: 'event_at', header: 'Waktu', render: (row) => formatDateTime(row.event_at) },
    ...(isOwner ? [{ key: 'pic', header: 'PIC', render: (row: HistoryRow) => row.pic?.full_name ?? '-' }] : []),
    { key: 'site', header: 'Site', render: (row) => row.site?.name ?? '-' },
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
    { key: 'poster', header: 'Dicatat oleh', render: (row) => row.poster?.full_name ?? '-' },
    ...(isOwner
      ? [
          {
            key: 'aksi',
            header: 'Aksi',
            render: (row: HistoryRow) => {
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
                      className="rounded bg-app-accent hover:bg-app-accent-hover px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Konfirmasi
                    </button>
                    <button
                      type="button"
                      onClick={() => setReversingId(null)}
                      className="rounded border border-app-border px-2 py-1 text-xs text-app-muted hover:bg-app-soft"
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

  const availableCategories: Category[] = isOwner ? ['topup', 'expense', 'return', 'adjustment'] : ['expense', 'return'];

  if (isInvestor) {
    return (
      <div className="max-w-3xl space-y-2">
        <h1 className="text-xl font-semibold text-app-text">Finance &gt; Kas Panjar</h1>
        <AlertBanner variant="warning" title="Tidak relevan untuk Investor">
          Kas Panjar adalah kas operasional lapangan (PIC), bukan bagian dari laporan Finance untuk investor.
        </AlertBanner>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Finance &gt; Kas Panjar</h1>
        <p className="text-sm text-app-muted">
          Saldo kas lapangan per PIC per site. Koreksi lewat baris reversal, bukan mengubah baris asal.
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}>
          {feedback.message}
        </AlertBanner>
      )}
      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat saldo">
          {loadError}
        </AlertBanner>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-app-text">{isOwner ? 'Saldo Semua PIC' : 'Saldo Saya'}</h2>
        <DataTable
          columns={balanceColumns}
          rows={myBalances}
          getRowId={(row) => `${row.pic_user_id}:${row.site_id}`}
          emptyLabel={loading ? 'Memuat...' : 'Belum ada saldo.'}
        />
      </div>

      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
        <h2 className="text-sm font-semibold text-app-text">{isOwner ? 'Catat Transaksi Kas' : 'Catat Pengeluaran / Pengembalian'}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {isOwner && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">PIC *</span>
              <select value={formPicId} onChange={(e) => setFormPicId(e.target.value)} className={inputClass}>
                <option value="">Pilih PIC</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Site *</span>
            <select value={formSiteId} onChange={(e) => setFormSiteId(e.target.value)} className={inputClass}>
              <option value="">Pilih site</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.type})
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Jenis *</span>
            <select value={formCategory} onChange={(e) => setFormCategory(e.target.value as Category)} className={inputClass}>
              {availableCategories.map((c) => (
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
        </div>
        <button
          type="submit"
          disabled={submitting || !formSiteId || !formAmount || (isOwner && !formPicId)}
          className="rounded-md bg-app-accent hover:bg-app-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {submitting ? 'Menyimpan...' : 'Simpan'}
        </button>
      </form>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-app-text">Riwayat (50 terbaru)</h2>
        <DataTable columns={historyColumns} rows={history} getRowId={(row) => row.id} emptyLabel="Belum ada transaksi." />
      </div>
    </div>
  );
}
