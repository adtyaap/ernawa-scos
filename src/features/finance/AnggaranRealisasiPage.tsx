import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { KPICard } from '../../components/shared/KPICard';
import { formatCurrency, formatNumber } from '../../lib/format';

const LINE_ITEM_ICON = { revenue: TrendingUp, opex: TrendingDown } as const;

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

type Track = 'trading' | 'budidaya';
type LineItem = 'revenue' | 'opex';

const LINE_ITEM_LABEL: Record<LineItem, string> = { revenue: 'Pendapatan (Revenue)', opex: 'Biaya Operasional (Opex)' };

function monthStart(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function formatMonthLabel(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

// Anggaran vs Realisasi bulanan (gap Finance PRD v1). Revenue actual dari
// v_trading_delivery_margin (delivered_at); Opex actual dari
// company_cash_ledger kategori 'opex' (migration 0040) -- keduanya lewat
// get_budget_actuals() SECURITY DEFINER (migration 0041) supaya
// lead/staf/investor bisa lihat laporan varians meski tidak punya SELECT
// langsung ke company_cash_ledger. Budget (target) sendiri dibaca langsung
// dari finance_budgets (broad-read policy, sama pola finance_targets).
// Owner-only yang bisa set/ubah target.
export function AnggaranRealisasiPage() {
  const { profile, profileLoading, session } = useAuth();
  const isOwner = profile?.role === 'owner';

  const [track, setTrack] = useState<Track>('trading');
  const [periodMonth, setPeriodMonth] = useState(() => monthStart(new Date()));

  const [budgets, setBudgets] = useState<Record<LineItem, number | null>>({ revenue: null, opex: null });
  const [actuals, setActuals] = useState<{ revenue: number; opex: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingItem, setEditingItem] = useState<LineItem | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadAll() {
    setLoading(true);
    setLoadError(null);

    const [{ data: budgetData, error: budgetError }, { data: actualData, error: actualError }] = await Promise.all([
      supabase.from('finance_budgets').select('line_item, budget_amount').eq('track', track).eq('period_month', periodMonth),
      supabase.rpc('get_budget_actuals', { p_track: track, p_period_month: periodMonth }),
    ]);

    if (budgetError || actualError) {
      setLoadError((budgetError ?? actualError)?.message ?? 'Gagal memuat data.');
    } else {
      const next: Record<LineItem, number | null> = { revenue: null, opex: null };
      for (const row of (budgetData as { line_item: LineItem; budget_amount: number }[]) ?? []) {
        next[row.line_item] = row.budget_amount;
      }
      setBudgets(next);
      const actualRow = (actualData as { revenue_actual: number; opex_actual: number }[] | null)?.[0];
      setActuals(actualRow ? { revenue: actualRow.revenue_actual, opex: actualRow.opex_actual } : { revenue: 0, opex: 0 });
    }
    setLoading(false);
  }

  useEffect(() => {
    if (profileLoading) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileLoading, track, periodMonth]);

  async function handleSaveBudget(event: FormEvent, lineItem: LineItem) {
    event.preventDefault();
    const amountNum = Number(editValue);
    if (!session?.user.id || saving || amountNum < 0 || editValue === '') return;

    setSaving(true);
    setFeedback(null);

    const { error } = await supabase
      .from('finance_budgets')
      .upsert(
        { track, period_month: periodMonth, line_item: lineItem, budget_amount: amountNum, updated_by: session.user.id },
        { onConflict: 'track,period_month,line_item' },
      );

    setSaving(false);

    if (error) {
      setFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setFeedback({ variant: 'success', message: `Target ${LINE_ITEM_LABEL[lineItem]} berhasil disimpan.` });
    setEditingItem(null);
    await loadAll();
  }

  const rows = useMemo(() => {
    return (['revenue', 'opex'] as LineItem[]).map((item) => {
      const budget = budgets[item];
      const actual = item === 'revenue' ? actuals?.revenue ?? 0 : actuals?.opex ?? 0;
      const variance = budget !== null ? actual - budget : null;
      const variancePct = budget !== null && budget > 0 ? (variance! / budget) * 100 : null;
      return { item, budget, actual, variance, variancePct };
    });
  }, [budgets, actuals]);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Finance &gt; Anggaran vs Realisasi</h1>
        <p className="text-sm text-app-muted">
          Target bulanan vs realisasi per track. Revenue dari delivery yang lunas/di-invoice bulan berjalan; Opex dari Kas &amp; Bank Perusahaan kategori Opex.
        </p>
      </div>

      {feedback && (
        <AlertBanner variant={feedback.variant} title={feedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}>
          {feedback.message}
        </AlertBanner>
      )}
      {loadError && (
        <AlertBanner variant="danger" title="Gagal memuat data">
          {loadError}
        </AlertBanner>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Track</span>
          <select value={track} onChange={(e) => setTrack(e.target.value as Track)} className={inputClass}>
            <option value="trading">Trading</option>
            <option value="budidaya">Budidaya</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-app-muted">Bulan</span>
          <input
            type="month"
            value={periodMonth.slice(0, 7)}
            onChange={(e) => setPeriodMonth(`${e.target.value}-01`)}
            className={inputClass}
          />
        </label>
      </div>

      <p className="text-sm font-medium text-app-text">{formatMonthLabel(periodMonth)}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map(({ item, budget, actual, variance, variancePct }) => (
          <div key={item} className="space-y-2 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-app-text">{LINE_ITEM_LABEL[item]}</h2>
              {isOwner && editingItem !== item && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingItem(item);
                    setEditValue(budget !== null ? String(budget) : '');
                    setFeedback(null);
                  }}
                  className="rounded px-2 py-1 text-xs font-medium text-app-accent hover:bg-app-accent/10"
                >
                  {budget !== null ? 'Ubah Target' : 'Set Target'}
                </button>
              )}
            </div>

            {isOwner && editingItem === item ? (
              <form onSubmit={(e) => handleSaveBudget(e, item)} className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className={`${inputClass} max-w-[160px]`}
                  placeholder="Rp"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={saving || editValue === ''}
                  className="rounded bg-app-accent hover:bg-app-accent-hover px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded border border-app-border px-3 py-1.5 text-xs text-app-muted hover:bg-app-soft"
                >
                  Batal
                </button>
              </form>
            ) : (
              <KPICard
                icon={LINE_ITEM_ICON[item]}
                label="Realisasi"
                value={loading ? '...' : formatCurrency(actual)}
                deltaLabel={
                  budget === null
                    ? 'Target belum diisi'
                    : `Target: ${formatCurrency(budget)} (${variance! >= 0 ? '+' : ''}${formatCurrency(variance!)}${
                        variancePct !== null ? `, ${variancePct >= 0 ? '+' : ''}${formatNumber(Math.round(variancePct * 10) / 10)}%` : ''
                      })`
                }
                deltaTone={budget === null ? undefined : (item === 'revenue' ? variance! >= 0 : variance! <= 0) ? 'positive' : 'negative'}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
