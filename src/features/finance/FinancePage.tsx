import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Clock, Download, Percent, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { KPICard } from '../../components/shared/KPICard';
import { formatCurrency, formatNumber, todayLocalDate } from '../../lib/format';
import { downloadCsv } from '../../lib/exportCsv';
import type { TradingCapitalLockup, TradingDeliveryMargin, TradingReceivableCycle } from '../../types/domain';

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [marginTargetPct, setMarginTargetPct] = useState<number | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetFeedback, setTargetFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadTarget() {
    const { data } = await supabase.from('finance_targets').select('margin_target_pct').eq('track', 'trading').maybeSingle();
    setMarginTargetPct(data ? Number(data.margin_target_pct) : null);
  }

  useEffect(() => {
    if (profileLoading) return;

    async function load() {
      // Investor TIDAK boleh membaca view/tabel mentah (RLS sengaja menolak);
      // ia membaca baris view yang sama lewat fungsi SECURITY DEFINER
      // khusus (migration 0022) yang hanya melayani owner/investor.
      const [marginRes, lockupRes, receivableRes] = await Promise.all(
        isInvestor
          ? [
              supabase.rpc('investor_trading_delivery_margin'),
              supabase.rpc('investor_trading_capital_lockup'),
              supabase.rpc('investor_trading_receivable_cycle'),
            ]
          : [
              supabase.from('v_trading_delivery_margin').select('*'),
              supabase.from('v_trading_capital_lockup').select('*'),
              supabase.from('v_trading_receivable_cycle').select('*'),
            ],
      );

      const firstError = marginRes.error ?? lockupRes.error ?? receivableRes.error;
      if (firstError) {
        setLoadError(firstError.message);
      } else {
        setMarginRows((marginRes.data as TradingDeliveryMargin[]) ?? []);
        setLockupRows((lockupRes.data as TradingCapitalLockup[]) ?? []);
        setReceivableRows((receivableRes.data as TradingReceivableCycle[]) ?? []);
      }
      setLoading(false);
    }

    load();
    loadTarget();
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
