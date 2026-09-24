import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatKg } from '../../lib/format';
import type { Site } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface LedgerRow {
  id: string;
  movement_type: string;
  qty_kg: number;
  event_at: string;
  created_at: string;
  reversal_of: string | null;
  batch_line: {
    batch: { site_id: string; tank: { name: string } | null } | null;
    lot: { product: { name: string } | null } | null;
  } | null;
}

const MOVEMENT_LABELS: Record<string, string> = {
  receive: 'Penerimaan',
  mortality: 'Mortalitas',
  shrinkage: 'Penyusutan',
  delivery: 'Pengiriman',
  reject: 'Reject',
  transfer_in: 'Transfer Masuk',
  transfer_out: 'Transfer Keluar',
  adjustment: 'Koreksi',
};

const REVERSIBLE = new Set(['receive', 'mortality', 'shrinkage', 'reject']);
const ROW_PAGE = 50;

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

// Koreksi ledger lewat reversal (CLAUDE.md #3): tidak ada UPDATE/DELETE,
// RPC create_ledger_reversal (migration 0015) menambah baris baru dan mencatat
// alasan di audit_log. Hanya owner (dijaga RLS di DB; UI ini cuma
// menyembunyikan). Hanya penerimaan dan mortalitas yang bisa dikoreksi di
// sini; delivery butuh alur sendiri supaya tidak tidak-sinkron dengan
// delivery_allocations. Data dibatasi per site sehingga tidak tercampur
// antar track (CLAUDE.md #1).
export function KoreksiLedgerPage() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [rowLimit, setRowLimit] = useState(ROW_PAGE);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  useEffect(() => {
    supabase
      .from('sites')
      .select('id, name, type')
      .order('name')
      .then(({ data }) => setSites((data as Site[]) ?? []));
  }, []);

  // Filter site di server (inner join). Urutan created_at desc menjamin baris
  // reversal (lebih baru) selalu ikut termuat bersama baris aslinya, jadi
  // penanda "Dikoreksi" tidak pernah salah karena batas baris.
  async function loadLedger(siteId: string, limit: number = rowLimit) {
    if (!siteId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from('inventory_ledger')
      .select(
        'id, movement_type, qty_kg, event_at, created_at, reversal_of, batch_line:batch_lines!inner(batch:batches!inner(site_id, tank:tanks(name)), lot:receiving_lots(product:products(name)))',
      )
      .eq('batch_line.batch.site_id', siteId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      setLoadError(error.message);
      setRows([]);
    } else {
      setRows((data as unknown as LedgerRow[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    setCorrectingId(null);
    setReason('');
    setFeedback(null);
    setRowLimit(ROW_PAGE);
    loadLedger(selectedSiteId, ROW_PAGE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId]);

  const reversedIds = new Set(rows.filter((row) => row.reversal_of).map((row) => row.reversal_of as string));
  const selectedSite = sites.find((s) => s.id === selectedSiteId);

  async function handleCorrect(row: LedgerRow) {
    if (!reason.trim() || submitting) return;

    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.rpc('create_ledger_reversal', { p_ledger_id: row.id, p_reason: reason.trim() });

    setSubmitting(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFeedback({ variant: 'success', message: 'Koreksi berhasil dicatat sebagai baris reversal.' });
    setCorrectingId(null);
    setReason('');
    await loadLedger(selectedSiteId);
  }

  if (!isOwner) {
    return (
      <div className="max-w-3xl space-y-2">
        <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Koreksi Ledger</h1>
        <AlertBanner variant="warning" title="Akses terbatas">
          Koreksi ledger hanya bisa dilakukan oleh Owner.
        </AlertBanner>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Inventory &gt; Koreksi Ledger</h1>
        <p className="text-sm text-app-muted">
          Koreksi penerimaan atau mortalitas yang salah input. Baris asli tidak diubah atau dihapus — koreksi dicatat
          sebagai baris baru beserta alasannya.
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Koreksi ditolak'}>
          {feedback.message}
        </AlertBanner>
      )}

      <div className="space-y-4 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
        <label className="block max-w-sm space-y-1">
          <span className="text-xs font-medium text-app-muted">Site *</span>
          <select value={selectedSiteId} onChange={(e) => setSelectedSiteId(e.target.value)} className={inputClass}>
            <option value="">Pilih site</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.type})
              </option>
            ))}
          </select>
          {selectedSite && (
            <StatusBadge
              label={selectedSite.type === 'trading' ? 'Trading' : 'Budidaya'}
              tone={selectedSite.type === 'trading' ? 'info' : 'success'}
            />
          )}
        </label>

        {!selectedSiteId && <p className="text-sm text-app-muted">Pilih site dulu untuk melihat pergerakan stok.</p>}
        {loading && <p className="text-sm text-app-muted">Memuat...</p>}
        {loadError && (
          <AlertBanner variant="danger" title="Gagal memuat ledger">
            {loadError}
          </AlertBanner>
        )}
        {selectedSiteId && !loading && !loadError && rows.length === 0 && (
          <p className="text-sm text-app-muted">Belum ada pergerakan stok di site ini.</p>
        )}

        <div className="space-y-2">
          {rows.map((row) => {
            const isReversal = row.reversal_of !== null;
            const alreadyReversed = reversedIds.has(row.id);
            const canCorrect = REVERSIBLE.has(row.movement_type) && !isReversal && !alreadyReversed;
            const isOpen = correctingId === row.id;

            return (
              <div key={row.id} className="rounded-md border border-app-border p-3">
                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1.5fr_2fr_1fr_1fr_auto]">
                  <div className="text-xs text-app-muted">{formatDateTime(row.created_at)}</div>
                  <div>
                    <p className="text-sm font-medium text-app-text">
                      {row.batch_line?.lot?.product?.name ?? '-'}
                    </p>
                    <p className="text-xs text-app-muted">{row.batch_line?.batch?.tank?.name ?? '-'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge
                      label={isReversal ? 'Reversal' : (MOVEMENT_LABELS[row.movement_type] ?? row.movement_type)}
                      tone={isReversal ? 'warning' : 'neutral'}
                    />
                    {alreadyReversed && <StatusBadge label="Dikoreksi" tone="danger" />}
                  </div>
                  <div className="text-sm text-app-text">{formatKg(row.qty_kg)}</div>
                  <div>
                    {canCorrect && !isOpen && (
                      <button
                        type="button"
                        onClick={() => {
                          setCorrectingId(row.id);
                          setReason('');
                          setFeedback(null);
                        }}
                        className="rounded px-2 py-1 text-xs font-medium text-app-accent hover:bg-app-accent/10"
                      >
                        Koreksi
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-3 space-y-2 border-t border-app-border pt-3">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-app-muted">Alasan koreksi *</span>
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={2}
                        className={inputClass}
                        placeholder="Mis. salah pilih tanggal / salah input qty"
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleCorrect(row)}
                        disabled={!reason.trim() || submitting}
                        className="rounded-md bg-app-accent hover:bg-app-accent-hover px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        {submitting ? 'Menyimpan...' : `Konfirmasi Koreksi ${formatKg(row.qty_kg)}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCorrectingId(null)}
                        className="rounded-md border border-app-border px-3 py-1.5 text-sm text-app-muted hover:bg-app-soft"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {selectedSiteId && rows.length >= rowLimit && (
          <button
            type="button"
            onClick={() => {
              const next = rowLimit + ROW_PAGE;
              setRowLimit(next);
              loadLedger(selectedSiteId, next);
            }}
            className="rounded-md border border-app-border px-3 py-1.5 text-sm text-app-muted hover:bg-app-soft"
          >
            Muat lebih banyak
          </button>
        )}
      </div>
    </div>
  );
}
