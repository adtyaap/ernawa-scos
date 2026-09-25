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
  payment_term_days: number | null;
}

// Hasil view v_trading_dpo_inputs — migration 0045. Granularitas per
// delivery_allocation, sama persis TradingCapitalLockup. payment_term_days
// NULL = supplier belum diklasifikasi (dikecualikan dari rata-rata
// tertimbang DPO di frontend, bukan diasumsikan 0).
export interface TradingDpoInput {
  delivery_allocation_id: string;
  qty_kg: number;
  buy_price_per_kg: number;
  purchase_value: number;
  payment_term_days: number | null;
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
  track: string;
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

// Hasil view v_receiving_trust / v_settlement_trust — migration 0046. Satu
// baris per track (trading/budidaya).
export interface TrustSummary {
  track: string;
  total_value: number;
  verified_value: number;
}

// Hasil fungsi get_mortality_rates() — migration 0046. threshold_pct NULL
// = belum diatur Owner utk site itu (is_overdue selalu false).
export interface MortalityRateRow {
  site_id: string;
  site_name: string;
  track: string;
  received_kg: number;
  mortality_kg: number;
  mortality_pct: number | null;
  threshold_pct: number | null;
  is_overdue: boolean;
}

// Hasil fungsi get_live_inventory() — migration 0050. Satu baris per
// batch_line bersaldo > 0. Persamaan: in - delivered - mortality - shrink
// - transfer_out + correction = balance (correction = baris reversal).
export interface LiveInventoryRow {
  batch_line_id: string;
  site_id: string;
  site_name: string;
  track: string;
  tank_name: string;
  product_id: string;
  product_name: string;
  supplier_name: string | null;
  from_handover: boolean;
  received_at: string | null;
  age_hours: number | null;
  max_holding_hours: number | null;
  is_overdue: boolean;
  in_kg: number;
  delivered_kg: number;
  mortality_kg: number;
  shrink_kg: number;
  transfer_out_kg: number;
  correction_kg: number;
  balance_kg: number;
  buy_price_per_kg: number;
  stock_value: number;
}

export type ShipmentStatus = 'planned' | 'ready' | 'in_transit' | 'delivered' | 'delayed' | 'failed' | 'cancelled';

// Baris tabel shipments — migration 0048.
export interface Shipment {
  id: string;
  shipment_no: string;
  delivery_id: string;
  origin: string | null;
  destination: string | null;
  carrier: string | null;
  vehicle: string | null;
  departed_on: string;
  eta_on: string | null;
  qty_kg: number;
  cost: number;
  transit_mortality_kg: number;
  status: ShipmentStatus;
  status_changed_at: string;
  cancel_reason: string | null;
  created_at: string;
}

// Hasil view v_trading_delivery_pnl — migration 0048. sole_* NULL untuk
// delivery campuran (>1 produk / >1 pemasok) — tidak dipecah.
export interface TradingDeliveryPnl {
  delivery_id: string;
  site_id: string;
  site_name: string;
  customer_id: string;
  customer_name: string;
  segment: string;
  delivered_at: string | null;
  actual_weight_kg: number | null;
  revenue: number;
  cogs: number;
  logistics_cost: number;
  gross_profit: number;
  n_products: number;
  sole_product_id: string | null;
  sole_product_name: string | null;
  n_suppliers: number;
  sole_supplier_id: string | null;
  sole_supplier_name: string | null;
}

// Hasil view v_supplier_payables — migration 0049.
export interface SupplierPayableRow {
  receiving_transaction_id: string;
  site_id: string;
  site_name: string;
  track: string;
  supplier_id: string;
  supplier_name: string;
  payment_term_days: number | null;
  transaction_date: string;
  due_date: string | null;
  days_until_due: number | null;
  amount: number;
  supplier_paid_at: string | null;
  supplier_paid_by: string | null;
}

// Hasil fungsi get_trading_finance_summary() — migration 0050, Owner &
// Investor saja (role lain: tidak ada baris).
export interface TradingFinanceSummary {
  inventory_kg: number;
  inventory_value: number;
  opex_total: number;
  ap_outstanding: number;
  ap_current: number;
  ap_d1_30: number;
  ap_d31_60: number;
  ap_d60_plus: number;
  ap_unclassified_amount: number;
  ap_unclassified_count: number;
}

export interface TradingMortalityCost {
  mortality_kg: number;
  mortality_cost: number;
}
