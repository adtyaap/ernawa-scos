import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge, type BadgeTone } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency, todayLocalDate } from '../../lib/format';
import type { Site } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

type ReconStatus = 'pending_approval' | 'approved' | 'rejected';

const STATUS_LABEL: Record<ReconStatus, string> = {
  pending_approval: 'Menunggu Persetujuan',
  approved: 'Disetujui',
  rejected: 'Ditolak',
};
const STATUS_TONE: Record<ReconStatus, BadgeTone> = {
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'danger',
};

interface ReconciliationRow {
  id: string;
  period_end_date: string;
  physical_amount: number;
  system_balance: number;
  variance: number;
  status: ReconStatus;
  notes: string | null;
  approval_reason: string | null;
  created_at: string;
  site: { name: string } | null;
  pic: { full_name: string } | null;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

// Rekonsiliasi Kas (migration 0034) -- tutup periode + cocokkan Kas Panjar
// dengan kas fisik, beda dari saldo berjalan Kas Panjar (migration 0027) yang
// cuma running balance tanpa titik "resmi dicocokkan" yang terkunci.
//
// Desain (dikonfirmasi user): PIC lapangan SELF-reconcile (ajukan hitung
// fisik utk site sendiri, RPC create_cash_reconciliation menghitung
// system_balance/variance server-side -- tidak bisa dipalsukan client).
// Owner approve/reject (approve_cash_reconciliation): approve OTOMATIS
// membuat baris cash_ledger kategori 'adjustment' menyamakan saldo sistem ke
// fisik, DAN mengunci periode -- baris cash_ledger sebelum period_end_date
// utk (pic, site) itu tidak bisa direversal lagi lewat create_cash_reversal.
export function RekonsiliasiKasPage() {
  const { profile, profileLoading, session } = useAuth();
  const isOwner = profile?.role === 'owner';
  const isInvestor = profile?.role === 'investor';

  const [sites, setSites] = useState<Site[]>([]);
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formSiteId, setFormSiteId] = useState('');
  const [formPeriodEnd, setFormPeriodEnd] = useState(todayLocalDate);
  const [formPhysical, setFormPhysical] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [deciding, setDeciding] = useState(false);

  async function loadRows() {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from('cash_reconciliations')
      .select(
        'id, period_end_date, physical_amount, system_balance, variance, status, notes, approval_reason, created_at, site:sites(name), pic:users!cash_reconciliations_pic_user_id_fkey(full_name)',
      )
      .order('created_at', { ascending: false });

    if (error) {
      setLoadError(error.message);
    } else {
      setRows((data as unknown as ReconciliationRow[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (profileLoading) return;
    async function loadSites() {
      const { data } = await supabase.from('sites').select('id, name, type').order('name');
      setSites((data as Site[]) ?? []);
    }
    loadSites();
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const physical = Number(formPhysical);
    if (!formSiteId || !formPeriodEnd || formPhysical === '' || physical < 0 || submitting || !session?.user.id) return;

    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.rpc('create_cash_reconciliation', {
      p_site_id: formSiteId,
      p_period_end_date: formPeriodEnd,
      p_physical_amount: physical,
      p_notes: formNotes.trim() || undefined,
    });

    setSubmitting(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFeedback({ variant: 'success', message: 'Rekonsiliasi berhasil diajukan, menunggu persetujuan Owner.' });
    setFormPhysical('');
    setFormNotes('');
    await loadRows();
  }

  async function handleDecision(id: string, approve: boolean) {
    if (deciding) return;
    if (!approve && !decisionReason.trim()) return;

    setDeciding(true);
    setFeedback(null);

    const { error } = await supabase.rpc('approve_cash_reconciliation', {
      p_reconciliation_id: id,
      p_approve: approve,
      p_reason: decisionReason.trim() || undefined,
    });

    setDeciding(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFeedback({ variant: 'success', message: approve ? 'Rekonsiliasi disetujui, saldo & periode terkunci.' : 'Rekonsiliasi ditolak.' });
    setDecidingId(null);
    setDecisionReason('');
    await loadRows();
  }

  const pendingRows = rows.filter((r) => r.status === 'pending_approval');

  const columns: DataTableColumn<ReconciliationRow>[] = [
    { key: 'period_end_date', header: 'Periode', render: (row) => formatDate(row.period_end_date) },
    ...(isOwner ? [{ key: 'pic', header: 'PIC', render: (row: ReconciliationRow) => row.pic?.full_name ?? '-' }] : []),
    { key: 'site', header: 'Site', render: (row) => row.site?.name ?? '-' },
    { key: 'system_balance', header: 'Saldo Sistem', render: (row) => formatCurrency(row.system_balance) },
    { key: 'physical_amount', header: 'Kas Fisik', render: (row) => formatCurrency(row.physical_amount) },
    {
      key: 'variance',
      header: 'Selisih',
      render: (row) => (
        <span className={row.variance === 0 ? 'text-app-text' : row.variance > 0 ? 'text-app-success' : 'text-app-danger'}>
          {row.variance > 0 ? '+' : ''}
          {formatCurrency(row.variance)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusBadge label={STATUS_LABEL[row.status]} tone={STATUS_TONE[row.status]} />,
    },
    ...(isOwner
      ? [
          {
            key: 'aksi',
            header: 'Aksi',
            render: (row: ReconciliationRow) => {
              if (row.status !== 'pending_approval') return <span className="text-xs text-app-muted">-</span>;
              if (decidingId !== row.id) {
                return (
                  <button
                    type="button"
                    onClick={() => {
                      setDecidingId(row.id);
                      setDecisionReason('');
                      setFeedback(null);
                    }}
                    className="rounded px-2 py-1 text-xs font-medium text-app-accent hover:bg-app-accent/10"
                  >
                    Proses
                  </button>
                );
              }
              return (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)}
                    placeholder="Catatan (wajib kalau tolak)"
                    className={inputClass}
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleDecision(row.id, true)}
                      disabled={deciding}
                      className="rounded bg-app-accent hover:bg-app-accent-hover px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Setujui
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDecision(row.id, false)}
                      disabled={deciding || !decisionReason.trim()}
                      className="rounded bg-app-danger px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      Tolak
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecidingId(null)}
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

  if (isInvestor) {
    return (
      <div className="max-w-3xl space-y-2">
        <h1 className="text-xl font-semibold text-app-text">Finance &gt; Rekonsiliasi Kas</h1>
        <AlertBanner variant="warning" title="Tidak relevan untuk Investor">
          Rekonsiliasi Kas adalah kas operasional lapangan (PIC), bukan bagian dari laporan Finance untuk investor.
        </AlertBanner>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Finance &gt; Rekonsiliasi Kas</h1>
        <p className="text-sm text-app-muted">
          Cocokkan saldo Kas Panjar dengan kas fisik. Setelah disetujui Owner, periode itu terkunci — transaksi
          sebelumnya tidak bisa dikoreksi lagi.
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal'}>
          {feedback.message}
        </AlertBanner>
      )}
      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat">
          {loadError}
        </AlertBanner>
      )}

      {!isOwner && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
          <h2 className="text-sm font-semibold text-app-text">Ajukan Rekonsiliasi</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <span className="text-xs font-medium text-app-muted">Tanggal Periode *</span>
              <input type="date" value={formPeriodEnd} onChange={(e) => setFormPeriodEnd(e.target.value)} className={inputClass} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-app-muted">Jumlah Kas Fisik (Rp) *</span>
              <input
                type="number"
                min="0"
                step="1"
                value={formPhysical}
                onChange={(e) => setFormPhysical(e.target.value)}
                className={inputClass}
                placeholder="Hasil hitung uang fisik"
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Catatan (opsional)</span>
            <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} className={inputClass} />
          </label>
          <button
            type="submit"
            disabled={!formSiteId || !formPeriodEnd || formPhysical === '' || submitting}
            className="rounded-md bg-app-accent hover:bg-app-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {submitting ? 'Mengajukan...' : 'Ajukan Rekonsiliasi'}
          </button>
        </form>
      )}

      {isOwner && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-app-text">Menunggu Persetujuan ({pendingRows.length})</h2>
          <DataTable
            columns={columns}
            rows={pendingRows}
            getRowId={(row) => row.id}
            emptyLabel={loading ? 'Memuat...' : 'Tidak ada rekonsiliasi yang menunggu persetujuan.'}
          />
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-app-text">{isOwner ? 'Riwayat Sudah Diproses' : 'Riwayat Pengajuan Saya'}</h2>
        <DataTable
          columns={columns}
          rows={isOwner ? rows.filter((r) => r.status !== 'pending_approval') : rows}
          getRowId={(row) => row.id}
          emptyLabel={loading ? 'Memuat...' : 'Belum ada riwayat rekonsiliasi.'}
        />
      </div>
    </div>
  );
}
