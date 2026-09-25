import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CircleHelp, Clock, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { KPICard } from '../../components/shared/KPICard';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency } from '../../lib/format';
import type { SupplierPayableRow, Track } from '../../types/domain';

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

type Filter = 'belum' | 'lunas' | 'semua';

// Utang Pemasok (migration 0049). Termin mengikuti Supplier Management:
// termin 0 = tunai (lunas saat terima, bukan utang); termin kosong = belum
// diklasifikasi (tidak dijumlahkan ke utang, ditampilkan terpisah — tidak
// diasumsikan). "Tandai Lunas" Owner-only & tidak bisa dibatalkan (trigger DB).
// Menandai lunas TIDAK mencatat kas otomatis — pembayaran via transfer dicatat
// Owner di Kas & Bank Perusahaan (kategori Bayar Pemasok); via Kas Panjar sudah
// tercatat keluar saat top-up.
export function UtangPemasokPage() {
  const { profile, profileLoading } = useAuth();
  const isOwner = profile?.role === 'owner';
  const isInvestor = profile?.role === 'investor';

  const [rows, setRows] = useState<SupplierPayableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [track, setTrack] = useState<Track>('trading');
  const [filter, setFilter] = useState<Filter>('belum');
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function load() {
    setLoadError(null);
    const { data, error } = isInvestor
      ? await supabase.rpc('investor_supplier_payables')
      : await supabase.from('v_supplier_payables').select('*');
    if (error) setLoadError(error.message);
    else setRows(((data as SupplierPayableRow[]) ?? []).filter((r) => r.amount > 0));
    setLoading(false);
  }

  useEffect(() => {
    if (profileLoading) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading, isInvestor]);

  const trackRows = useMemo(() => rows.filter((r) => r.track === track), [rows, track]);

  const kpis = useMemo(() => {
    const unpaidTerm = trackRows.filter((r) => !r.supplier_paid_at && (r.payment_term_days ?? 0) > 0);
    const overdue = unpaidTerm.filter((r) => (r.days_until_due ?? 0) < 0);
    const unclassified = trackRows.filter((r) => !r.supplier_paid_at && r.payment_term_days === null);
    return {
      outstanding: unpaidTerm.reduce((s, r) => s + r.amount, 0),
      outstandingCount: unpaidTerm.length,
      overdue: overdue.reduce((s, r) => s + r.amount, 0),
      overdueCount: overdue.length,
      unclassified: unclassified.reduce((s, r) => s + r.amount, 0),
      unclassifiedCount: unclassified.length,
      paid: trackRows.filter((r) => r.supplier_paid_at).reduce((s, r) => s + r.amount, 0),
    };
  }, [trackRows]);

  const visible = useMemo(() => {
    const list = trackRows.filter((r) => {
      const isCash = r.payment_term_days === 0;
      if (filter === 'belum') return !r.supplier_paid_at && !isCash;
      if (filter === 'lunas') return Boolean(r.supplier_paid_at) || isCash;
      return true;
    });
    return list.sort((a, b) => (a.days_until_due ?? 9999) - (b.days_until_due ?? 9999));
  }, [trackRows, filter]);

  async function handleMarkPaid(row: SupplierPayableRow) {
    if (markingId) return;
    setMarkingId(row.receiving_transaction_id);
    setFeedback(null);
    const { data, error } = await supabase
      .from('receiving_transactions')
      .update({ supplier_paid_at: new Date().toISOString() })
      .eq('id', row.receiving_transaction_id)
      .select('id');
    setMarkingId(null);
    if (error || !data || data.length === 0) {
      setFeedback({
        variant: 'danger',
        message: error?.message ?? 'Tidak ada data yang berubah. Kemungkinan Anda tidak punya izin untuk menandai lunas.',
      });
      return;
    }
    setFeedback({
      variant: 'success',
      message: `Pembelian dari ${row.supplier_name} (${formatDate(row.transaction_date)}) ditandai lunas. Catat pembayarannya di Kas & Bank Perusahaan kalau dibayar via transfer.`,
    });
    await load();
  }

  const columns: DataTableColumn<SupplierPayableRow>[] = [
    {
      key: 'supplier',
      header: 'Pemasok',
      render: (r) => (
        <div>
          <p className="font-medium">{r.supplier_name}</p>
          <p className="text-xs text-app-muted">{r.site_name}</p>
        </div>
      ),
    },
    { key: 'date', header: 'Tgl Terima', render: (r) => formatDate(r.transaction_date) },
    { key: 'term', header: 'Termin', render: (r) => (r.payment_term_days === null ? '-' : `${r.payment_term_days} hari`) },
    { key: 'due', header: 'Jatuh Tempo', render: (r) => formatDate(r.due_date) },
    { key: 'amount', header: 'Jumlah', render: (r) => formatCurrency(r.amount) },
    {
      key: 'status',
      header: 'Status',
      render: (r) => {
        if (r.supplier_paid_at) return <StatusBadge label={`Lunas ${formatDate(r.supplier_paid_at)}`} tone="success" />;
        if (r.payment_term_days === 0) return <StatusBadge label="Tunai (lunas saat terima)" tone="success" />;
        if (r.payment_term_days === null) return <StatusBadge label="Termin belum diisi" tone="warning" />;
        const d = r.days_until_due ?? 0;
        if (d > 0) return <StatusBadge label={`${d} hari lagi`} tone="info" />;
        if (d === 0) return <StatusBadge label="Jatuh tempo hari ini" tone="danger" />;
        return <StatusBadge label={`Terlambat ${Math.abs(d)} hari`} tone="danger" />;
      },
    },
    ...(isOwner
      ? [
          {
            key: 'aksi',
            header: 'Aksi',
            render: (r: SupplierPayableRow) =>
              r.supplier_paid_at || r.payment_term_days === 0 ? (
                <span className="text-xs text-app-muted">-</span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleMarkPaid(r)}
                  disabled={markingId !== null}
                  className="rounded px-2 py-1 text-xs font-medium text-app-success hover:bg-app-success/10 disabled:opacity-40"
                >
                  {markingId === r.receiving_transaction_id ? 'Menyimpan...' : 'Tandai Lunas'}
                </button>
              ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Finance &gt; Utang Pemasok</h1>
        <p className="text-sm text-app-muted">
          Pembelian bertermin yang belum dibayar ke pemasok, diurutkan paling mendesak. Termin diatur di Source &gt;
          Supplier Management.
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal'}>
          {feedback.message}
        </AlertBanner>
      )}
      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat utang pemasok">
          {loadError}
        </AlertBanner>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={track}
          onChange={(e) => setTrack(e.target.value as Track)}
          className="rounded-md border border-app-border bg-app-bg px-3 py-1.5 text-sm text-app-text"
        >
          <option value="trading">Trading</option>
          <option value="budidaya">Budidaya</option>
        </select>
        <div className="inline-flex gap-1 rounded-md bg-app-soft p-1">
          {(['belum', 'lunas', 'semua'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-sm ${
                filter === f ? 'bg-app-panel font-semibold text-app-accent shadow-sm' : 'text-app-muted hover:text-app-text'
              }`}
            >
              {f === 'belum' ? 'Belum Lunas' : f === 'lunas' ? 'Lunas' : 'Semua'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard icon={Wallet} label="Utang Belum Dibayar" value={formatCurrency(kpis.outstanding)} note={`${kpis.outstandingCount} nota bertermin`} />
        <KPICard icon={AlertTriangle} label="Lewat Jatuh Tempo" value={formatCurrency(kpis.overdue)} note={`${kpis.overdueCount} nota`} />
        <KPICard
          icon={CircleHelp}
          label="Termin Belum Diisi"
          value={formatCurrency(kpis.unclassified)}
          note={`${kpis.unclassifiedCount} nota — tidak dihitung sbg utang`}
        />
        <KPICard icon={Clock} label="Sudah Lunas" value={formatCurrency(kpis.paid)} />
      </div>

      {kpis.unclassifiedCount > 0 && (
        <AlertBanner variant="warning" title="Ada pemasok yang terminnya belum diisi">
          {formatCurrency(kpis.unclassified)} pembelian belum bisa dinilai sebagai utang atau tunai. Isi Termin Bayar di Source
          &gt; Supplier Management (0 = tunai di tempat).
        </AlertBanner>
      )}

      <DataTable
        columns={columns}
        rows={visible}
        getRowId={(r) => r.receiving_transaction_id}
        emptyLabel={loading ? 'Memuat...' : filter === 'belum' ? 'Tidak ada utang pemasok yang belum dibayar.' : 'Tidak ada data.'}
      />
    </div>
  );
}
