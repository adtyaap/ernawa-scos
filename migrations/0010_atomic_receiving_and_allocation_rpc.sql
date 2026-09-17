-- =============================================================================
-- Lobster SC OS (Ernawa) — RPC Atomik: Terima Cepat & Alokasi Kirim
-- =============================================================================
-- Menutup 2 item di CLAUDE.md "Catatan Tech Debt":
--   1. Non-atomicity alur multi-insert dari client (Terima Cepat & Alokasi/Kirim).
--   2. Validasi saldo batch_line di Alokasi & Kirim cuma client-side, tidak
--      ada guard DB-level terhadap race condition concurrent allocation.
--
-- KEDUA FUNCTION DI BAWAH INI SECURITY INVOKER (BUKAN DEFINER) — SENGAJA.
-- Semua tabel yang disentuh (receiving_transactions, receiving_lots,
-- batches, batch_lines, deliveries, delivery_allocations) punya RLS INSERT
-- dengan role-set yang SAMA PERSIS (owner/lead_lapangan/staf_lapangan, dari
-- migration 0003) untuk setiap operasi di dalam masing-masing function —
-- tidak ada kesenjangan privilege yang perlu dijembatani lewat DEFINER.
-- Dengan INVOKER, RLS tetap dikonsultasi persis seperti kalau client insert
-- manual satu-satu seperti sebelumnya — TIDAK ADA celah permission baru
-- yang dibuka, dan tidak perlu ada pengecekan role manual yang bisa basi
-- kalau policy RLS berubah nanti. Trigger yang sudah SECURITY DEFINER
-- (fn_batch_lines_ledger, fn_delivery_allocations_ledger,
-- fn_delivery_allocations_site_guard) tetap terpasang tidak berubah dan
-- tetap jalan otomatis dari dalam function ini seperti biasa.
--
-- Migration ini HANYA menambah 2 function baru (CREATE OR REPLACE
-- FUNCTION). Tidak ada DROP/ALTER apa pun, tidak ada perubahan skema tabel.
-- JANGAN dieksekusi ke database sebelum direview oleh pengguna.
-- =============================================================================

-- =============================================================================
-- FUNGSI 1 — create_receiving_with_batch
-- =============================================================================
-- Membungkus: insert receiving_transactions -> insert receiving_lots (bisa
-- >1 produk) -> get_or_create_batch() -> insert batch_lines (per lot),
-- jadi satu transaksi all-or-nothing. Menggantikan pola 4-langkah
-- berurutan yang sebelumnya di-orkestrasi dari TerimaCepatPage.tsx.
--
-- p_lots: array JSON, satu elemen per produk yang diterima, contoh:
--   [{"product_id": "...", "qty_kg": 12.5, "buy_price_per_kg": 45000}, ...]
--
-- RETURNS TABLE, satu baris per lot yang diproses — frontend dapat semua
-- ID yang relevan (termasuk batch_id & batch_line_id) langsung dari hasil
-- RPC, tidak perlu SELECT terpisah setelah ini sukses.
--
-- CATATAN GAYA: semua variabel lokal sengaja diberi prefix v_ (v_lot,
-- v_product_id, dst.) supaya tidak pernah bentrok/ambigu dengan nama
-- kolom OUT parameter (receiving_transaction_id, batch_id, product_id,
-- receiving_lot_id, batch_line_id) yang dipakai di statement SQL manapun
-- di dalam function ini — klasik gotcha PL/pgSQL kalau nama variabel sama
-- persis dengan nama kolom tabel yang di-query.
-- =============================================================================

create or replace function create_receiving_with_batch(
  p_supplier_id uuid,
  p_site_id uuid,
  p_tank_id uuid,
  p_transaction_date date,
  p_lots jsonb
)
returns table (
  receiving_transaction_id uuid,
  batch_id uuid,
  product_id uuid,
  receiving_lot_id uuid,
  batch_line_id uuid
)
language plpgsql
as $$
declare
  v_receiving_transaction_id uuid;
  v_batch_id uuid;
  v_lot jsonb;
  v_product_id uuid;
  v_receiving_lot_id uuid;
  v_batch_line_id uuid;
begin
  insert into receiving_transactions (supplier_id, site_id, transaction_date, created_by)
  values (p_supplier_id, p_site_id, p_transaction_date, auth.uid())
  returning id into v_receiving_transaction_id;

  v_batch_id := get_or_create_batch(p_site_id, p_tank_id, p_transaction_date);

  for v_lot in select * from jsonb_array_elements(p_lots)
  loop
    v_product_id := (v_lot ->> 'product_id')::uuid;

    insert into receiving_lots (receiving_transaction_id, product_id, qty_kg, buy_price_per_kg)
    values (
      v_receiving_transaction_id,
      v_product_id,
      (v_lot ->> 'qty_kg')::numeric,
      (v_lot ->> 'buy_price_per_kg')::numeric
    )
    returning id into v_receiving_lot_id;

    -- INSERT ini otomatis memicu trigger trg_batch_lines_ledger (SECURITY
    -- DEFINER, sudah ada sejak 0001/0003) yang membuat baris
    -- inventory_ledger movement_type='receive' — tidak berubah.
    insert into batch_lines (batch_id, receiving_lot_id)
    values (v_batch_id, v_receiving_lot_id)
    returning id into v_batch_line_id;

    receiving_transaction_id := v_receiving_transaction_id;
    batch_id := v_batch_id;
    product_id := v_product_id;
    receiving_lot_id := v_receiving_lot_id;
    batch_line_id := v_batch_line_id;
    return next;
  end loop;

  return;
end;
$$;

-- =============================================================================
-- FUNGSI 2 — create_delivery_with_allocations
-- =============================================================================
-- Membungkus: insert deliveries -> insert delivery_allocations (per baris
-- alokasi), jadi satu transaksi all-or-nothing. SEKALIGUS menutup celah
-- race-condition: sebelum tiap insert delivery_allocations, saldo
-- batch_line di-RE-VALIDASI dengan row-level lock (SELECT ... FOR UPDATE
-- OF bl pada batch_lines saja, bukan tabel yang di-JOIN untuk lookup nama)
-- supaya 2 transaksi konkuren tidak bisa lolos oversubscribe saldo yang
-- sama. Kalau saldo tidak cukup di baris manapun, RAISE EXCEPTION dan
-- SELURUH transaksi rollback (termasuk deliveries-nya, bukan cuma
-- delivery_allocations).
--
-- Alokasi diurutkan berdasar batch_line_id SEBELUM loop mengunci (bukan
-- urutan asli dari client) — supaya semua pemanggilan konkuren selalu
-- mengunci batch_line dalam urutan kanonik yang sama, mencegah deadlock
-- kalau 2 delivery yang tumpang tindih batch_line-nya diproses bersamaan.
--
-- p_allocations: array JSON, TANPA override_reason di tiap elemen:
--   [{"batch_line_id": "...", "qty_kg": 12.5, "fefo_rank": 1}, ...]
-- p_override_reason: SATU alasan untuk SELURUH delivery ini (bukan per
-- baris) — sesuai desain yang sudah disepakati (deteksi override FEFO
-- bersifat submission-level, bukan menuduh satu baris spesifik).
--
-- planned_kg DIHITUNG DI SINI dari SUM(p_allocations.qty_kg), bukan
-- dipercaya dari client — mencegah delivery tersimpan dengan planned_kg
-- yang tidak konsisten dengan alokasi sungguhan.
--
-- demands.status -> 'allocated' (kalau p_demand_id diisi) ikut masuk
-- transaksi yang sama — beda dari versi client-orchestrated sebelumnya
-- yang memperlakukan ini sebagai langkah sekunder non-blocking. Sekarang
-- benar-benar atomik penuh, tidak menyisakan celah "alokasi sukses tapi
-- status demand gagal" lagi.
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
  v_locked_batch_line_id uuid;
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

    select bl.id, p.name, t.name
    into v_locked_batch_line_id, v_product_name, v_tank_name
    from batch_lines bl
    join receiving_lots rl on rl.id = bl.receiving_lot_id
    join products p on p.id = rl.product_id
    join batches b on b.id = bl.batch_id
    join tanks t on t.id = b.tank_id
    where bl.id = v_batch_line_id
    for update of bl;

    if v_locked_batch_line_id is null then
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

    -- INSERT ini otomatis memicu trg_delivery_allocations_site_guard
    -- (BEFORE INSERT, migration 0007) dan trg_delivery_allocations_ledger
    -- (AFTER INSERT, migration 0001/0003) — keduanya tidak berubah.
    insert into delivery_allocations (delivery_id, batch_line_id, qty_kg, fefo_rank, override_reason)
    values (v_delivery_id, v_batch_line_id, v_qty, v_fefo_rank, p_override_reason);
  end loop;

  if p_demand_id is not null then
    update demands set status = 'allocated' where id = p_demand_id;
  end if;

  return v_delivery_id;
end;
$$;
