// Tipe domain untuk tampilan (hasil embed/gabungan yang tidak ada 1:1 di tabel).
// Skema tabel & fungsi yang SEBENARNYA ada di ./database.ts (hasil generate dari
// Supabase; client Supabase memakainya lewat createClient<Database>). Generate
// ulang database.ts setiap ada migration baru.

export type Track = 'trading' | 'budidaya';

export interface Site {
  id: string;
  name: string;
  type: Track;
}

export interface Tank {
  id: string;
  site_id: string;
  name: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  status: 'aktif' | 'nonaktif';
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
}

export type SettlementMode = 'cod' | 'term';

export type CustomerSegment = 'restoran' | 'eksportir' | 'lainnya';

export interface Customer {
  id: string;
  name: string;
  settlement_mode: SettlementMode;
  payment_term_days: number | null;
  status: 'aktif' | 'nonaktif';
  notes: string | null;
  segment: CustomerSegment | null;
}

export type UserRole = 'owner' | 'lead_lapangan' | 'staf_lapangan' | 'investor';

export interface AppUser {
  id: string;
  full_name: string;
  role: UserRole | null;
  created_at: string;
}

// Hasil RPC get_available_batch_lines(p_site_id) — migration 0008. Sudah
// terurut FEFO (received_at asc) oleh function-nya sendiri, sudah difilter
// ke satu site (parameter wajib, bukan filter opsional).
export interface AvailableBatchLine {
  batch_line_id: string;
  tank_name: string;
  product_id: string;
  product_name: string;
  balance_kg: number;
  received_at: string | null;
  max_holding_hours: number | null;
  age_hours: number | null;
  is_overdue: boolean;
}

// Hasil RPC get_site_forecast(p_site_id, p_history_days, p_forecast_days) —
// migration 0035 (PRD-MASTER site_forecast, dikonfirmasi user setelah
// pembahasan per-item: dibangun meski model masih kasar). Proyeksi rata-rata
// harian dari riwayat penerimaan, SENGAJA sederhana (bukan model
// time-series) -- data_points disertakan supaya user bisa menilai sendiri
// reliabilitasnya, bukan angka tunggal yang terlihat pasti padahal basisnya
// tipis.
export interface SiteForecastRow {
  product_id: string;
  product_name: string;
  data_points: number;
  total_received_kg: number;
  avg_daily_kg: number;
  forecast_kg: number;
  first_received_at: string | null;
  last_received_at: string | null;
}

// Hasil RPC get_fefo_risk_report() — migration 0032. Sama seperti
// AvailableBatchLine tapi lintas-site (site_id/site_name/track ditambahkan,
// TANPA parameter site) dan HANYA baris is_overdue = true yang dikembalikan
// (SECURITY INVOKER — RLS batch_lines/batches yang sudah ada otomatis
// membatasi ke site yang bisa diakses caller, is_overdue selalu true di sini
// tapi kolomnya tetap disertakan biar konsisten bentuknya dgn AvailableBatchLine).
export interface FefoRiskRow {
  batch_line_id: string;
  site_id: string;
  site_name: string;
  track: Track;
  tank_name: string;
  product_id: string;
  product_name: string;
  balance_kg: number;
  received_at: string | null;
  max_holding_hours: number | null;
  age_hours: number | null;
  is_overdue: boolean;
}

// Hasil view v_deliveries_pending_settlement — migration 0009.
export interface PendingSettlementDelivery {
  delivery_id: string;
  site_id: string;
  site_name: string;
  track: Track;
  planned_kg: number;
  actual_weight_kg: number;
  delivered_at: string | null;
  demand_id: string | null;
  customer_id: string | null;
  customer_name: string | null;
  expected_price_per_kg: number | null;
}

// Hasil view v_settlements_aging — migration 0009.
export interface SettlementAgingRow {
  settlement_id: string;
  delivery_id: string;
  customer_id: string;
  customer_name: string;
  mode: SettlementMode;
  amount: number;
  due_date: string | null;
  settled_at: string | null;
  days_until_due: number | null;
}

// Hasil view v_trading_delivery_margin — migration 0011. Granularitas per
// delivery. Sudah difilter site.type='trading' di dalam view.
export interface TradingDeliveryMargin {
  delivery_id: string;
  site_id: string;
  actual_weight_kg: number;
  revenue: number;
  cogs: number;
  margin: number;
  margin_per_kg: number | null;
}

// Hasil view v_trading_capital_lockup — migration 0011. Granularitas per
// delivery_allocation (bukan per delivery — lihat catatan di migration).
export interface TradingCapitalLockup {
  delivery_allocation_id: string;
  batch_line_id: string;
  qty_kg: number;
  delivered_at: string;
  received_at: string;
  lockup_days: number;
}

// Hasil view v_trading_receivable_cycle — migration 0011. Granularitas per
// settlement, mode='term' yang sudah lunas.
export interface TradingReceivableCycle {
  settlement_id: string;
  delivery_id: string;
  created_at: string;
  settled_at: string;
  due_date: string | null;
  days_to_collect: number;
}

// Hasil view v_trading_margin_by_product — migration 0044. Hanya delivery
// SATU-produk (delivery campuran dikecualikan, lihat v_trading_margin_mixed_summary).
export interface TradingMarginByProduct {
  product_id: string;
  product_name: string;
  delivery_count: number;
  revenue: number;
  cogs: number;
  margin: number;
  margin_pct: number | null;
}

// Hasil view v_trading_margin_mixed_summary — migration 0044. Satu baris
// ringkasan (bukan array) untuk semua delivery campuran >1 produk.
export interface TradingMarginMixedSummary {
  delivery_count: number;
  revenue: number;
  cogs: number;
  margin: number;
}

// Hasil view v_trading_margin_by_segment — migration 0044. segment =
// 'belum_diklasifikasi' kalau customers.segment NULL.
export interface TradingMarginBySegment {
  segment: string;
  delivery_count: number;
  revenue: number;
  cogs: number;
  margin: number;
  margin_pct: number | null;
}
