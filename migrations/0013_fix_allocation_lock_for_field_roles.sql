-- =============================================================================
-- Lobster SC OS (Ernawa) — Fix: lead_lapangan/staf_lapangan tidak bisa alokasi
-- =============================================================================
-- BUG YANG DITUTUP: create_delivery_with_allocations (migration 0010) mengunci
-- baris lewat `SELECT ... FOR UPDATE OF bl`. Di Postgres, SELECT FOR UPDATE di
-- tabel ber-RLS mensyaratkan baris lolos policy UPDATE (USING) selain policy
-- SELECT. batch_lines_update (migration 0003) hanya untuk owner, jadi untuk
-- lead_lapangan/staf_lapangan baris itu DIAM-DIAM tersaring -> lookup kosong ->
-- RAISE 'batch_line_id % tidak ditemukan.' padahal barisnya ada dan terlihat.
-- Terverifikasi lewat simulasi role: lookup biasa = 1 baris, FOR UPDATE = 0
-- baris untuk lead_lapangan. Akibatnya HANYA owner yang bisa mengalokasikan.
-- Klaim di komentar 0010 bahwa FOR UPDATE aman untuk role lapangan KELIRU.
--
-- FIX: ganti row-lock dengan pg_advisory_xact_lock per batch_line_id. Advisory
-- lock tidak butuh privilege/policy tabel apa pun, jadi function TETAP
-- SECURITY INVOKER (tidak ada celah permission baru, tidak perlu UPDATE policy
-- baru di batch_lines). Guard race-condition tetap utuh: dua transaksi yang
-- mengalokasikan batch_line sama diserialkan sampai salah satu commit/rollback,
-- lalu SUM(inventory_ledger) dihitung ulang setelah lock didapat. Urutan lock
-- tetap by batch_line_id (deadlock-safe seperti sebelumnya). Lookup eksistensi
-- sekarang SELECT biasa yang tetap tunduk RLS SELECT.
--
-- Kunci lock 'batch_line:<uuid>' DIPAKAI BERSAMA oleh guard mortalitas di
-- migration 0014, supaya mortalitas dan alokasi pada batch_line yang sama
-- saling serial.
--
-- Migration ini HANYA CREATE OR REPLACE FUNCTION (signature & return type
-- tidak berubah, frontend tidak perlu diubah). Tidak ada DROP/ALTER apa pun.
-- JANGAN dieksekusi ke database sebelum direview oleh pengguna.
-- =============================================================================

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
begin
  select coalesce(sum((elem ->> 'qty_kg')::numeric), 0)
  into v_planned_kg
  from jsonb_array_elements(p_allocations) as elem;

  if v_planned_kg <= 0 then
    raise exception 'Total qty alokasi harus lebih dari 0.';
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
    update demands set status = 'allocated' where id = p_demand_id;
  end if;

  return v_delivery_id;
end;
$$;
