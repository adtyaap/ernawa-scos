import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatCurrency } from '../../lib/format';
import type { SettlementAgingRow } from '../../types/domain';

// Baca dari v_settlements_aging (migration 0009), filter settled_at IS NULL
// (yang sudah lunas tidak relevan untuk worklist piutang). Badge hijau/merah
// murni dari tanda days_until_due — tidak ada status "jatuh tempo hari ini"
// terpisah, sesuai instruksi (cuma 2 warna).
//
// Tombol "Tandai Lunas" HANYA untuk owner (RLS settlements UPDATE = owner-
// only, tanpa pengecualian kolom apa pun, beda dari demands/deliveries).
export function PiutangPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [rows, setRows] = useState<SettlementAgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [markingId, setMarkingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadAging() {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from('v_settlements_aging')
      .select('*')
      .is('settled_at', null)
      .order('days_until_due', { ascending: true });

    if (error) {
      setLoadError(error.message);
    } else {
      setRows((data as SettlementAgingRow[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadAging();
  }, []);

  async function handleMarkPaid(row: SettlementAgingRow) {
    if (markingId) return;
    setMarkingId(row.settlement_id);
    setFeedback(null);

    const { error } = await supabase
      .from('settlements')
      .update({ settled_at: new Date().toISOString() })
      .eq('id', row.settlement_id);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      setMarkingId(null);
      return;
    }

    setFeedback({ variant: 'success', message: `Settlement ${row.customer_name} ditandai lunas.` });
    setMarkingId(null);

    // Reload dari Supabase, BUKAN optimistic update lokal.
    await loadAging();
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
      <div>
        <h1 className="text-xl font-semibold text-app-text">Finance &gt; Piutang &amp; Aging</h1>
        <p className="text-sm text-app-muted">Settlement mode termin yang belum lunas, diurutkan paling mendesak.</p>
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
