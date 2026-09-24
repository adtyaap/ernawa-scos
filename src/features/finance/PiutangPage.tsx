import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatCurrency, todayLocalDate } from '../../lib/format';
import { downloadCsv } from '../../lib/exportCsv';
import type { SettlementAgingRow } from '../../types/domain';

// Baca dari v_settlements_aging (migration 0009), filter settled_at IS NULL
// (yang sudah lunas tidak relevan untuk worklist piutang). Badge hijau/merah
// murni dari tanda days_until_due — tidak ada status "jatuh tempo hari ini"
// terpisah, sesuai instruksi (cuma 2 warna).
//
// Tombol "Tandai Lunas" HANYA untuk owner (RLS settlements UPDATE = owner-
// only, tanpa pengecualian kolom apa pun, beda dari demands/deliveries).
export function PiutangPage() {
  const { profile, profileLoading } = useAuth();
  const isOwner = profile?.role === 'owner';
  const isInvestor = profile?.role === 'investor';

  const [rows, setRows] = useState<SettlementAgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [markingId, setMarkingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadAging() {
    setLoading(true);
    setLoadError(null);

    // Investor membaca lewat fungsi SECURITY DEFINER (migration 0022); role
    // lain membaca view langsung (security_invoker, ter-scope RLS mereka).
    const source = isInvestor ? supabase.rpc('investor_settlements_aging') : supabase.from('v_settlements_aging').select('*');
    const { data, error } = await source.is('settled_at', null).order('days_until_due', { ascending: true });

    if (error) {
      setLoadError(error.message);
    } else {
      setRows((data as SettlementAgingRow[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (profileLoading) return;
    loadAging();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading, isInvestor]);

  async function handleMarkPaid(row: SettlementAgingRow) {
    if (markingId) return;
    setMarkingId(row.settlement_id);
    setFeedback(null);

    // .select() supaya jumlah baris yang benar-benar berubah bisa dicek: RLS
    // yang menolak UPDATE tidak melempar error, cuma menghasilkan 0 baris.
    const { data, error } = await supabase
      .from('settlements')
      .update({ settled_at: new Date().toISOString() })
      .eq('id', row.settlement_id)
      .select('id');

    if (error || !data || data.length === 0) {
      setFeedback({
        variant: 'danger',
        message: error?.message ?? 'Tidak ada data yang berubah. Kemungkinan Anda tidak punya izin untuk menandai lunas.',
      });
      setMarkingId(null);
      return;
    }

    setFeedback({ variant: 'success', message: `Settlement ${row.customer_name} ditandai lunas.` });
    setMarkingId(null);

    // Reload dari Supabase, BUKAN optimistic update lokal.
    await loadAging();
  }

  function handleExport() {
    downloadCsv(`piutang-aging-${todayLocalDate()}.csv`, rows, [
      { header: 'Customer', value: (row) => row.customer_name },
      { header: 'Jumlah (Rp)', value: (row) => row.amount },
      { header: 'Jatuh Tempo', value: (row) => row.due_date },
      { header: 'Sisa Hari', value: (row) => row.days_until_due },
    ]);
  }

  const columns: DataTableColumn<SettlementAgingRow>[] = [
    { key: 'customer_name', header: 'Customer' },
    { key: 'amount', header: 'Jumlah', render: (row) => formatCurrency(row.amount) },
    {
      key: 'due_date',
      header: 'Jatuh Tempo',
      render: (row) =>
        row.due_date
          ? new Date(row.due_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
          : '-',
    },
    {
      key: 'days_until_due',
      header: 'Sisa Hari',
      render: (row) => {
        if (row.days_until_due === null) return '-';
        // H+0 (jatuh tempo persis hari ini) sengaja masuk kategori merah,
        // bukan hijau — tetap 2 warna, cuma ambang batasnya digeser.
        if (row.days_until_due > 0) {
          return <StatusBadge label={`${row.days_until_due} hari lagi`} tone="success" />;
        }
        if (row.days_until_due === 0) {
          return <StatusBadge label="Jatuh tempo hari ini" tone="danger" />;
        }
        return <StatusBadge label={`Terlambat ${Math.abs(row.days_until_due)} hari`} tone="danger" />;
      },
    },
    ...(isOwner
      ? [
          {
            key: 'aksi',
            header: 'Aksi',
            render: (row: SettlementAgingRow) => (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => handleMarkPaid(row)}
                  disabled={markingId === row.settlement_id}
                  className="rounded px-2 py-1 text-xs font-medium text-app-success hover:bg-app-success/10 disabled:opacity-40"
                >
                  {markingId === row.settlement_id ? 'Menyimpan...' : 'Tandai Lunas'}
                </button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-app-text">Finance &gt; Piutang &amp; Aging</h1>
          <p className="text-sm text-app-muted">Settlement mode termin yang belum lunas, diurutkan paling mendesak.</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={rows.length === 0}
          className="flex items-center gap-1.5 rounded-md border border-app-border px-3 py-1.5 text-xs font-medium text-app-muted hover:bg-app-soft disabled:opacity-40"
        >
          <Download size={14} /> Unduh CSV
        </button>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal'}>
          {feedback.message}
        </AlertBanner>
      )}

      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat piutang">
          {loadError}
        </AlertBanner>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.settlement_id}
        emptyLabel={loading ? 'Memuat...' : 'Tidak ada piutang outstanding.'}
      />
    </div>
  );
}
