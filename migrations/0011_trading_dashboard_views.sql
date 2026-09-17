-- =============================================================================
-- Lobster SC OS (Ernawa) — 3 View untuk Finance Dashboard (Trading Only)
-- =============================================================================
-- Dipakai oleh halaman Finance (/finance, menggantikan ComingSoonPage) untuk
-- 3 metrik trading yang sudah disepakati: margin per kg, capital lock-up,
-- dan hari piutang riil. SEMUA view di sini SUDAH memfilter
-- `sites.type = 'trading'` secara eksplisit di dalam view itu sendiri
-- (bukan mengandalkan filter di client) — sesuai CLAUDE.md aturan #1,
-- jangan pernah blended trading/budidaya.
--
-- Ketiganya row-level (satu baris per delivery / delivery_allocation /
-- settlement, bukan pre-aggregated) — agregasi (avg/sum/count untuk
-- indikator "berdasarkan N transaksi") sengaja dilakukan di frontend, bukan
-- di SQL, karena volume data pilot masih kecil dan ini menjaga view tetap
-- reusable untuk kebutuhan lain nanti.
--
-- security_invoker = true SEJAK AWAL di ketiganya (pelajaran migration
-- 0004 — kalau lupa, view bypass RLS sepenuhnya).
--
-- Migration ini HANYA menambah 3 view baru. Tidak ada DROP/ALTER apa pun.
-- JANGAN dieksekusi ke database sebelum direview oleh pengguna.
-- =============================================================================

-- =============================================================================
-- VIEW 1 — v_trading_delivery_margin
-- =============================================================================
-- Granularitas: PER DELIVERY. Revenue = settlements.amount (aman diambil
-- sekali per delivery karena settlements_delivery_id_unique dari migration
-- 0009 menjamin 1:1 delivery<->settlement). COGS = SUM(qty_kg x
-- buy_price_per_kg) dari SEMUA delivery_allocations milik delivery itu,
-- karena satu delivery bisa menarik dari beberapa batch_line/receiving_lot
-- dengan harga beli berbeda-beda (FEFO bisa gabung beberapa batch).
-- =============================================================================

create view v_trading_delivery_margin
with (security_invoker = true)
as
select
  d.id as delivery_id,
  d.site_id,
  d.actual_weight_kg,
  s.amount as revenue,
  coalesce(cogs.total_cogs, 0) as cogs,
  s.amount - coalesce(cogs.total_cogs, 0) as margin,
  case
    when d.actual_weight_kg > 0 then (s.amount - coalesce(cogs.total_cogs, 0)) / d.actual_weight_kg
    else null
  end as margin_per_kg
from deliveries d
join sites site on site.id = d.site_id
join settlements s on s.delivery_id = d.id
left join (
  select
    da.delivery_id,
    sum(da.qty_kg * rl.buy_price_per_kg) as total_cogs
  from delivery_allocations da
  join batch_lines bl on bl.id = da.batch_line_id
  join receiving_lots rl on rl.id = bl.receiving_lot_id
  group by da.delivery_id
) cogs on cogs.delivery_id = d.id
where site.type = 'trading';

revoke all on v_trading_delivery_margin from public, anon, authenticated;
grant select on v_trading_delivery_margin to authenticated;

-- =============================================================================
-- VIEW 2 — v_trading_capital_lockup
-- =============================================================================
-- Granularitas: PER DELIVERY_ALLOCATION (bukan per delivery) — karena satu
-- delivery bisa menarik dari batch_line dengan received_at (tanggal masuk)
-- yang berbeda-beda, jadi "received_at" tidak well-defined di level
-- delivery. lockup_days = delivered_at - received_at (received_at diambil
-- dari event_at inventory_ledger movement_type='receive' paling awal untuk
-- batch_line itu). Sengaja BERHENTI di delivered_at (barang keluar fisik),
-- BUKAN settled_at — supaya tidak tercampur dengan metrik piutang (view 3).
-- =============================================================================

create view v_trading_capital_lockup
with (security_invoker = true)
as
select
  da.id as delivery_allocation_id,
  da.batch_line_id,
  da.qty_kg,
  d.delivered_at,
  recv.received_at,
  extract(epoch from (d.delivered_at - recv.received_at)) / 86400 as lockup_days
from delivery_allocations da
join deliveries d on d.id = da.delivery_id
join sites site on site.id = d.site_id
join lateral (
  select min(il.event_at) as received_at
  from inventory_ledger il
  where il.batch_line_id = da.batch_line_id
    and il.movement_type = 'receive'
) recv on true
where site.type = 'trading'
  and d.delivered_at is not null
  and recv.received_at is not null;

revoke all on v_trading_capital_lockup from public, anon, authenticated;
grant select on v_trading_capital_lockup to authenticated;

-- =============================================================================
-- VIEW 3 — v_trading_receivable_cycle
-- =============================================================================
-- Granularitas: PER SETTLEMENT, mode='term' yang SUDAH lunas (settled_at
-- IS NOT NULL). days_to_collect = settled_at - created_at — hasil AKTUAL,
-- beda dari due_date yang cuma target/asumsi (due_date tetap disertakan di
-- view untuk kebutuhan lain nanti, mis. bandingkan aktual vs target, tapi
-- TIDAK dipakai untuk metrik "hari piutang riil" ini).
-- =============================================================================

create view v_trading_receivable_cycle
with (security_invoker = true)
as
select
  s.id as settlement_id,
  s.delivery_id,
  s.created_at,
  s.settled_at,
  s.due_date,
  extract(epoch from (s.settled_at - s.created_at)) / 86400 as days_to_collect
from settlements s
join deliveries d on d.id = s.delivery_id
join sites site on site.id = d.site_id
where site.type = 'trading'
  and s.mode = 'term'
  and s.settled_at is not null;

revoke all on v_trading_receivable_cycle from public, anon, authenticated;
grant select on v_trading_receivable_cycle to authenticated;
