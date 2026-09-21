import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { formatCurrency, formatKg, todayLocalDate } from '../../lib/format';
import type { Customer, PendingSettlementDelivery, SettlementMode } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface AllocationProductRow {
  batch_line: { receiving_lot: { product_id: string } | null } | null;
}

interface AmountSuggestion {
  amount: number | null;
  note: string | null;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Worklist dari v_deliveries_pending_settlement (migration 0009 — anti-join,
// sudah difilter actual_weight_kg IS NOT NULL & belum ada settlements).
// Semua role (owner/lead_lapangan/staf_lapangan) boleh buat settlement di
// sini — RLS settlements_insert (0003) memang terbuka untuk ketiganya.
export function SettlementPage() {
  const [pending, setPending] = useState<PendingSettlementDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);

  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formMode, setFormMode] = useState<SettlementMode>('cod');
  const [formOverrideReason, setFormOverrideReason] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [amountNote, setAmountNote] = useState<string | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadPending() {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from('v_deliveries_pending_settlement')
      .select('*')
      .order('delivered_at', { ascending: true });

    if (error) {
      setLoadError(error.message);
    } else {
      setPending((data as PendingSettlementDelivery[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadPending();
    async function loadCustomers() {
      const { data } = await supabase.from('customers').select('id, name, settlement_mode, payment_term_days').order('name');
      setCustomers((data as Customer[]) ?? []);
      setLoadingCustomers(false);
    }
    loadCustomers();
  }, []);

  const selectedCustomer = customers.find((c) => c.id === formCustomerId) ?? null;
  const isOverrideNeeded = Boolean(selectedCustomer) && formMode !== selectedCustomer?.settlement_mode;

  async function computeSuggestedAmount(delivery: PendingSettlementDelivery): Promise<AmountSuggestion> {
    if (delivery.expected_price_per_kg) {
      return { amount: delivery.actual_weight_kg * delivery.expected_price_per_kg, note: null };
    }

    const { data, error } = await supabase
      .from('delivery_allocations')
      .select('batch_line:batch_lines(receiving_lot:receiving_lots(product_id))')
      .eq('delivery_id', delivery.delivery_id);

    if (error || !data) {
      return { amount: null, note: 'Gagal memeriksa produk delivery ini — isi manual.' };
    }

    const productIds = Array.from(
      new Set(
        (data as unknown as AllocationProductRow[])
          .map((row) => row.batch_line?.receiving_lot?.product_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (productIds.length !== 1) {
      return { amount: null, note: 'Delivery ini punya lebih dari satu produk — isi total manual.' };
    }

    const { data: priceRow } = await supabase
      .from('price_today')
      .select('price')
      .eq('product_id', productIds[0])
      .eq('site_id', delivery.site_id)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!priceRow) {
      return { amount: null, note: 'Tidak ada harga acuan (price_today) untuk produk ini — isi manual.' };
    }

    return { amount: delivery.actual_weight_kg * priceRow.price, note: null };
  }

  async function handleOpenForm(delivery: PendingSettlementDelivery) {
    setSelectedDeliveryId(delivery.delivery_id);
    setFeedback(null);
    setFormOverrideReason('');
    setFormCustomerId(delivery.customer_id ?? '');
    setFormMode('cod');

    setLoadingSuggestion(true);
    setFormAmount('');
    setAmountNote(null);
    const suggestion = await computeSuggestedAmount(delivery);
    setFormAmount(suggestion.amount ? String(Math.round(suggestion.amount)) : '');
    setAmountNote(suggestion.note);
    setLoadingSuggestion(false);
  }

  function closeForm() {
    setSelectedDeliveryId(null);
    setFormCustomerId('');
    setFormMode('cod');
    setFormOverrideReason('');
    setFormAmount('');
    setAmountNote(null);
  }

  // Default mode & reset override_reason begitu customer (baru) diketahui —
  // baik karena demand-linked (sudah tahu dari awal) maupun baru dipilih
  // manual di dropdown spot-sale.
  useEffect(() => {
    if (selectedCustomer) {
      setFormMode(selectedCustomer.settlement_mode);
      setFormOverrideReason('');
    }
    // customers sengaja ikut jadi dependency (bukan cuma formCustomerId):
    // kalau form dibuka sebelum daftar customer selesai load, begitu
    // customers datang, efek ini re-run dan tetap men-default-kan mode
    // dengan benar — bukan nyangkut di fallback 'cod' selamanya.
  }, [formCustomerId, customers]);

  async function handleSubmit(delivery: PendingSettlementDelivery) {
    if (submitting) return;

    if (!formCustomerId) {
      setFeedback({ variant: 'danger', message: 'Customer wajib dipilih.' });
      return;
    }
    const amount = Number(formAmount);
    if (!formAmount.trim() || amount <= 0) {
      setFeedback({ variant: 'danger', message: 'Jumlah (amount) wajib diisi lebih dari 0.' });
      return;
    }
    if (isOverrideNeeded && !formOverrideReason.trim()) {
      setFeedback({
        variant: 'danger',
        message: 'Mode settlement berbeda dari mode default customer — wajib isi alasan override.',
      });
      return;
    }

    const isTerm = formMode === 'term';
    let dueDate: string | null = null;
    if (isTerm) {
      if (!selectedCustomer?.payment_term_days) {
        setFeedback({
          variant: 'danger',
          message: 'Customer ini belum punya payment_term_days — lengkapi dulu di Customer Management.',
        });
        return;
      }
      const baseDate = delivery.delivered_at ? delivery.delivered_at.slice(0, 10) : todayLocalDate();
      dueDate = addDays(baseDate, selectedCustomer.payment_term_days);
    }

    setSubmitting(true);
    setFeedback(null);

    const { error } = await supabase.from('settlements').insert({
      delivery_id: delivery.delivery_id,
      customer_id: formCustomerId,
      mode: formMode,
      amount,
      settled_at: isTerm ? null : new Date().toISOString(),
      due_date: dueDate,
      override_reason: isOverrideNeeded ? formOverrideReason.trim() : null,
    });

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      setSubmitting(false);
      return;
    }

    setFeedback({ variant: 'success', message: 'Settlement berhasil dicatat.' });
    setSubmitting(false);
    closeForm();

    // Reload dari Supabase, BUKAN optimistic update lokal — delivery yang
    // baru di-settle otomatis hilang dari worklist (anti-join view).
    await loadPending();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Deliver &gt; Settlement</h1>
        <p className="text-sm text-app-muted">Buat settlement untuk delivery yang sudah ditimbang.</p>
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
      {!loading && pending.length === 0 && !loadError && (
        <p className="text-sm text-app-muted">Tidak ada delivery yang menunggu settlement.</p>
      )}

      <div className="space-y-3">
        {pending.map((delivery) => {
          const isOpen = selectedDeliveryId === delivery.delivery_id;

          return (
            <div key={delivery.delivery_id} className="space-y-3 rounded-lg border border-app-border bg-app-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-app-text">{delivery.site_name}</p>
                    <StatusBadge
                      label={delivery.track === 'trading' ? 'Trading' : 'Budidaya'}
                      tone={delivery.track === 'trading' ? 'info' : 'success'}
                    />
                  </div>
                  <p className="text-xs text-app-muted">
                    {delivery.customer_name ? delivery.customer_name : 'Spot sale (pilih customer)'}
                  </p>
                </div>
                <p className="text-sm text-app-muted">Berat aktual: {formatKg(delivery.actual_weight_kg)}</p>
              </div>

              {!isOpen && (
                <button
                  type="button"
                  onClick={() => handleOpenForm(delivery)}
                  className="rounded-md bg-app-accent px-4 py-2 text-sm font-semibold text-black"
                >
                  Buat Settlement
                </button>
              )}

              {isOpen && (
                <div className="space-y-3 border-t border-app-border pt-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-app-muted">Customer *</span>
                      {delivery.customer_id ? (
                        <p className={`${inputClass} bg-white/5`}>{delivery.customer_name}</p>
                      ) : (
                        <select
                          value={formCustomerId}
                          onChange={(e) => setFormCustomerId(e.target.value)}
                          className={inputClass}
                          disabled={loadingCustomers}
                        >
                          <option value="">Pilih customer</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>

                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-app-muted">Mode Settlement *</span>
                      <select
                        value={formMode}
                        onChange={(e) => setFormMode(e.target.value as SettlementMode)}
                        className={inputClass}
                        disabled={!formCustomerId}
                      >
                        <option value="cod">COD</option>
                        <option value="term">Termin</option>
                      </select>
                    </label>

                    <label className="block space-y-1 sm:col-span-2">
                      <span className="text-xs font-medium text-app-muted">Jumlah (Rp) *</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={formAmount}
                        onChange={(e) => setFormAmount(e.target.value)}
                        className={inputClass}
                        disabled={loadingSuggestion}
                        placeholder={loadingSuggestion ? 'Menghitung saran...' : 'Isi jumlah'}
                      />
                      {amountNote && <p className="text-xs text-app-warning">{amountNote}</p>}
                      {!amountNote && formAmount && (
                        <p className="text-xs text-app-muted">Saran: {formatCurrency(Number(formAmount))}</p>
                      )}
                    </label>
                  </div>

                  {isOverrideNeeded && (
                    <div className="space-y-1">
                      <AlertBanner variant="warning" title="Mode berbeda dari default customer">
                        Wajib isi alasan — ditegakkan juga di database, bukan cuma di sini.
                      </AlertBanner>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-app-muted">Alasan Override Mode *</span>
                        <textarea
                          value={formOverrideReason}
                          onChange={(e) => setFormOverrideReason(e.target.value)}
                          rows={2}
                          className={inputClass}
                          placeholder="Mis. customer bayar tunai di tempat meski biasanya termin"
                        />
                      </label>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleSubmit(delivery)}
                      disabled={submitting}
                      className="rounded-md bg-app-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
                    >
                      {submitting ? 'Menyimpan...' : 'Simpan Settlement'}
                    </button>
                    <button
                      type="button"
                      onClick={closeForm}
                      disabled={submitting}
                      className="rounded-md border border-app-border px-4 py-2 text-sm font-medium text-app-muted hover:bg-white/5"
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
    </div>
  );
}
