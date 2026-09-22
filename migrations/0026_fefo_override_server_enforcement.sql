-- =============================================================================
-- Lobster SC OS (Ernawa) — Penegakan Override FEFO di Server
-- =============================================================================
-- GAP YANG DITUTUP: deteksi "override FEFO" (memilih batch_line yang bukan
-- paling tua padahal ada batch_line lebih tua dengan saldo tersisa) selama ini
-- HANYA dihitung di client (detectFefoOverride, AlokasiKirimPage.tsx) sebelum
-- submit. create_delivery_with_allocations menyimpan apa pun p_override_reason
-- yang dikirim TANPA verifikasi ulang — client yang dimodifikasi (mis. lewat
-- devtools/panggilan RPC langsung) bisa melewati validasi ini sepenuhnya.
--
-- BUG SEKALIGUS DITEMUKAN: detectFefoOverride versi client TIDAK membandingkan
-- per produk — batch_line produk lain yang kebetulan lebih tua bisa memicu
-- "override" palsu, atau sebaliknya batch_line produk sama yang lebih tua bisa
-- lolos tanpa terdeteksi kalau ada produk lain di antaranya. FEFO hanya
-- bermakna DALAM satu produk yang sama; perbaikan ini menegakkan pembanding
-- per (site, product_id), bukan lintas produk.
--
-- FIX: create_delivery_with_allocations menghitung ulang, untuk setiap produk
-- yang tersentuh alokasi ini, apakah ada batch_line LAIN produk yang sama di
-- site yang sama dengan received_at LEBIH TUA dan saldo tersisa > 0 SETELAH
-- alokasi ini disimulasikan. Kalau ya, p_override_reason WAJIB diisi (tidak
-- boleh NULL/kosong) — kalau tidak, transaksi ditolak dan rollback total
-- (konsisten dengan validasi saldo yang sudah ada).
--
-- Client (AlokasiKirimPage.tsx, commit terpisah) diperbaiki mengikuti logika
-- yang sama (dibandingkan per product_id) supaya peringatan yang tampil di UI
-- selalu konsisten dengan apa yang akan diterima/ditolak server.
--
-- Migration ini HANYA CREATE OR REPLACE FUNCTION (signature & return type
-- tidak berubah, tidak ada perubahan skema tabel). JANGAN dieksekusi sebelum
-- direview.
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

  -- Penegakan FEFO: dibandingkan PER PRODUK (bukan lintas produk berbeda) di
  -- site yang sama. "requested" = qty yang diminta per batch_line pada
  -- panggilan ini; "candidates" = semua batch_line produk yang sama di site
  -- ini beserta saldo & received_at (sama seperti get_available_batch_lines,
  -- 0008); "simulated" = saldo kandidat setelah alokasi ini diterapkan.
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
