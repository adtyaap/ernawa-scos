import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, HeartPulse, Truck, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { KPICard } from '../../components/shared/KPICard';
import { StatusBadge, type BadgeTone } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import { formatCurrency, formatKg, todayLocalDate } from '../../lib/format';
import type { Shipment, ShipmentStatus, Track } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

const STATUS_LABEL: Record<ShipmentStatus, string> = {
  planned: 'Direncanakan',
  ready: 'Siap',
  in_transit: 'Dalam Perjalanan',
  delivered: 'Tiba',
  delayed: 'Terlambat',
  failed: 'Gagal',
  cancelled: 'Dibatalkan',
};

const STATUS_TONE: Record<ShipmentStatus, BadgeTone> = {
  planned: 'neutral',
  ready: 'info',
  in_transit: 'info',
  delivered: 'success',
  delayed: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
};

// Sama persis dgn penjaga di DB (fn_shipments_guard, migration 0048) — DB
// tetap penentu akhir, ini cuma supaya tombol yang tampil memang valid.
const NEXT: Record<ShipmentStatus, ShipmentStatus[]> = {
  planned: ['ready', 'in_transit', 'cancelled'],
  ready: ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'delayed', 'failed'],
  delayed: ['in_transit', 'delivered', 'failed'],
  delivered: [],
  failed: [],
  cancelled: [],
};

const CARRIERS = ['Ekspedisi Darat', 'Kargo Udara', 'Kargo Laut', 'Armada Sendiri'];

interface DeliveryOption {
  id: string;
  created_at: string;
  planned_kg: number;
  site: { name: string; type: string } | null;
  demand: { customer: { name: string } | null } | null;
}

interface ShipmentRow extends Shipment {
  delivery: DeliveryOption | null;
}

function deliveryLabel(d: DeliveryOption): string {
  const date = new Date(d.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  return `${d.site?.name ?? '-'} · ${d.demand?.customer?.name ?? 'Spot sale'} · ${formatKg(d.planned_kg)} · ${date}`;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Logistics (migration 0048): rute, carrier, ETA, biaya & mortalitas transit
// per pengiriman. Biaya masuk P&L (Profitability); mortalitas transit cuma
// informasi kg (tidak menulis ledger — stok sudah keluar saat alokasi).
// Tidak ada hapus: salah input -> Batalkan (alasan wajib) lalu buat ulang.
export function LogisticsPage() {
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [track, setTrack] = useState<Track>('trading');
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  const [deliveryId, setDeliveryId] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [carrier, setCarrier] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [departedOn, setDepartedOn] = useState(todayLocalDate());
  const [etaOn, setEtaOn] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [initialStatus, setInitialStatus] = useState<ShipmentStatus>('planned');
  const [submitting, setSubmitting] = useState(false);

  const [action, setAction] = useState<{ id: string; kind: 'delivered' | 'cancelled' } | null>(null);
  const [actionInput, setActionInput] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  async function load() {
    setLoadError(null);
    const [shipRes, delRes] = await Promise.all([
      supabase
        .from('shipments')
        .select(
          '*, delivery:deliveries(id, created_at, planned_kg, site:sites(name, type), demand:demands(customer:customers(name)))',
        )
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('deliveries')
        .select('id, created_at, planned_kg, site:sites(name, type), demand:demands(customer:customers(name))')
        .is('cancelled_at', null)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);
    if (shipRes.error || delRes.error) {
      setLoadError((shipRes.error ?? delRes.error)?.message ?? 'Gagal memuat data.');
    } else {
      setShipments((shipRes.data as unknown as ShipmentRow[]) ?? []);
      setDeliveries((delRes.data as unknown as DeliveryOption[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const trackDeliveries = useMemo(() => deliveries.filter((d) => d.site?.type === track), [deliveries, track]);
  const trackShipments = useMemo(() => shipments.filter((s) => s.delivery?.site?.type === track), [shipments, track]);

  const kpis = useMemo(() => {
    const live = trackShipments.filter((s) => s.status !== 'cancelled');
    return {
      active: live.filter((s) => ['planned', 'ready', 'in_transit'].includes(s.status)).length,
      delayed: live.filter((s) => s.status === 'delayed').length,
      cost: live.reduce((sum, s) => sum + s.cost, 0),
      mortality: live.reduce((sum, s) => sum + s.transit_mortality_kg, 0),
    };
  }, [trackShipments]);

  function handlePickDelivery(id: string) {
    setDeliveryId(id);
    const d = deliveries.find((x) => x.id === id);
    if (d) {
      setOrigin(d.site?.name ?? '');
      setDestination(d.demand?.customer?.name ?? '');
      setQty(String(d.planned_kg));
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const qtyNum = Number(qty);
    const costNum = cost ? Number(cost) : 0;
    if (!deliveryId || !(qtyNum > 0) || costNum < 0 || submitting) return;
    if (etaOn && etaOn < departedOn) {
      setFeedback({ variant: 'danger', message: 'ETA tidak boleh sebelum tanggal berangkat.' });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    const { error } = await supabase.from('shipments').insert({
      delivery_id: deliveryId,
      origin: origin.trim() || null,
      destination: destination.trim() || null,
      carrier: carrier.trim() || null,
      vehicle: vehicle.trim() || null,
      departed_on: departedOn,
      eta_on: etaOn || null,
      qty_kg: qtyNum,
      cost: costNum,
      status: initialStatus,
    });
    setSubmitting(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }
    setFeedback({ variant: 'success', message: 'Shipment berhasil dicatat.' });
    setDeliveryId('');
    setOrigin('');
    setDestination('');
    setCarrier('');
    setVehicle('');
    setEtaOn('');
    setQty('');
    setCost('');
    setInitialStatus('planned');
    await load();
  }

  async function updateStatus(row: ShipmentRow, next: ShipmentStatus, extra: { transit_mortality_kg?: number; cancel_reason?: string } = {}) {
    if (savingId) return;
    setSavingId(row.id);
    setFeedback(null);
    const { data, error } = await supabase
      .from('shipments')
      .update({ status: next, ...extra })
      .eq('id', row.id)
      .select('id');
    setSavingId(null);
    if (error || !data || data.length === 0) {
      setFeedback({ variant: 'danger', message: error?.message ?? 'Tidak ada data yang berubah. Kemungkinan Anda tidak punya izin.' });
      return;
    }
    setAction(null);
    setActionInput('');
    setFeedback({ variant: 'success', message: `${row.shipment_no} → ${STATUS_LABEL[next]}.` });
    await load();
  }

  function handleConfirmAction(row: ShipmentRow) {
    if (!action) return;
    if (action.kind === 'delivered') {
      const mort = actionInput ? Number(actionInput) : 0;
      if (!(mort >= 0) || mort > row.qty_kg) {
        setFeedback({ variant: 'danger', message: 'Mortalitas transit harus antara 0 dan qty kirim.' });
        return;
      }
      void updateStatus(row, 'delivered', { transit_mortality_kg: mort });
    } else {
      if (!actionInput.trim()) {
        setFeedback({ variant: 'danger', message: 'Alasan pembatalan wajib diisi.' });
        return;
      }
      void updateStatus(row, 'cancelled', { cancel_reason: actionInput.trim() });
    }
  }

  const columns: DataTableColumn<ShipmentRow>[] = [
    {
      key: 'no',
      header: 'Shipment',
      render: (r) => (
        <div>
          <p className="font-medium">{r.shipment_no}</p>
          <p className="text-xs text-app-muted">{r.delivery ? deliveryLabel(r.delivery) : '-'}</p>
        </div>
      ),
    },
    {
      key: 'route',
      header: 'Rute',
      render: (r) => (
        <div>
          <p>
            {r.origin || '-'} → {r.destination || '-'}
          </p>
          <p className="text-xs text-app-muted">{[r.carrier, r.vehicle].filter(Boolean).join(' · ') || '-'}</p>
        </div>
      ),
    },
    { key: 'departed', header: 'Berangkat', render: (r) => formatDate(r.departed_on) },
    { key: 'eta', header: 'ETA', render: (r) => formatDate(r.eta_on) },
    { key: 'qty', header: 'Qty', render: (r) => formatKg(r.qty_kg) },
    { key: 'cost', header: 'Biaya', render: (r) => formatCurrency(r.cost) },
    { key: 'mort', header: 'Mort. Transit', render: (r) => (r.transit_mortality_kg ? formatKg(r.transit_mortality_kg) : '-') },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div>
          <StatusBadge label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
          {r.cancel_reason && <p className="mt-1 max-w-[160px] text-xs text-app-muted">{r.cancel_reason}</p>}
        </div>
      ),
    },
    {
      key: 'aksi',
      header: 'Aksi',
      render: (r) => {
        const nexts = NEXT[r.status];
        if (nexts.length === 0) return <span className="text-xs text-app-muted">Final</span>;
        if (action?.id === r.id) {
          return (
            <div className="flex min-w-[220px] flex-wrap items-center gap-1.5">
              <input
                type={action.kind === 'delivered' ? 'number' : 'text'}
                min="0"
                step="0.001"
                value={actionInput}
                onChange={(e) => setActionInput(e.target.value)}
                placeholder={action.kind === 'delivered' ? 'Mortalitas transit (kg)' : 'Alasan batal'}
                className="w-40 rounded-md border border-app-border bg-app-bg px-3 py-2 text-xs"
              />
              <button
                type="button"
                onClick={() => handleConfirmAction(r)}
                disabled={savingId === r.id}
                className="rounded-md bg-app-accent px-3 py-2 text-xs font-semibold text-white hover:bg-app-accent-hover disabled:opacity-40"
              >
                Simpan
              </button>
              <button
                type="button"
                onClick={() => setAction(null)}
                className="rounded-md px-3 py-2 text-xs text-app-muted hover:bg-app-soft"
              >
                Batal
              </button>
            </div>
          );
        }
        return (
          <div className="flex flex-wrap gap-1">
            {nexts.map((next) => (
              <button
                key={next}
                type="button"
                disabled={savingId !== null}
                onClick={() => {
                  if (next === 'delivered' || next === 'cancelled') {
                    setAction({ id: r.id, kind: next });
                    setActionInput('');
                  } else {
                    void updateStatus(r, next);
                  }
                }}
                className={`rounded px-3 py-2 text-xs font-medium disabled:opacity-40 ${
                  next === 'cancelled' || next === 'failed' || next === 'delayed'
                    ? 'text-app-danger hover:bg-app-danger/10'
                    : 'text-app-accent hover:bg-app-accent/10'
                }`}
              >
                {next === 'cancelled' ? 'Batalkan' : `→ ${STATUS_LABEL[next]}`}
              </button>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Deliver &gt; Logistics</h1>
        <p className="text-sm text-app-muted">
          Pelacakan pengiriman: rute, armada, ETA, biaya, dan mortalitas transit. Status: Direncanakan → Siap → Dalam
          Perjalanan → Tiba (atau Terlambat/Gagal).
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal'}>
          {feedback.message}
        </AlertBanner>
      )}
      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat data">
          {loadError}
        </AlertBanner>
      )}

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-app-muted">
          Track:
          <select
            value={track}
            onChange={(e) => {
              setTrack(e.target.value as Track);
              setDeliveryId('');
            }}
            className="rounded-md border border-app-border bg-app-bg px-3 py-1.5 text-sm text-app-text"
          >
            <option value="trading">Trading</option>
            <option value="budidaya">Budidaya</option>
          </select>
        </label>
      </div>

      <form onSubmit={handleCreate} className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-app-text">Buat Shipment</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-app-muted">Delivery *</span>
            <select value={deliveryId} onChange={(e) => handlePickDelivery(e.target.value)} className={inputClass}>
              <option value="">Pilih delivery</option>
              {trackDeliveries.map((d) => (
                <option key={d.id} value={d.id}>
                  {deliveryLabel(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Asal</span>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Tujuan</span>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Carrier</span>
            <input list="carrier-options" value={carrier} onChange={(e) => setCarrier(e.target.value)} className={inputClass} />
            <datalist id="carrier-options">
              {CARRIERS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Kendaraan / No. Polisi</span>
            <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Berangkat *</span>
            <input type="date" value={departedOn} onChange={(e) => setDepartedOn(e.target.value)} className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">ETA</span>
            <input type="date" value={etaOn} onChange={(e) => setEtaOn(e.target.value)} className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Qty Kirim (kg) *</span>
            <input type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Biaya Logistik (Rp)</span>
            <input type="number" min="0" step="1" value={cost} onChange={(e) => setCost(e.target.value)} className={inputClass} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-app-muted">Status Awal</span>
            <select value={initialStatus} onChange={(e) => setInitialStatus(e.target.value as ShipmentStatus)} className={inputClass}>
              <option value="planned">Direncanakan</option>
              <option value="ready">Siap</option>
              <option value="in_transit">Dalam Perjalanan</option>
              <option value="delivered">Tiba</option>
            </select>
          </label>
        </div>
        <p className="text-xs text-app-muted">
          Biaya tidak bisa diubah setelah disimpan — kalau salah, batalkan shipment lalu buat ulang. Mortalitas transit
          diisi saat menandai Tiba.
        </p>
        <button
          type="submit"
          disabled={!deliveryId || !qty || submitting}
          className="rounded-md bg-app-accent px-4 py-2 text-sm font-semibold text-white hover:bg-app-accent-hover disabled:opacity-40"
        >
          {submitting ? 'Menyimpan...' : 'Simpan Shipment'}
        </button>
      </form>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard icon={Truck} label="Shipment Aktif" value={String(kpis.active)} note="Direncanakan, siap, dalam perjalanan" />
        <KPICard icon={AlertTriangle} label="Terlambat" value={String(kpis.delayed)} />
        <KPICard icon={Wallet} label="Biaya Logistik" value={formatCurrency(kpis.cost)} note="Masuk P&L (Profitability)" />
        <KPICard icon={HeartPulse} label="Mortalitas Transit" value={formatKg(kpis.mortality)} note="Informasi, tidak mengubah stok" />
      </div>

      <DataTable
        columns={columns}
        rows={trackShipments}
        getRowId={(r) => r.id}
        emptyLabel={loading ? 'Memuat...' : 'Belum ada shipment.'}
      />
    </div>
  );
}
