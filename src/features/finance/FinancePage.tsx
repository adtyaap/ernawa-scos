import { useEffect, useMemo, useState } from 'react';
import { Clock, Percent, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner } from '../../components/shared/AlertBanner';
import { KPICard } from '../../components/shared/KPICard';
import { formatCurrency, formatNumber } from '../../lib/format';
import type { TradingCapitalLockup, TradingDeliveryMargin, TradingReceivableCycle } from '../../types/domain';

const SPARSE_DATA_THRESHOLD = 5;

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
  const { profile, profileLoading } = useAuth();
  const isInvestor = profile?.role === 'investor';

  const [marginRows, setMarginRows] = useState<TradingDeliveryMargin[]>([]);
  const [lockupRows, setLockupRows] = useState<TradingCapitalLockup[]>([]);
  const [receivableRows, setReceivableRows] = useState<TradingReceivableCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  }, [profileLoading, isInvestor]);

  const marginPerKg = useMemo(() => {
    const validRows = marginRows.filter((r) => r.actual_weight_kg > 0);
    const totalWeight = validRows.reduce((sum, r) => sum + r.actual_weight_kg, 0);
    const totalMargin = validRows.reduce((sum, r) => sum + r.margin, 0);
    return totalWeight > 0 ? totalMargin / totalWeight : null;
  }, [marginRows]);

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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KPICard
            icon={Percent}
            label="Margin per kg"
            value={marginPerKg !== null ? `${formatCurrency(marginPerKg)}/kg` : 'Belum ada data'}
            note={marginRows.length > 0 ? `Berdasarkan ${marginRows.length} delivery` : undefined}
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
