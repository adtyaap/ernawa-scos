-- Kunci harga beli (COGS) saat alokasi, bukan live-join ke harga terbaru
-- (PRD v3 "Migrasi Backend" P10: "Harga beli dikunci pada saat alokasi. COGS
-- sebuah pengiriman memakai harga yang berlaku saat barang dialokasikan,
-- bukan harga terbaru pemasok.").
--
-- MASALAH: `delivery_allocations` TIDAK PUNYA kolom buy_price_per_kg sendiri
-- -- v_trading_delivery_margin (jadi basis P&L Finance, dashboard investor,
-- dan KPICard Margin% yang baru dibangun) selalu JOIN LANGSUNG ke
-- receiving_lots.buy_price_per_kg SAAT QUERY, bukan snapshot harga saat
-- alokasi terjadi. receiving_lots_update RLS memang owner-only, TAPI
-- kebijakan itu sendiri memang mengizinkan owner UPDATE buy_price_per_kg
-- (mis. koreksi salah input) -- kalau itu terjadi SETELAH ada delivery yang
-- sudah dialokasikan dari batch_line itu, margin/COGS delivery LAMA yang
-- sudah dilaporkan akan diam-diam berubah retroaktif tiap kali dashboard
-- Finance dibuka lagi. Ini bertentangan langsung dengan prinsip inti proyek
-- (CLAUDE.md #2/#3: angka historis tidak boleh berubah diam-diam, koreksi
-- harus lewat baris baru yang terlihat, bukan mutasi yang menembus laporan
-- lama). Belum pernah ketahuan karena belum ada UI yang meng-edit
-- receiving_lots.buy_price_per_kg -- tapi RLS-nya sudah mengizinkan, dan
-- kesalahan input harga saat Terima Cepat/Import Excel realistis terjadi.

alter table delivery_allocations add column buy_price_per_kg numeric;

-- Backfill data yang sudah ada: aman dilakukan sekarang (sebelum ada UI edit
-- apa pun ke receiving_lots.buy_price_per_kg), harga hasil JOIN saat ini
-- pasti masih harga ASLI saat alokasi terjadi.
update delivery_allocations da
set buy_price_per_kg = rl.buy_price_per_kg
from batch_lines bl
join receiving_lots rl on rl.id = bl.receiving_lot_id
where bl.id = da.batch_line_id
  and da.buy_price_per_kg is null;

alter table delivery_allocations
  alter column buy_price_per_kg set not null,
  add constraint delivery_allocations_buy_price_per_kg_check check (buy_price_per_kg > 0);

-- create_delivery_with_allocations(): tangkap buy_price_per_kg SAAT alokasi
-- (sudah men-JOIN receiving_lots untuk product_name, tinggal ambil kolom
-- harganya juga), simpan ke delivery_allocations.
create or replace function public.create_delivery_with_allocations(p_site_id uuid, p_demand_id uuid, p_allocations jsonb, p_override_reason text DEFAULT NULL::text)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_delivery_id uuid;
  v_planned_kg numeric;
  v_alloc jsonb;
  v_batch_line_id uuid;
  v_found_batch_line_id uuid;
  v_qty numeric;
  v_fefo_rank integer;
  v_product_name text;
  v_tank_name text;
  v_buy_price_per_kg numeric;
  v_available_qty numeric;
  v_demand_status text;
  v_demand_requested numeric;
  v_requires_override boolean;
begin
  select coalesce(sum((elem ->> 'qty_kg')::numeric), 0)
  into v_planned_kg
  from jsonb_array_elements(p_allocations) as elem;

  if v_planned_kg <= 0 then
    raise exception 'Total qty alokasi harus lebih dari 0.';
  end if;

  with requested as (
    select (elem ->> 'batch_line_id')::uuid as batch_line_id,
           sum((elem ->> 'qty_kg')::numeric) as qty
    from jsonb_array_elements(p_allocations) as elem
    group by 1
  ),
  candidates as (
    select bl.id as batch_line_id,
           rl.product_id,
           min(il.event_at) filter (where il.movement_type = 'receive') as received_at,
           coalesce(sum(il.qty_kg), 0) as balance_kg
    from batch_lines bl
    join receiving_lots rl on rl.id = bl.receiving_lot_id
    join batches b on b.id = bl.batch_id
    left join inventory_ledger il on il.batch_line_id = bl.id
    where b.site_id = p_site_id
      and rl.product_id in (
        select rl2.product_id
        from requested req
        join batch_lines bl2 on bl2.id = req.batch_line_id
        join receiving_lots rl2 on rl2.id = bl2.receiving_lot_id
      )
    group by bl.id, rl.product_id
  ),
  simulated as (
    select c.batch_line_id, c.product_id, c.received_at,
           c.balance_kg - coalesce(r.qty, 0) as remaining_kg
    from candidates c
    left join requested r on r.batch_line_id = c.batch_line_id
  ),
  selected as (
    select s.product_id, s.received_at
    from simulated s
    join requested r on r.batch_line_id = s.batch_line_id
    where s.received_at is not null
  )
  select exists (
    select 1
    from selected sel
    join simulated older
      on older.product_id = sel.product_id
     and older.received_at is not null
     and older.received_at < sel.received_at
     and older.remaining_kg > 0
  )
  into v_requires_override;

  if v_requires_override and (p_override_reason is null or btrim(p_override_reason) = '') then
    raise exception 'Ada batch_line produk yang sama, lebih tua, dan masih tersedia tapi dilewati. Wajib isi alasan override FEFO.';
  end if;

  if p_demand_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('demand:' || p_demand_id::text, 0));

    select status, requested_qty_kg into v_demand_status, v_demand_requested
    from demands where id = p_demand_id;

    if v_demand_status is null then
      raise exception 'Demand % tidak ditemukan.', p_demand_id;
    end if;
    if v_demand_status not in ('open', 'partial') then
      raise exception 'Demand berstatus "%" tidak bisa dialokasikan lagi.', v_demand_status;
    end if;
  end if;

  insert into deliveries (site_id, planned_kg, demand_id, created_by)
  values (p_site_id, v_planned_kg, p_demand_id, auth.uid())
  returning id into v_delivery_id;

  for v_alloc in
    select value
    from jsonb_array_elements(p_allocations) as value
    order by (value ->> 'batch_line_id')::uuid
  loop
    v_batch_line_id := (v_alloc ->> 'batch_line_id')::uuid;
    v_qty := (v_alloc ->> 'qty_kg')::numeric;
    v_fefo_rank := (v_alloc ->> 'fefo_rank')::integer;

    perform pg_advisory_xact_lock(hashtextextended('batch_line:' || v_batch_line_id::text, 0));

    select bl.id, p.name, t.name, rl.buy_price_per_kg
    into v_found_batch_line_id, v_product_name, v_tank_name, v_buy_price_per_kg
    from batch_lines bl
    join receiving_lots rl on rl.id = bl.receiving_lot_id
    join products p on p.id = rl.product_id
    join batches b on b.id = bl.batch_id
    join tanks t on t.id = b.tank_id
    where bl.id = v_batch_line_id;

    if v_found_batch_line_id is null then
      raise exception 'batch_line_id % tidak ditemukan.', v_batch_line_id;
    end if;

    select coalesce(sum(qty_kg), 0)
    into v_available_qty
    from inventory_ledger
    where batch_line_id = v_batch_line_id;

    if v_available_qty < v_qty then
      raise exception
        'Saldo tidak cukup untuk batch_line % (produk: %, tank: %): diminta % kg, tersedia % kg.',
        v_batch_line_id, v_product_name, v_tank_name, v_qty, v_available_qty;
    end if;

    insert into delivery_allocations (delivery_id, batch_line_id, qty_kg, fefo_rank, override_reason, buy_price_per_kg)
    values (v_delivery_id, v_batch_line_id, v_qty, v_fefo_rank, p_override_reason, v_buy_price_per_kg);
  end loop;

  if p_demand_id is not null then
    update demands
    set status = case when demand_allocated_kg(p_demand_id) >= v_demand_requested then 'allocated' else 'partial' end
    where id = p_demand_id;
  end if;

  return v_delivery_id;
end;
$function$;

-- v_trading_delivery_margin: pakai harga TERKUNCI (delivery_allocations),
-- bukan live-join ke receiving_lots lagi. investor_trading_delivery_margin()
-- cukup delegasi ke view ini (select * from v_trading_delivery_margin), jadi
-- otomatis ikut benar tanpa perlu diubah terpisah.
create or replace view public.v_trading_delivery_margin
with (security_invoker = true) as
select
  d.id as delivery_id,
  d.site_id,
  d.actual_weight_kg,
  s.amount as revenue,
  coalesce(cogs.total_cogs, 0::numeric) as cogs,
  s.amount - coalesce(cogs.total_cogs, 0::numeric) as margin,
  case
    when d.actual_weight_kg > 0::numeric then (s.amount - coalesce(cogs.total_cogs, 0::numeric)) / d.actual_weight_kg
    else null::numeric
  end as margin_per_kg
from deliveries d
join sites site on site.id = d.site_id
join settlements s on s.delivery_id = d.id
left join (
  select da.delivery_id, sum(da.qty_kg * da.buy_price_per_kg) as total_cogs
  from delivery_allocations da
  group by da.delivery_id
) cogs on cogs.delivery_id = d.id
where site.type = 'trading'::site_type and d.cancelled_at is null;
