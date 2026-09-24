import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Clock, Download, Percent, Receipt, RefreshCw, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { KPICard } from '../../components/shared/KPICard';
import { formatCurrency, formatNumber, todayLocalDate } from '../../lib/format';
import { downloadCsv } from '../../lib/exportCsv';
import type {
  SettlementAgingRow,
  TradingCapitalLockup,
  TradingDeliveryMargin,
  TradingDpoInput,
  TradingMarginByProduct,
  TradingMarginBySegment,
  TradingMarginMixedSummary,
  TradingReceivableCycle,
  TrustSummary,
} from '../../types/domain';

const SEGMENT_DISPLAY_LABEL: Record<string, string> = {
  restoran: 'Restoran',
  eksportir: 'Eksportir',
  lainnya: 'Lainnya',
  belum_diklasifikasi: 'Belum Diklasifikasi',
};

const SPARSE_DATA_THRESHOLD = 5;

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

function formatDays(value: number): string {
  return `${formatNumber(Math.round(value * 10) / 10)} hari`;
}

// Dashboard Finance — SENGAJA HANYA Trading (CLAUDE.md aturan #1: jangan
// pernah blended trading/budidaya). Budidaya ditampilkan sebagai placeholder
// eksplisit "belum ada data operasional", bukan card kosong/hilang.
//
// 3 metrik dari migration 0011 (semua view sudah filter site.type='trading'
// sendiri, agregasi avg/sum/count dilakukan di sini karena volume data pilot
// masih kecil):
//   - Margin per kg: weighted (SUM margin / SUM actual_weight_kg), dari
//     v_trading_delivery_margin (per delivery).
//   - Capital lock-up: weighted by qty_kg, dari v_trading_capital_lockup
//     (per delivery_allocation) — berhenti di delivered_at, terpisah dari
//     metrik piutang.
//   - Hari piutang riil: rata-rata settled_at - created_at (BUKAN due_date),
//     dari v_trading_receivable_cycle (per settlement term yang lunas).
export function FinancePage() {
  const { profile, profileLoading, session } = useAuth();
  const isInvestor = profile?.role === 'investor';
  const isOwner = profile?.role === 'owner';

  const [marginRows, setMarginRows] = useState<TradingDeliveryMargin[]>([]);
  const [lockupRows, setLockupRows] = useState<TradingCapitalLockup[]>([]);
  const [receivableRows, setReceivableRows] = useState<TradingReceivableCycle[]>([]);
  const [marginByProduct, setMarginByProduct] = useState<TradingMarginByProduct[]>([]);
  const [marginMixed, setMarginMixed] = useState<TradingMarginMixedSummary | null>(null);
  const [marginBySegment, setMarginBySegment] = useState<TradingMarginBySegment[]>([]);
  const [dpoInputs, setDpoInputs] = useState<TradingDpoInput[]>([]);
  const [receivingTrust, setReceivingTrust] = useState<TrustSummary | null>(null);
  const [settlementTrust, setSettlementTrust] = useState<TrustSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [marginTargetPct, setMarginTargetPct] = useState<number | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetFeedback, setTargetFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  const [arWatchDays, setArWatchDays] = useState<number | null>(null);
  const [editingArWatch, setEditingArWatch] = useState(false);
  const [arWatchInput, setArWatchInput] = useState('');
  const [savingArWatch, setSavingArWatch] = useState(false);
  const [arWatchFeedback, setArWatchFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  const [unpaidTermRows, setUnpaidTermRows] = useState<SettlementAgingRow[]>([]);

  async function loadTarget() {
    const { data } = await supabase.from('finance_targets').select('margin_target_pct, ar_watch_days').eq('track', 'trading').maybeSingle();
    setMarginTargetPct(data ? Number(data.margin_target_pct) : null);
    setArWatchDays(data?.ar_watch_days ?? null);
  }

  async function loadUnpaidTerm() {
    const { data, error } = isInvestor
      ? await supabase.rpc('investor_settlements_aging')
      : await supabase.from('v_settlements_aging').select('*');
    if (!error) {
      setUnpaidTermRows(((data as SettlementAgingRow[]) ?? []).filter((r) => r.track === 'trading' && r.settled_at === null));
    }
  }

  useEffect(() => {
    if (profileLoading) return;

    async function load() {
      // Investor TIDAK boleh membaca view/tabel mentah (RLS sengaja menolak);
      // ia membaca baris view yang sama lewat fungsi SECURITY DEFINER
      // khusus (migration 0022) yang hanya melayani owner/investor.
      const [marginRes, lockupRes, receivableRes, byProductRes, mixedRes, bySegmentRes, dpoRes, receivingTrustRes, settlementTrustRes] =
        await Promise.all(
          isInvestor
            ? [
                supabase.rpc('investor_trading_delivery_margin'),
                supabase.rpc('investor_trading_capital_lockup'),
                supabase.rpc('investor_trading_receivable_cycle'),
                supabase.rpc('investor_trading_margin_by_product'),
                supabase.rpc('investor_trading_margin_mixed_summary'),
                supabase.rpc('investor_trading_margin_by_segment'),
                supabase.rpc('investor_trading_dpo_inputs'),
                supabase.rpc('investor_receiving_trust'),
                supabase.rpc('investor_settlement_trust'),
              ]
            : [
                supabase.from('v_trading_delivery_margin').select('*'),
                supabase.from('v_trading_capital_lockup').select('*'),
                supabase.from('v_trading_receivable_cycle').select('*'),
                supabase.from('v_trading_margin_by_product').select('*'),
                supabase.from('v_trading_margin_mixed_summary').select('*'),
                supabase.from('v_trading_margin_by_segment').select('*'),
                supabase.from('v_trading_dpo_inputs').select('*'),
                supabase.from('v_receiving_trust').select('*'),
                supabase.from('v_settlement_trust').select('*'),
              ],
        );

      const firstError =
        marginRes.error ??
        lockupRes.error ??
        receivableRes.error ??
        byProductRes.error ??
        mixedRes.error ??
        bySegmentRes.error ??
        dpoRes.error ??
        receivingTrustRes.error ??
        settlementTrustRes.error;
      if (firstError) {
        setLoadError(firstError.message);
      } else {
        setMarginRows((marginRes.data as TradingDeliveryMargin[]) ?? []);
        setLockupRows((lockupRes.data as TradingCapitalLockup[]) ?? []);
        setReceivableRows((receivableRes.data as TradingReceivableCycle[]) ?? []);
        setMarginByProduct((byProductRes.data as TradingMarginByProduct[]) ?? []);
        setMarginMixed(((mixedRes.data as TradingMarginMixedSummary[]) ?? [])[0] ?? null);
        setMarginBySegment((bySegmentRes.data as TradingMarginBySegment[]) ?? []);
        setDpoInputs((dpoRes.data as TradingDpoInput[]) ?? []);
        setReceivingTrust(((receivingTrustRes.data as TrustSummary[]) ?? []).find((r) => r.track === 'trading') ?? null);
        setSettlementTrust(((settlementTrustRes.data as TrustSummary[]) ?? []).find((r) => r.track === 'trading') ?? null);
      }
      setLoading(false);
    }

    load();
    loadTarget();
    loadUnpaidTerm();
  }, [profileLoading, isInvestor]);

  const marginPerKg = useMemo(() => {
    const validRows = marginRows.filter((r) => r.actual_weight_kg > 0);
    const totalWeight = validRows.reduce((sum, r) => sum + r.actual_weight_kg, 0);
    const totalMargin = validRows.reduce((sum, r) => sum + r.margin, 0);
    return totalWeight > 0 ? totalMargin / totalWeight : null;
  }, [marginRows]);

  // Margin per transaksi (dikonfirmasi user, bukan ROI turnover modal) —
  // SUM(margin) / SUM(revenue) dari delivery yang sama, bukan rata-rata dari
  // rata-rata (supaya delivery besar tidak tertimbang sama dengan delivery
  // kecil secara keliru).
  const marginPct = useMemo(() => {
    const totalRevenue = marginRows.reduce((sum, r) => sum + r.revenue, 0);
    const totalMargin = marginRows.reduce((sum, r) => sum + r.margin, 0);
    return totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : null;
  }, [marginRows]);

  async function handleSaveTarget(event: FormEvent) {
    event.preventDefault();
    const pct = Number(targetInput);
    if (!pct || pct <= 0 || pct > 100 || savingTarget || !session?.user.id) return;

    setSavingTarget(true);
    setTargetFeedback(null);

    const { error } = await supabase
      .from('finance_targets')
      .upsert({ track: 'trading', margin_target_pct: pct, updated_by: session.user.id }, { onConflict: 'track' });

    setSavingTarget(false);

    if (error) {
      setTargetFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setTargetFeedback({ variant: 'success', message: 'Target margin berhasil disimpan.' });
    setEditingTarget(false);
    setTargetInput('');
    await loadTarget();
  }

  async function handleSaveArWatch(event: FormEvent) {
    event.preventDefault();
    const days = Number(arWatchInput);
    if (!days || days <= 0 || savingArWatch || !session?.user.id) return;

    if (marginTargetPct === null) {
      setArWatchFeedback({ variant: 'danger', message: 'Set Target Margin dulu sebelum mengatur ambang piutang (satu baris config per track).' });
      return;
    }

    setSavingArWatch(true);
    setArWatchFeedback(null);

    const { error } = await supabase.from('finance_targets').upsert(
      { track: 'trading', margin_target_pct: marginTargetPct, ar_watch_days: days, updated_by: session.user.id },
      { onConflict: 'track' },
    );

    setSavingArWatch(false);

    if (error) {
      setArWatchFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setArWatchFeedback({ variant: 'success', message: 'Ambang piutang lewat tempo berhasil disimpan.' });
    setEditingArWatch(false);
    setArWatchInput('');
    await loadTarget();
  }

  const arBuckets = useMemo(() => {
    const buckets = { current: 0, d1_30: 0, d31_60: 0, d60plus: 0, total: 0 };
    for (const row of unpaidTermRows) {
      buckets.total += row.amount;
      const days = row.days_until_due ?? 0;
      if (days >= 0) buckets.current += row.amount;
      else if (days >= -30) buckets.d1_30 += row.amount;
      else if (days >= -60) buckets.d31_60 += row.amount;
      else buckets.d60plus += row.amount;
    }
    return buckets;
  }, [unpaidTermRows]);

  function handleExport(kind: 'margin' | 'lockup' | 'receivable') {
    if (kind === 'margin') {
      downloadCsv(`pnl-margin-trading-${todayLocalDate()}.csv`, marginRows, [
        { header: 'Delivery ID', value: (r) => r.delivery_id },
        { header: 'Site ID', value: (r) => r.site_id },
        { header: 'Berat Aktual (kg)', value: (r) => r.actual_weight_kg },
        { header: 'Revenue (Rp)', value: (r) => r.revenue },
        { header: 'COGS (Rp)', value: (r) => r.cogs },
        { header: 'Margin (Rp)', value: (r) => r.margin },
        { header: 'Margin/kg (Rp)', value: (r) => r.margin_per_kg },
      ]);
    } else if (kind === 'lockup') {
      downloadCsv(`capital-lockup-trading-${todayLocalDate()}.csv`, lockupRows, [
        { header: 'Delivery Allocation ID', value: (r) => r.delivery_allocation_id },
        { header: 'Batch Line ID', value: (r) => r.batch_line_id },
        { header: 'Qty (kg)', value: (r) => r.qty_kg },
        { header: 'Diterima', value: (r) => r.received_at },
        { header: 'Dikirim', value: (r) => r.delivered_at },
        { header: 'Lock-up (hari)', value: (r) => r.lockup_days },
      ]);
    } else {
      downloadCsv(`hari-piutang-trading-${todayLocalDate()}.csv`, receivableRows, [
        { header: 'Settlement ID', value: (r) => r.settlement_id },
        { header: 'Delivery ID', value: (r) => r.delivery_id },
        { header: 'Dibuat', value: (r) => r.created_at },
        { header: 'Lunas', value: (r) => r.settled_at },
        { header: 'Jatuh Tempo', value: (r) => r.due_date },
        { header: 'Hari Sampai Tertagih', value: (r) => r.days_to_collect },
      ]);
    }
  }

  const avgLockupDays = useMemo(() => {
    const totalQty = lockupRows.reduce((sum, r) => sum + r.qty_kg, 0);
    const weightedSum = lockupRows.reduce((sum, r) => sum + r.lockup_days * r.qty_kg, 0);
    return totalQty > 0 ? weightedSum / totalQty : null;
  }, [lockupRows]);

  const avgDaysToCollect = useMemo(() => {
    if (receivableRows.length === 0) return null;
    const total = receivableRows.reduce((sum, r) => sum + r.days_to_collect, 0);
    return total / receivableRows.length;
  }, [receivableRows]);

  // DPO: weighted average HANYA dari baris yang payment_term_days-nya
  // terisi (bukan diasumsikan 0 utk supplier yang belum diklasifikasi) --
  // dgn dpoCoveragePct sbg indikator seberapa representatif angkanya,
  // konsisten prinsip proyek "jangan mengisi kosong dgn karangan".
  const { dpoWeighted, dpoCoveragePct } = useMemo(() => {
    const totalValueAll = dpoInputs.reduce((sum, r) => sum + r.purchase_value, 0);
    const withTerm = dpoInputs.filter((r) => r.payment_term_days !== null);
    const totalValueWithTerm = withTerm.reduce((sum, r) => sum + r.purchase_value, 0);
    const weighted = totalValueWithTerm > 0 ? withTerm.reduce((sum, r) => sum + (r.payment_term_days ?? 0) * r.purchase_value, 0) / totalValueWithTerm : null;
    return {
      dpoWeighted: weighted,
      dpoCoveragePct: totalValueAll > 0 ? (totalValueWithTerm / totalValueAll) * 100 : null,
    };
  }, [dpoInputs]);

  // CCC = Inventory Days + DSO - DPO. Hanya dihitung kalau Inventory Days
  // ada (menandakan memang ada riwayat trading) -- DSO/DPO yang belum ada
  // datanya diperlakukan 0 (bisa jadi memang tidak ada piutang/utang
  // outstanding saat ini, beda dari "belum pernah ada transaksi sama
  // sekali" yang direpresentasikan avgLockupDays === null).
  const ccc = avgLockupDays !== null ? avgLockupDays + (avgDaysToCollect ?? 0) - (dpoWeighted ?? 0) : null;

  const totalUnderlyingCount = marginRows.length + lockupRows.length + receivableRows.length;
  const isSparseData = totalUnderlyingCount < SPARSE_DATA_THRESHOLD;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Finance</h1>
        <p className="text-sm text-app-muted">Ringkasan kinerja finansial — cuma track Trading untuk sekarang.</p>
      </div>

      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat data dashboard">
          {loadError}
        </AlertBanner>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-app-text">Trading</h2>

        {!loading && isSparseData && (
          <AlertBanner variant="warning" title="Data masih sangat sedikit">
            Angka di bawah ini berdasarkan data yang masih sedikit (kemungkinan besar hasil testing), belum
            representatif sebagai metrik bisnis sungguhan.
          </AlertBanner>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <KPICard
            icon={Percent}
            label="Margin per kg"
            value={marginPerKg !== null ? `${formatCurrency(marginPerKg)}/kg` : 'Belum ada data'}
            note={marginRows.length > 0 ? `Berdasarkan ${marginRows.length} delivery` : undefined}
          />
          <KPICard
            icon={Percent}
            label="Margin %"
            value={marginPct !== null ? `${formatNumber(Math.round(marginPct * 10) / 10)}%` : 'Belum ada data'}
            deltaLabel={
              marginPct !== null && marginTargetPct !== null
                ? `Target: ${formatNumber(marginTargetPct)}% (${marginPct >= marginTargetPct ? 'tercapai' : 'di bawah target'})`
                : marginTargetPct === null
                  ? 'Target belum diset'
                  : undefined
            }
            deltaTone={marginPct !== null && marginTargetPct !== null && marginPct >= marginTargetPct ? 'positive' : 'negative'}
          />
          <KPICard
            icon={Clock}
            label="Capital Lock-up"
            value={avgLockupDays !== null ? formatDays(avgLockupDays) : 'Belum ada data'}
            note={lockupRows.length > 0 ? `Berdasarkan ${lockupRows.length} alokasi` : undefined}
          />
          <KPICard
            icon={Wallet}
            label="Hari Piutang Riil"
            value={avgDaysToCollect !== null ? formatDays(avgDaysToCollect) : 'Belum ada data'}
            note={receivableRows.length > 0 ? `Berdasarkan ${receivableRows.length} settlement` : undefined}
          />
          <KPICard
            icon={Receipt}
            label="DPO (Termin ke Supplier)"
            value={dpoWeighted !== null ? formatDays(dpoWeighted) : 'Belum ada data'}
            note={
              dpoCoveragePct !== null
                ? `Cakupan ${formatNumber(Math.round(dpoCoveragePct))}% nilai pembelian (sisanya: termin belum diisi)`
                : undefined
            }
          />
          <KPICard
            icon={RefreshCw}
            label="Cash Conversion Cycle"
            value={ccc !== null ? formatDays(ccc) : 'Belum ada data'}
            note="Inventory Days + Hari Piutang − DPO"
          />
        </div>

        {isOwner && (
          <div className="space-y-2 rounded-lg border border-app-border bg-app-panel p-3">
            {targetFeedback && (
              <AlertBanner variant={targetFeedback.variant} title={targetFeedback.variant === 'success' ? 'Berhasil' : 'Gagal'}>
                {targetFeedback.message}
              </AlertBanner>
            )}
            {!editingTarget ? (
              <button
                type="button"
                onClick={() => {
                  setEditingTarget(true);
                  setTargetInput(marginTargetPct !== null ? String(marginTargetPct) : '');
                  setTargetFeedback(null);
                }}
                className="text-xs font-medium text-app-accent hover:underline"
              >
                {marginTargetPct !== null ? 'Ubah Target Margin' : 'Set Target Margin'}
              </button>
            ) : (
              <form onSubmit={handleSaveTarget} className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-app-muted">
                  Target margin trading (%):
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="0.1"
                    value={targetInput}
                    onChange={(e) => setTargetInput(e.target.value)}
                    className={`${inputClass} w-24`}
                  />
                </label>
                <button
                  type="submit"
                  disabled={!targetInput || savingTarget}
                  className="rounded-md bg-app-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
                >
                  {savingTarget ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingTarget(false)}
                  className="rounded-md border border-app-border px-3 py-1.5 text-xs text-app-muted hover:bg-white/5"
                >
                  Batal
                </button>
              </form>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-app-border bg-app-panel p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-app-muted">Margin per Produk</h3>
            {marginByProduct.length === 0 && !marginMixed ? (
              <p className="text-xs text-app-muted">Belum ada data.</p>
            ) : (
              <div className="space-y-1">
                {marginByProduct.map((row) => (
                  <div key={row.product_id} className="flex items-center justify-between text-xs">
                    <span className="text-app-text">{row.product_name}</span>
                    <span className="text-app-muted">
                      {formatCurrency(row.margin)} ({row.margin_pct !== null ? `${formatNumber(Math.round(row.margin_pct * 10) / 10)}%` : '-'})
                    </span>
                  </div>
                ))}
                {marginMixed && marginMixed.delivery_count > 0 && (
                  <div className="flex items-center justify-between border-t border-app-border pt-1 text-xs">
                    <span className="text-app-muted">
                      Campuran ({marginMixed.delivery_count} delivery &gt;1 produk, tidak terpecah)
                    </span>
                    <span className="text-app-muted">{formatCurrency(marginMixed.margin)}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-app-border bg-app-panel p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-app-muted">Margin per Segmen Pelanggan</h3>
            {marginBySegment.length === 0 ? (
              <p className="text-xs text-app-muted">Belum ada data.</p>
            ) : (
              <div className="space-y-1">
                {marginBySegment.map((row) => (
                  <div key={row.segment} className="flex items-center justify-between text-xs">
                    <span className="text-app-text">{SEGMENT_DISPLAY_LABEL[row.segment] ?? row.segment}</span>
                    <span className="text-app-muted">
                      {formatCurrency(row.margin)} ({row.margin_pct !== null ? `${formatNumber(Math.round(row.margin_pct * 10) / 10)}%` : '-'})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-app-border bg-app-panel p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-app-muted">Piutang Belum Tertagih</h3>
            <span className="text-sm font-semibold text-app-text">{formatCurrency(arBuckets.total)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="text-xs">
              <p className="text-app-muted">Belum jatuh tempo</p>
              <p className="font-semibold text-app-text">{formatCurrency(arBuckets.current)}</p>
            </div>
            <div className="text-xs">
              <p className="text-app-muted">1–30 hari</p>
              <p className="font-semibold text-app-text">{formatCurrency(arBuckets.d1_30)}</p>
            </div>
            <div className="text-xs">
              <p className="text-app-muted">31–60 hari</p>
              <p className="font-semibold text-app-text">{formatCurrency(arBuckets.d31_60)}</p>
            </div>
            <div className="text-xs">
              <p className="text-app-muted">&gt;60 hari</p>
              <p className="font-semibold text-app-text">{formatCurrency(arBuckets.d60plus)}</p>
            </div>
          </div>

          {isOwner && (
            <div className="space-y-1 border-t border-app-border pt-2">
              {arWatchFeedback && (
                <AlertBanner variant={arWatchFeedback.variant} title={arWatchFeedback.variant === 'success' ? 'Berhasil' : 'Gagal'}>
                  {arWatchFeedback.message}
                </AlertBanner>
              )}
              {!editingArWatch ? (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-app-muted">
                    Ambang alert piutang: {arWatchDays !== null ? `${arWatchDays} hari lewat tempo` : 'belum diatur (alert tidak aktif)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingArWatch(true);
                      setArWatchInput(arWatchDays !== null ? String(arWatchDays) : '');
                      setArWatchFeedback(null);
                    }}
                    className="font-medium text-app-accent hover:underline"
                  >
                    {arWatchDays !== null ? 'Ubah' : 'Set Ambang'}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSaveArWatch} className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-app-muted">
                    Ambang (hari):
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={arWatchInput}
                      onChange={(e) => setArWatchInput(e.target.value)}
                      className={`${inputClass} w-20`}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!arWatchInput || savingArWatch}
                    className="rounded-md bg-app-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40"
                  >
                    {savingArWatch ? 'Menyimpan...' : 'Simpan'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingArWatch(false)}
                    className="rounded-md border border-app-border px-3 py-1.5 text-xs text-app-muted hover:bg-white/5"
                  >
                    Batal
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1 rounded-lg border border-app-border bg-app-panel p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-app-muted">Data Trust</h3>
          <p className="text-xs text-app-muted">
            % nilai transaksi yang sudah ditandai terverifikasi (dicocokkan bukti transfer/timbang/invoice) saat dicatat.
          </p>
          <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
            <div className="text-xs">
              <span className="text-app-muted">Penerimaan: </span>
              <span className="font-semibold text-app-text">
                {receivingTrust && receivingTrust.total_value > 0
                  ? `${formatNumber(Math.round((receivingTrust.verified_value / receivingTrust.total_value) * 1000) / 10)}%`
                  : 'Belum ada data'}
              </span>
            </div>
            <div className="text-xs">
              <span className="text-app-muted">Settlement: </span>
              <span className="font-semibold text-app-text">
                {settlementTrust && settlementTrust.total_value > 0
                  ? `${formatNumber(Math.round((settlementTrust.verified_value / settlementTrust.total_value) * 1000) / 10)}%`
                  : 'Belum ada data'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleExport('margin')}
            disabled={marginRows.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-app-border px-3 py-1.5 text-xs font-medium text-app-muted hover:bg-white/5 disabled:opacity-40"
          >
            <Download size={14} /> Unduh Margin (CSV)
          </button>
          <button
            type="button"
            onClick={() => handleExport('lockup')}
            disabled={lockupRows.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-app-border px-3 py-1.5 text-xs font-medium text-app-muted hover:bg-white/5 disabled:opacity-40"
          >
            <Download size={14} /> Unduh Capital Lock-up (CSV)
          </button>
          <button
            type="button"
            onClick={() => handleExport('receivable')}
            disabled={receivableRows.length === 0}
            className="flex items-center gap-1.5 rounded-md border border-app-border px-3 py-1.5 text-xs font-medium text-app-muted hover:bg-white/5 disabled:opacity-40"
          >
            <Download size={14} /> Unduh Hari Piutang (CSV)
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-app-text">Budidaya</h2>
        <AlertBanner variant="info" title="Belum ada data operasional">
          Site budidaya belum beroperasi — belum ada delivery/settlement yang bisa dihitung metriknya. Bagian ini
          akan terisi begitu ada transaksi budidaya sungguhan.
        </AlertBanner>
      </div>
    </div>
  );
}
