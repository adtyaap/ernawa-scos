import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatKg, todayLocalDate } from '../../lib/format';
import type { Track } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface PendingDelivery {
  id: string;
  planned_kg: number;
  demand_id: string | null;
  site: { name: string; type: Track } | null;
  demand: { customer: { name: string } | null; product: { name: string } | null } | null;
}

interface Draft {
  actual_weight_kg: string;
  delivered_at: string;
}

// Worklist deliveries yang belum ditimbang (actual_weight_kg masih null).
// SEMUA role (owner/lead_lapangan/staf_lapangan) boleh konfirmasi di sini —
// trigger fn_deliveries_restrict_field_update (migration 0003) sudah
// menjamin non-owner cuma bisa mengubah actual_weight_kg & delivered_at,
// jadi tidak perlu gating Edit owner-only seperti Supplier/Customer/Demand.
//
// Cuma menampilkan worklist yang PENDING (bukan riwayat yang sudah
// dikonfirmasi) — sesuai sifat halaman ini (action-oriented), bukan arsip.
//
// Asumsi v1 (sudah disepakati di proposal): 1 delivery = 1 demand penuh.
// Begitu delivery ber-demand dikonfirmasi timbang, demand langsung
// ditandai 'fulfilled' tanpa mengecek apakah actual_weight_kg cukup —
// dukungan fulfillment parsial ('partial') adalah gap yang sudah dicatat
// terpisah, bukan ditangani di sini.
export function KonfirmasiTimbangPage() {
  const [deliveries, setDeliveries] = useState<PendingDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadPendingDeliveries() {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from('deliveries')
      .select(
        'id, planned_kg, demand_id, site:sites(name, type), demand:demands(customer:customers(name), product:products(name))',
      )
      .is('actual_weight_kg', null)
      .is('cancelled_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      setLoadError(error.message);
    } else {
      setDeliveries((data as unknown as PendingDelivery[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadPendingDeliveries();
  }, []);

  function getDraft(id: string): Draft {
    return drafts[id] ?? { actual_weight_kg: '', delivered_at: todayLocalDate() };
  }

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...getDraft(id), ...patch } }));
  }

  async function handleConfirm(delivery: PendingDelivery) {
    if (confirmingId) return;
    const draft = getDraft(delivery.id);
    const weight = Number(draft.actual_weight_kg);

    // Mencerminkan CHECK (actual_weight_kg IS NULL OR actual_weight_kg >= 0)
    // — 0 valid (mis. tolakan/rusak total saat ditimbang), negatif tidak.
    if (draft.actual_weight_kg.trim() === '' || Number.isNaN(weight) || weight < 0) {
      setFeedback({ variant: 'danger', message: 'Berat aktual wajib diisi, boleh 0, tidak boleh negatif.' });
      return;
    }
    if (!draft.delivered_at) {
      setFeedback({ variant: 'danger', message: 'Tanggal pengiriman wajib diisi.' });
      return;
    }

    setConfirmingId(delivery.id);
    setFeedback(null);

    const { error } = await supabase
      .from('deliveries')
      .update({ actual_weight_kg: weight, delivered_at: draft.delivered_at })
      .eq('id', delivery.id);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      setConfirmingId(null);
      return;
    }

    // Transisi status demand adalah langkah SEKUNDER, non-blocking kalau
    // gagal — pencatatan timbang (yang inti) sudah sukses duluan.
    if (delivery.demand_id) {
      const { error: demandError } = await supabase
        .from('demands')
        .update({ status: 'fulfilled' })
        .eq('id', delivery.demand_id);

      if (demandError) {
        setFeedback({
          variant: 'warning',
          message: `Timbang berhasil dicatat, tapi status demand gagal diperbarui otomatis: ${demandError.message}. Perbarui manual lewat Demand Baru.`,
        });
        setConfirmingId(null);
        await loadPendingDeliveries();
        return;
      }
    }

    setFeedback({ variant: 'success', message: 'Timbang berhasil dikonfirmasi.' });
    setConfirmingId(null);

    // Reload dari Supabase, BUKAN optimistic update lokal — baris yang
    // baru dikonfirmasi otomatis hilang dari worklist ini (sudah tidak
    // memenuhi filter actual_weight_kg IS NULL).
    await loadPendingDeliveries();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Deliver &gt; Konfirmasi Timbang</h1>
        <p className="text-sm text-app-muted">
          Catat hasil timbang aktual untuk delivery yang sudah dikirim secara fisik.
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Perhatian'}>
          {feedback.message}
        </AlertBanner>
      )}

      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat worklist">
          {loadError}
        </AlertBanner>
      )}

      {loading && <p className="text-sm text-app-muted">Memuat...</p>}
      {!loading && deliveries.length === 0 && !loadError && (
        <p className="text-sm text-app-muted">Tidak ada delivery yang menunggu konfirmasi timbang.</p>
      )}

      <div className="space-y-3">
        {deliveries.map((delivery) => {
          const draft = getDraft(delivery.id);
          const isConfirming = confirmingId === delivery.id;

          return (
            <div key={delivery.id} className="space-y-3 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-app-text">{delivery.site?.name ?? '-'}</p>
                    {delivery.site?.type && (
                      <StatusBadge
                        label={delivery.site.type === 'trading' ? 'Trading' : 'Budidaya'}
                        tone={delivery.site.type === 'trading' ? 'info' : 'success'}
                      />
                    )}
                  </div>
                  <p className="text-xs text-app-muted">
                    {delivery.demand
                      ? `${delivery.demand.customer?.name ?? '-'} — ${delivery.demand.product?.name ?? '-'}`
                      : 'Spot sale (tanpa demand)'}
                  </p>
                </div>
                <p className="text-sm text-app-muted">Planned: {formatKg(delivery.planned_kg)}</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-app-muted">Berat Aktual (kg) *</span>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={draft.actual_weight_kg}
                    onChange={(e) => updateDraft(delivery.id, { actual_weight_kg: e.target.value })}
                    className={inputClass}
                    disabled={isConfirming}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-app-muted">Tanggal Kirim *</span>
                  <input
                    type="date"
                    value={draft.delivered_at}
                    onChange={(e) => updateDraft(delivery.id, { delivered_at: e.target.value })}
                    className={inputClass}
                    disabled={isConfirming}
                  />
                </label>

                <button
                  type="button"
                  onClick={() => handleConfirm(delivery)}
                  disabled={isConfirming}
                  className="rounded-md bg-app-accent hover:bg-app-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {isConfirming ? 'Menyimpan...' : 'Konfirmasi'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
