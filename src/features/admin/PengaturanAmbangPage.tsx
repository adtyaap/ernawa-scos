import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../lib/authContext';
import { AlertBanner, type AlertVariant } from '../../components/shared/AlertBanner';
import { StatusBadge } from '../../components/shared/StatusBadge';
import { DataTable, type DataTableColumn } from '../../components/shared/DataTable';
import type { Product, Site, Track } from '../../types/domain';

const inputClass =
  'w-full rounded-md border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:border-app-accent focus:outline-none disabled:opacity-40';

interface PolicyRow {
  id: string;
  product_id: string;
  track: Track;
  max_holding_hours: number;
  product: { name: string } | null;
}

interface MortalityThresholdMap {
  [siteId: string]: number;
}

// Halaman "Pengaturan Ambang" TERPUSAT (gap terakhir dari audit Control
// Tower, sebelumnya sengaja ditunda krn tidak pernah diminta -- lihat catatan
// tech debt CLAUDE.md). SATU-SATUNYA tempat mengubah 4 ambang config yang
// sebelumnya tersebar (Target Holding di FefoRiskReportPage, Ambang
// Mortalitas di StokMortalitasPage, Target Margin & Ambang Piutang di
// FinancePage) -- ketiga halaman itu sekarang READ-ONLY untuk config-nya
// sendiri (form dihapus, cuma tampilkan nilai + pointer ke sini), supaya
// TIDAK ADA dua tempat yang bisa mengubah baris config yang sama (pola sama
// dgn alasan HomePage dibuat read-only saat dikonsolidasi ke Control Tower).
//
// Semua query/tabel/RLS di bawah PERSIS SAMA dgn yang sudah dipakai di
// halaman asalnya (tidak ada migration baru) -- cuma dipindah lokasinya.
export function PengaturanAmbangPage() {
  const { profile, session } = useAuth();
  const isOwner = profile?.role === 'owner';

  // --- Target Holding (product_holding_policy, migration 0032) ---
  const [products, setProducts] = useState<Product[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(true);
  const [holdingProductId, setHoldingProductId] = useState('');
  const [holdingTrack, setHoldingTrack] = useState<Track>('trading');
  const [holdingHours, setHoldingHours] = useState('');
  const [savingHolding, setSavingHolding] = useState(false);
  const [holdingFeedback, setHoldingFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  // --- Ambang Mortalitas (mortality_thresholds, migration 0046) ---
  const [sites, setSites] = useState<Site[]>([]);
  const [mortalityThresholds, setMortalityThresholds] = useState<MortalityThresholdMap>({});
  const [loadingThresholds, setLoadingThresholds] = useState(true);
  const [editingMortalitySiteId, setEditingMortalitySiteId] = useState<string | null>(null);
  const [mortalityInput, setMortalityInput] = useState('');
  const [savingMortality, setSavingMortality] = useState(false);
  const [mortalityFeedback, setMortalityFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  // --- Target Margin & Ambang Piutang (finance_targets, track trading, migration 0036/0047) ---
  const [marginTargetPct, setMarginTargetPct] = useState<number | null>(null);
  const [arWatchDays, setArWatchDays] = useState<number | null>(null);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetFeedback, setTargetFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);
  const [editingArWatch, setEditingArWatch] = useState(false);
  const [arWatchInput, setArWatchInput] = useState('');
  const [savingArWatch, setSavingArWatch] = useState(false);
  const [arWatchFeedback, setArWatchFeedback] = useState<{ variant: AlertVariant; message: string } | null>(null);

  async function loadPolicies() {
    setLoadingPolicies(true);
    const { data } = await supabase
      .from('product_holding_policy')
      .select('id, product_id, track, max_holding_hours, product:products(name)')
      .order('track');
    setPolicies((data as unknown as PolicyRow[]) ?? []);
    setLoadingPolicies(false);
  }

  async function loadMortalityThresholds() {
    setLoadingThresholds(true);
    const { data } = await supabase.from('mortality_thresholds').select('site_id, threshold_pct');
    const map: MortalityThresholdMap = {};
    for (const row of (data as { site_id: string; threshold_pct: number }[] | null) ?? []) {
      map[row.site_id] = row.threshold_pct;
    }
    setMortalityThresholds(map);
    setLoadingThresholds(false);
  }

  async function loadFinanceTargets() {
    const { data } = await supabase.from('finance_targets').select('margin_target_pct, ar_watch_days').eq('track', 'trading').maybeSingle();
    setMarginTargetPct(data ? Number(data.margin_target_pct) : null);
    setArWatchDays(data?.ar_watch_days ?? null);
  }

  useEffect(() => {
    supabase
      .from('products')
      .select('id, name')
      .order('name')
      .then(({ data }) => setProducts((data as Product[]) ?? []));
    supabase
      .from('sites')
      .select('id, name, type')
      .order('name')
      .then(({ data }) => setSites((data as Site[]) ?? []));
    loadPolicies();
    loadMortalityThresholds();
    loadFinanceTargets();
  }, []);

  async function handleSaveHolding(event: FormEvent) {
    event.preventDefault();
    const hours = Number(holdingHours);
    if (!holdingProductId || !hours || hours <= 0 || savingHolding) return;

    setSavingHolding(true);
    setHoldingFeedback(null);

    const { error } = await supabase
      .from('product_holding_policy')
      .upsert(
        { product_id: holdingProductId, track: holdingTrack, max_holding_hours: Math.round(hours) },
        { onConflict: 'product_id,track' },
      );

    setSavingHolding(false);

    if (error) {
      setHoldingFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setHoldingFeedback({ variant: 'success', message: 'Target holding berhasil disimpan.' });
    setHoldingHours('');
    await loadPolicies();
  }

  async function handleSaveMortality(siteId: string) {
    const pct = Number(mortalityInput);
    if (!pct || pct <= 0 || pct > 100 || savingMortality || !session?.user.id) return;

    setSavingMortality(true);
    setMortalityFeedback(null);

    const { error } = await supabase
      .from('mortality_thresholds')
      .upsert({ site_id: siteId, threshold_pct: pct, updated_by: session.user.id }, { onConflict: 'site_id' });

    setSavingMortality(false);

    if (error) {
      setMortalityFeedback({ variant: 'danger', message: error.message });
      return;
    }

    setMortalityFeedback({ variant: 'success', message: 'Ambang mortalitas berhasil disimpan.' });
    setEditingMortalitySiteId(null);
    setMortalityInput('');
    await loadMortalityThresholds();
  }

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
    await loadFinanceTargets();
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
    await loadFinanceTargets();
  }

  const policyColumns: DataTableColumn<PolicyRow>[] = [
    { key: 'product', header: 'Produk', render: (row) => row.product?.name ?? '-' },
    {
      key: 'track',
      header: 'Track',
      render: (row) => <StatusBadge label={row.track === 'trading' ? 'Trading' : 'Budidaya'} tone={row.track === 'trading' ? 'info' : 'success'} />,
    },
    { key: 'max_holding_hours', header: 'Max Holding', render: (row) => `${row.max_holding_hours} jam` },
  ];

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-app-text">Admin &gt; Pengaturan Ambang</h1>
        <p className="text-sm text-app-muted">
          Satu tempat untuk semua ambang/target yang dipakai laporan risiko &amp; Panel Peringatan Aktif. Cuma Owner
          yang bisa mengubah; role lain bisa melihat nilai saat ini.
        </p>
      </div>

      <div className="space-y-4 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
        <div>
          <h2 className="text-sm font-semibold text-app-text">Target Holding (FEFO)</h2>
          <p className="text-xs text-app-muted">
            Batas maksimum jam sebuah batch boleh mengendap sebelum ditandai berisiko, per produk per track. Dipakai
            Inventory &gt; Laporan Risiko FEFO.
          </p>
        </div>

        {isOwner && (
          <>
            {holdingFeedback && (
              <AlertBanner variant={holdingFeedback.variant} title={holdingFeedback.variant === 'success' ? 'Berhasil' : 'Gagal menyimpan'}>
                {holdingFeedback.message}
              </AlertBanner>
            )}
            <form onSubmit={handleSaveHolding} className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-app-muted">Produk *</span>
                <select value={holdingProductId} onChange={(e) => setHoldingProductId(e.target.value)} className={inputClass}>
                  <option value="">Pilih produk</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-app-muted">Track *</span>
                <select value={holdingTrack} onChange={(e) => setHoldingTrack(e.target.value as Track)} className={inputClass}>
                  <option value="trading">Trading</option>
                  <option value="budidaya">Budidaya</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-app-muted">Max Jam *</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={holdingHours}
                  onChange={(e) => setHoldingHours(e.target.value)}
                  className={inputClass}
                  placeholder="Mis. 48"
                />
              </label>
              <button
                type="submit"
                disabled={!holdingProductId || !holdingHours || savingHolding}
                className="rounded-md bg-app-accent hover:bg-app-accent-hover px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {savingHolding ? 'Menyimpan...' : 'Simpan'}
              </button>
            </form>
          </>
        )}

        <DataTable
          columns={policyColumns}
          rows={policies}
          getRowId={(row) => row.id}
          emptyLabel={loadingPolicies ? 'Memuat...' : 'Belum ada target holding diset untuk produk manapun.'}
        />
      </div>

      <div className="space-y-4 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
        <div>
          <h2 className="text-sm font-semibold text-app-text">Ambang Mortalitas</h2>
          <p className="text-xs text-app-muted">
            % dari qty diterima (30 hari terakhir) yang dianggap berisiko, per site. Dipakai Inventory &gt; Stok &amp;
            Mortalitas dan Panel Peringatan Aktif.
          </p>
        </div>

        {mortalityFeedback && (
          <AlertBanner variant={mortalityFeedback.variant} title={mortalityFeedback.variant === 'success' ? 'Berhasil' : 'Gagal'}>
            {mortalityFeedback.message}
          </AlertBanner>
        )}

        <div className="space-y-2">
          {loadingThresholds && <p className="text-xs text-app-muted">Memuat...</p>}
          {!loadingThresholds && sites.length === 0 && <p className="text-xs text-app-muted">Belum ada site.</p>}
          {sites.map((site) => {
            const current = mortalityThresholds[site.id];
            const isEditing = editingMortalitySiteId === site.id;
            return (
              <div
                key={site.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-app-border p-3"
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-app-text">{site.name}</span>
                  <StatusBadge label={site.type === 'trading' ? 'Trading' : 'Budidaya'} tone={site.type === 'trading' ? 'info' : 'success'} />
                </div>
                {!isEditing ? (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-app-muted">{current != null ? `Ambang: ${current}%` : 'Ambang belum diatur'}</span>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMortalitySiteId(site.id);
                          setMortalityInput(current != null ? String(current) : '');
                          setMortalityFeedback(null);
                        }}
                        className="font-medium text-app-accent hover:underline"
                      >
                        {current != null ? 'Ubah' : 'Set Ambang'}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="0.1"
                      value={mortalityInput}
                      onChange={(e) => setMortalityInput(e.target.value)}
                      className={`${inputClass} w-24`}
                      placeholder="%"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveMortality(site.id)}
                      disabled={!mortalityInput || savingMortality}
                      className="rounded-md bg-app-accent hover:bg-app-accent-hover px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {savingMortality ? 'Menyimpan...' : 'Simpan'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingMortalitySiteId(null)}
                      className="rounded-md border border-app-border px-3 py-1.5 text-xs text-app-muted hover:bg-app-soft"
                    >
                      Batal
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-app-border bg-app-panel shadow-sm p-4">
        <div>
          <h2 className="text-sm font-semibold text-app-text">Target Margin &amp; Ambang Piutang (Trading)</h2>
          <p className="text-xs text-app-muted">Dipakai KPICard Margin % dan Piutang Belum Tertagih di Finance/Home.</p>
        </div>

        <div className="space-y-1">
          {targetFeedback && (
            <AlertBanner variant={targetFeedback.variant} title={targetFeedback.variant === 'success' ? 'Berhasil' : 'Gagal'}>
              {targetFeedback.message}
            </AlertBanner>
          )}
          {!editingTarget ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-app-muted">
                Target margin: {marginTargetPct !== null ? `${marginTargetPct}%` : 'belum diatur'}
              </span>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingTarget(true);
                    setTargetInput(marginTargetPct !== null ? String(marginTargetPct) : '');
                    setTargetFeedback(null);
                  }}
                  className="font-medium text-app-accent hover:underline"
                >
                  {marginTargetPct !== null ? 'Ubah Target Margin' : 'Set Target Margin'}
                </button>
              )}
            </div>
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
                className="rounded-md bg-app-accent hover:bg-app-accent-hover px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {savingTarget ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button
                type="button"
                onClick={() => setEditingTarget(false)}
                className="rounded-md border border-app-border px-3 py-1.5 text-xs text-app-muted hover:bg-app-soft"
              >
                Batal
              </button>
            </form>
          )}
        </div>

        <div className="space-y-1 border-t border-app-border pt-3">
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
              {isOwner && (
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
              )}
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
                className="rounded-md bg-app-accent hover:bg-app-accent-hover px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              >
                {savingArWatch ? 'Menyimpan...' : 'Simpan'}
              </button>
              <button
                type="button"
                onClick={() => setEditingArWatch(false)}
                className="rounded-md border border-app-border px-3 py-1.5 text-xs text-app-muted hover:bg-app-soft"
              >
                Batal
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
