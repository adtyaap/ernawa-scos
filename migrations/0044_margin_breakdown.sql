-- Breakdown Margin per Produk & per Segmen Pelanggan (dari perbandingan UI
-- terhadap artifact lama "Lobster Trading Control Tower" -- fitur
-- "Margin per Grade" & "Margin per Segmen Pelanggan" di tab Ringkasan artifact
-- itu belum ada padanannya di sistem sekarang). Dikonfirmasi user lewat
-- pertanyaan eksplisit sebelum dibangun:
--   1. "Grade" diganti jadi "Produk" (jenis lobster) -- grade kualitas
--      (quality_inspections.grade) terikat ke batch_id (inspeksi opsional
--      per batch), TIDAK bertaut bersih ke delivery/settlement (satu batch
--      bisa terkirim ke banyak delivery berbeda). Produk (products.id) sudah
--      bertaut bersih di setiap receiving_lots/delivery_allocations sejak
--      awal, jadi dipakai sbg dimensi breakdown, bukan grade.
--   2. Delivery CAMPURAN (>1 produk dalam satu delivery, mungkin sejak
--      migration 0026) DIKECUALIKAN dari breakdown per-produk -- BUKAN
--      diprorata berdasar qty. settlements.amount itu SATU angka per
--      delivery (bukan per baris produk), jadi revenue per produk pada
--      delivery campuran TIDAK BISA dihitung akurat (asumsi harga/kg sama
--      rata antar produk dalam 1 delivery bisa salah -- sama persis alasan
--      ref_price() tidak bisa hitung harga jual per produk, migration 0028).
--      Ditampilkan terpisah sbg "Campuran" (total saja, tanpa breakdown)
--      supaya jujur soal keterbatasan, bukan mengarang angka.
--   3. Segmen Pelanggan (Restoran/Eksportir/Lainnya) -- kategori sama persis
--      dgn artifact lama. TIDAK kena masalah delivery-campuran krn segmen
--      itu atribut CUSTOMER (satu delivery cuma satu customer), bukan
--      atribut produk.

alter table customers add column segment text check (segment in ('restoran', 'eksportir', 'lainnya'));
comment on column customers.segment is 'Restoran | Eksportir | Lainnya. NULL = belum diklasifikasi (customer lama sebelum kolom ini ada, atau sengaja belum diisi).';

-- Helper: jumlah produk BERBEDA yang terlibat dalam satu delivery (via
-- delivery_allocations -> batch_lines -> receiving_lots). security_invoker
-- krn cuma menurunkan RLS dari tabel-tabel yang di-join, sama pola semua
-- view lain di proyek ini.
create view v_delivery_product_line_count with (security_invoker = true) as
select
  da.delivery_id,
  count(distinct rl.product_id) as n_products,
  (array_agg(rl.product_id))[1] as sole_product_id
from delivery_allocations da
join batch_lines bl on bl.id = da.batch_line_id
join receiving_lots rl on rl.id = bl.receiving_lot_id
group by da.delivery_id;

create view v_trading_margin_by_product with (security_invoker = true) as
select
  p.id as product_id,
  p.name as product_name,
  count(distinct vtdm.delivery_id) as delivery_count,
  sum(vtdm.revenue) as revenue,
  sum(vtdm.cogs) as cogs,
  sum(vtdm.revenue) - sum(vtdm.cogs) as margin,
  case when sum(vtdm.revenue) > 0 then (sum(vtdm.revenue) - sum(vtdm.cogs)) / sum(vtdm.revenue) * 100 else null end as margin_pct
from v_trading_delivery_margin vtdm
join v_delivery_product_line_count dp on dp.delivery_id = vtdm.delivery_id and dp.n_products = 1
join products p on p.id = dp.sole_product_id
group by p.id, p.name;

-- Total delivery campuran, transparan sbg satu baris ringkasan (bukan
-- breakdown per produk) supaya user tahu ada nilai yang sengaja tidak
-- dipecah, bukan hilang diam-diam.
create view v_trading_margin_mixed_summary with (security_invoker = true) as
select
  count(distinct vtdm.delivery_id) as delivery_count,
  coalesce(sum(vtdm.revenue), 0) as revenue,
  coalesce(sum(vtdm.cogs), 0) as cogs,
  coalesce(sum(vtdm.revenue) - sum(vtdm.cogs), 0) as margin
from v_trading_delivery_margin vtdm
join v_delivery_product_line_count dp on dp.delivery_id = vtdm.delivery_id and dp.n_products > 1;

create view v_trading_margin_by_segment with (security_invoker = true) as
select
  coalesce(c.segment, 'belum_diklasifikasi') as segment,
  count(distinct vtdm.delivery_id) as delivery_count,
  sum(vtdm.revenue) as revenue,
  sum(vtdm.cogs) as cogs,
  sum(vtdm.revenue) - sum(vtdm.cogs) as margin,
  case when sum(vtdm.revenue) > 0 then (sum(vtdm.revenue) - sum(vtdm.cogs)) / sum(vtdm.revenue) * 100 else null end as margin_pct
from v_trading_delivery_margin vtdm
join deliveries d on d.id = vtdm.delivery_id
join settlements s on s.delivery_id = d.id
join customers c on c.id = s.customer_id
group by coalesce(c.segment, 'belum_diklasifikasi');

-- Akses investor: pola identik migration 0022 (tidak pernah SELECT view
-- mentah, cuma lewat function SECURITY DEFINER yang menolak jika bukan
-- owner/investor).
create or replace function investor_trading_margin_by_product()
returns setof v_trading_margin_by_product
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_trading_margin_by_product where auth_user_role() in ('owner', 'investor');
$$;

create or replace function investor_trading_margin_mixed_summary()
returns setof v_trading_margin_mixed_summary
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_trading_margin_mixed_summary where auth_user_role() in ('owner', 'investor');
$$;

create or replace function investor_trading_margin_by_segment()
returns setof v_trading_margin_by_segment
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_trading_margin_by_segment where auth_user_role() in ('owner', 'investor');
$$;

revoke all on function investor_trading_margin_by_product() from public, anon;
revoke all on function investor_trading_margin_mixed_summary() from public, anon;
revoke all on function investor_trading_margin_by_segment() from public, anon;
grant execute on function investor_trading_margin_by_product() to authenticated;
grant execute on function investor_trading_margin_mixed_summary() to authenticated;
grant execute on function investor_trading_margin_by_segment() to authenticated;
