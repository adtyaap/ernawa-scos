-- =============================================================================
-- Lobster SC OS (Ernawa) — Status Demand 'partial' (PRD B3)
-- =============================================================================
-- MASALAH: create_delivery_with_allocations (0010/0013) selalu menandai demand
-- 'allocated' walau qty yang dialokasikan lebih kecil dari yang diminta, jadi
-- sisa kebutuhan hilang dari daftar demand terbuka.
--
-- PERUBAHAN:
--   1. demands_status_check ditambah nilai 'partial'. DROP CONSTRAINT +
--      ADD CONSTRAINT dalam satu transaksi (tidak pernah ada momen tanpa
--      constraint). Semua baris yang ada ('open') tetap valid.
--   2. demand_allocated_kg(demand_id): total qty teralokasi ke demand itu.
--      SECURITY DEFINER karena demand bersifat GLOBAL sedangkan
--      delivery_allocations kini ter-scope per site (0017): dengan RLS
--      pemanggil, user yang hanya ditugaskan ke satu site akan melihat total
--      terlalu kecil dan salah menilai demand "belum terpenuhi". Function ini
--      hanya mengembalikan SATU angka agregat (tidak membocorkan baris/site).
--   3. v_demands_with_fulfillment (security_invoker): demands + allocated_kg +
--      remaining_kg, memakai function di atas.
--   4. create_delivery_with_allocations: (a) demand hanya boleh dialokasikan
--      kalau berstatus 'open' atau 'partial'; (b) setelah alokasi, status
--      menjadi 'allocated' bila total >= requested_qty_kg, selain itu
--      'partial'. Advisory lock per demand mencegah dua alokasi konkuren
--      salah menghitung. Signature & return type TIDAK berubah.
--
-- Migration ini mengandung DROP CONSTRAINT (aturan #8): WAJIB direview dan
-- dikonfirmasi eksplisit sebelum dijalankan. Tidak ada DELETE/TRUNCATE/DROP
-- TABLE/DROP COLUMN.
-- =============================================================================

alter table demands drop constraint demands_status_check;
alter table demands add constraint demands_status_check
  check (status in ('open', 'partial', 'allocated', 'fulfilled', 'cancelled'));

create or replace function demand_allocated_kg(p_demand_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(sum(da.qty_kg), 0)
  from delivery_allocations da
  join deliveries d on d.id = da.delivery_id
  where d.demand_id = p_demand_id;
$$;

revoke all on function demand_allocated_kg(uuid) from public, anon;
grant execute on function demand_allocated_kg(uuid) to authenticated;

create or replace view v_demands_with_fulfillment
with (security_invoker = true) as
select
  d.id as demand_id,
  d.requested_qty_kg,
  demand_allocated_kg(d.id) as allocated_kg,
  greatest(d.requested_qty_kg - demand_allocated_kg(d.id), 0) as remaining_kg
from demands d;

revoke all on v_demands_with_fulfillment from public, anon;
grant select on v_demands_with_fulfillment to authenticated;

create or replace function create_delivery_with_allocations(
  p_site_id uuid,
  p_demand_id uuid,
  p_allocations jsonb,
  p_override_reason text default null
)
returns uuid
language plpgsql
as $$
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
  v_available_qty numeric;
  v_demand_status text;
  v_demand_requested numeric;
begin
  select coalesce(sum((elem ->> 'qty_kg')::numeric), 0)
  into v_planned_kg
  from jsonb_array_elements(p_allocations) as elem;

  if v_planned_kg <= 0 then
    raise exception 'Total qty alokasi harus lebih dari 0.';
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

    select bl.id, p.name, t.name
    into v_found_batch_line_id, v_product_name, v_tank_name
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

    insert into delivery_allocations (delivery_id, batch_line_id, qty_kg, fefo_rank, override_reason)
    values (v_delivery_id, v_batch_line_id, v_qty, v_fefo_rank, p_override_reason);
  end loop;

  if p_demand_id is not null then
    update demands
    set status = case when demand_allocated_kg(p_demand_id) >= v_demand_requested then 'allocated' else 'partial' end
    where id = p_demand_id;
  end if;

  return v_delivery_id;
end;
$$;
