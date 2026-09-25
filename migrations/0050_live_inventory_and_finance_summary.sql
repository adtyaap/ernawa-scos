-- =============================================================================
-- Lobster SC OS (Ernawa) — Live Inventory, biaya mortalitas, ringkasan Finance
-- =============================================================================
-- Melengkapi modul artifact Lobster Supply Chain OS:
--   * Live Inventory: stok per batch lintas site dgn persamaan persediaan
--     Masuk - Terkirim - Mortalitas - Susut/Reject - Transfer Keluar (+ Koreksi)
--     = Sisa, plus nilai (sisa x harga beli lot) dan umur. Semua dihitung dari
--     inventory_ledger saat query (aturan #2), tidak ada angka tersimpan.
--   * Biaya mortalitas trading (untuk P&L Profitability): kg & Rp mortalitas di
--     site trading yang TIDAK dikoreksi (reversal_of), dinilai harga beli lot.
--     Cuma mortalitas (sama seperti artifact) — susut transit dari Konfirmasi
--     Timbang tidak ditambahkan karena qty-nya sudah ikut di COGS delivery
--     (alokasi memakai qty dialokasikan), menambahkannya = dobel hitung.
--   * Ringkasan Finance (Owner & Investor saja, SECURITY DEFINER): nilai stok
--     trading, opex nyata dari Kas & Bank Perusahaan (migration 0040/0042 —
--     BUKAN angka asumsi manual seperti artifact), dan aging Utang Pemasok
--     (migration 0049). Dibatasi Owner/Investor krn opex & utang adalah data
--     kas level perusahaan (company_cash_ledger SELECT owner-only sejak 0040).
-- Keputusan user: TIDAK ada impor harga acuan statis (varians harga beli &
-- mark-to-market tidak dibangun), TIDAK ada target ROI (cuma Siklus Modal).
-- =============================================================================

create or replace function get_live_inventory()
returns table (
  batch_line_id uuid,
  site_id uuid,
  site_name text,
  track text,
  tank_name text,
  product_id uuid,
  product_name text,
  supplier_name text,
  from_handover boolean,
  received_at timestamptz,
  age_hours numeric,
  max_holding_hours integer,
  is_overdue boolean,
  in_kg numeric,
  delivered_kg numeric,
  mortality_kg numeric,
  shrink_kg numeric,
  transfer_out_kg numeric,
  correction_kg numeric,
  balance_kg numeric,
  buy_price_per_kg numeric,
  stock_value numeric
)
language sql
stable
set search_path to 'public'
as $$
  select
    bl.id,
    s.id,
    s.name,
    s.type::text,
    t.name,
    rl.product_id,
    p.name,
    sup.name,
    rt.supplier_id is null,
    min(il.event_at) filter (where il.movement_type in ('receive', 'transfer_in')),
    extract(epoch from (now() - min(il.event_at) filter (where il.movement_type in ('receive', 'transfer_in')))) / 3600,
    php.max_holding_hours,
    (
      php.max_holding_hours is not null
      and extract(epoch from (now() - min(il.event_at) filter (where il.movement_type in ('receive', 'transfer_in')))) / 3600
          > php.max_holding_hours
    ),
    coalesce(sum(il.qty_kg) filter (where il.movement_type in ('receive', 'transfer_in')), 0),
    coalesce(-sum(il.qty_kg) filter (where il.movement_type = 'delivery'), 0),
    coalesce(-sum(il.qty_kg) filter (where il.movement_type = 'mortality'), 0),
    coalesce(-sum(il.qty_kg) filter (where il.movement_type in ('shrinkage', 'reject')), 0),
    coalesce(-sum(il.qty_kg) filter (where il.movement_type = 'transfer_out'), 0),
    coalesce(sum(il.qty_kg) filter (where il.movement_type = 'adjustment'), 0),
    sum(il.qty_kg),
    rl.buy_price_per_kg,
    sum(il.qty_kg) * rl.buy_price_per_kg
  from batch_lines bl
  join batches b on b.id = bl.batch_id
  join sites s on s.id = b.site_id
  join tanks t on t.id = b.tank_id
  join receiving_lots rl on rl.id = bl.receiving_lot_id
  join receiving_transactions rt on rt.id = rl.receiving_transaction_id
  join products p on p.id = rl.product_id
  left join suppliers sup on sup.id = rt.supplier_id
  left join product_holding_policy php on php.product_id = rl.product_id and php.track = s.type
  join inventory_ledger il on il.batch_line_id = bl.id
  group by bl.id, s.id, s.name, s.type, t.name, rl.product_id, p.name, sup.name, rt.supplier_id,
           php.max_holding_hours, rl.buy_price_per_kg
  having sum(il.qty_kg) > 0
  order by min(il.event_at) filter (where il.movement_type in ('receive', 'transfer_in')) asc nulls last;
$$;

create view v_trading_mortality_cost with (security_invoker = true) as
select
  coalesce(-sum(il.qty_kg), 0) as mortality_kg,
  coalesce(-sum(il.qty_kg * rl.buy_price_per_kg), 0) as mortality_cost
from inventory_ledger il
join batch_lines bl on bl.id = il.batch_line_id
join batches b on b.id = bl.batch_id
join sites s on s.id = b.site_id
join receiving_lots rl on rl.id = bl.receiving_lot_id
where il.movement_type = 'mortality'
  and s.type = 'trading'
  and not exists (select 1 from inventory_ledger r where r.reversal_of = il.id);

create or replace function investor_trading_mortality_cost()
returns setof v_trading_mortality_cost
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_trading_mortality_cost where (select auth_user_role()) in ('owner', 'investor');
$$;

create or replace function get_trading_finance_summary()
returns table (
  inventory_kg numeric,
  inventory_value numeric,
  opex_total numeric,
  ap_outstanding numeric,
  ap_current numeric,
  ap_d1_30 numeric,
  ap_d31_60 numeric,
  ap_d60_plus numeric,
  ap_unclassified_amount numeric,
  ap_unclassified_count integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with inv as (
    select
      coalesce(sum(il.qty_kg), 0) as kg,
      coalesce(sum(il.qty_kg * rl.buy_price_per_kg), 0) as val
    from inventory_ledger il
    join batch_lines bl on bl.id = il.batch_line_id
    join batches b on b.id = bl.batch_id
    join sites s on s.id = b.site_id
    join receiving_lots rl on rl.id = bl.receiving_lot_id
    where s.type = 'trading'
  ),
  opex as (
    select coalesce(-sum(ccl.amount), 0) as total
    from company_cash_ledger ccl
    where ccl.track = 'trading' and ccl.category = 'opex'
  ),
  ap as (
    select
      coalesce(sum(amount) filter (where payment_term_days > 0), 0) as outstanding,
      coalesce(sum(amount) filter (where payment_term_days > 0 and days_until_due >= 0), 0) as cur,
      coalesce(sum(amount) filter (where payment_term_days > 0 and days_until_due between -30 and -1), 0) as d1_30,
      coalesce(sum(amount) filter (where payment_term_days > 0 and days_until_due between -60 and -31), 0) as d31_60,
      coalesce(sum(amount) filter (where payment_term_days > 0 and days_until_due < -60), 0) as d60_plus,
      coalesce(sum(amount) filter (where payment_term_days is null), 0) as unclassified_amount,
      (count(*) filter (where payment_term_days is null))::integer as unclassified_count
    from v_supplier_payables
    where track = 'trading' and supplier_paid_at is null and amount > 0
  )
  select inv.kg, inv.val, opex.total,
         ap.outstanding, ap.cur, ap.d1_30, ap.d31_60, ap.d60_plus,
         ap.unclassified_amount, ap.unclassified_count
  from inv, opex, ap
  where (select auth_user_role()) in ('owner', 'investor');
$$;
