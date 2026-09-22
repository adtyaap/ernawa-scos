-- Serah Terima (Handover) antar site — perbaikan gap sejak migration 0001.
--
-- MASALAH: trigger fn_handover_lines_ledger() yang sudah ada menulis
-- 'transfer_out' DAN 'transfer_in' ke batch_line_id yang SAMA (batch_line asal),
-- sehingga netnya nol dan tidak ada batch_line baru di site tujuan. Handover
-- sebenarnya tidak pernah memindahkan stok secara riil ke site lain sejak
-- schema ini dibuat — cuma no-op. Root cause: batch_lines.receiving_lot_id
-- NOT NULL, seluruh rantai batch_lines->receiving_lots->receiving_transactions
-- mengasumsikan stok selalu berasal dari pembelian ke supplier, tidak ada
-- jalur untuk batch_line yang asalnya transfer internal.
--
-- DESAIN: dua langkah, dua aktor (empat alasan sekaligus: (1) sesuai bahasa PRD
-- "dua pihak konfirmasi", (2) fisik cocok — barang lepas dari asal saat
-- dikirim, baru benar-benar "ada" di tujuan saat diterima, (3) memecahkan
-- masalah RLS — pengirim cuma perlu akses site asal, penerima cuma perlu akses
-- site tujuan, tidak ada satu RPC yang butuh akses KEDUA site sekaligus,
-- (4) qty diterima boleh beda dari qty dikirim [konfirmasi user] — selisih
-- (mis. mortalitas selama transit) otomatis tercatat sebagai 'shrinkage' di
-- ledger site asal.
--
-- 1) KIRIM — create_handover_dispatch(): dijalankan orang di site asal (RLS:
--    user_can_access_site(from_site_id)). Mengunci & validasi saldo batch_line
--    asal, insert handovers+handover_lines. INSERT ke handover_lines memicu
--    trigger fn_handover_lines_ledger (SECURITY DEFINER, sudah ada sejak 0001,
--    diperbaiki di sini) yang LANGSUNG mencatat transfer_out di batch_line
--    asal — barang dianggap "di jalan", saldo asal berkurang seketika (juga
--    mencegah race condition: batch_line yang sedang di-handover tidak bisa
--    dialokasikan lagi ke delivery lain).
--
-- 2) KONFIRMASI TERIMA — confirm_handover_receipt(): dijalankan orang di site
--    tujuan (RLS: user_can_access_site(to_site_id) lewat kolom baru di
--    handovers_update/handover_lines_update). Membuat receiving_transaction
--    SINTETIS (supplier_id NULL, source_handover_id terisi — bukan pembelian
--    riil, harga pokok diwariskan dari batch_line asal supaya kontinuitas
--    margin), receiving_lot, dan batch_line BARU di site tujuan (lewat
--    get_or_create_batch, tank dipilih penerima saat konfirmasi). INSERT
--    batch_line ini memicu fn_batch_lines_ledger (diperbaiki di sini supaya
--    pakai movement_type='transfer_in', bukan 'receive', untuk baris yang
--    asalnya handover). Kalau qty diterima < qty dikirim, trigger
--    fn_handover_lines_confirm_variance (SECURITY DEFINER, baru) membalik
--    baris transfer_out awal (reversal_of, bukan UPDATE — rule #3) dan
--    menggantinya dengan transfer_out sejumlah qty diterima + shrinkage
--    sejumlah selisihnya, keduanya di batch_line asal. inventory_ledger INSERT
--    policy owner-only (rule keamanan sejak awal) — makanya koreksi varian ini
--    HARUS lewat trigger SECURITY DEFINER, tidak bisa langsung di RPC yang
--    SECURITY INVOKER (persis kenapa 'receive'/'transfer_in' normal juga lewat
--    trigger, bukan insert langsung).
--
-- ref_price() (VWAP, migration 0028) diperbarui mengecualikan
-- receiving_transactions yang asalnya handover (source_handover_id not null)
-- dari perhitungan — kalau tidak, stok yang cuma "pindah tangan" akan
-- terhitung seolah-olah pembelian baru dan memalsukan sinyal harga.

-- === 1. Kolom baru ===================================================

alter table handovers
  add column received_at timestamptz null,
  add column to_tank_id uuid null references tanks(id),
  add column received_business_date date null;

alter table handover_lines
  add column qty_kg_received numeric null,
  add column to_batch_line_id uuid null references batch_lines(id);

alter table handover_lines
  add constraint handover_lines_qty_kg_received_check
  check (qty_kg_received is null or (qty_kg_received > 0 and qty_kg_received <= qty_kg));

alter table receiving_transactions
  alter column supplier_id drop not null,
  add column source_handover_id uuid null references handovers(id);

alter table receiving_transactions
  add constraint receiving_transactions_origin_check
  check (
    (supplier_id is not null and source_handover_id is null)
    or (supplier_id is null and source_handover_id is not null)
  );

-- === 2. Perbaiki trigger existing =====================================

-- Sebelumnya: insert transfer_out DAN transfer_in ke NEW.batch_line_id yang
-- sama (bug, net nol). Sekarang: HANYA transfer_out di batch_line asal, saat
-- dispatch. Leg transfer_in ditangani terpisah lewat batch_lines insert di
-- confirm_handover_receipt (lewat fn_batch_lines_ledger di bawah).
create or replace function public.fn_handover_lines_ledger()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_handover handovers%rowtype;
begin
  select * into v_handover from handovers where id = NEW.handover_id;

  insert into inventory_ledger (
    batch_line_id, movement_type, qty_kg, event_at,
    ref_type, ref_id, user_id, client_id
  ) values (
    NEW.batch_line_id, 'transfer_out', -NEW.qty_kg, v_handover.handed_over_at,
    'handover_lines', NEW.id, v_handover.handed_by, NEW.id
  );

  return NEW;
end;
$function$;

-- Movement type 'transfer_in' untuk batch_line yang lahir dari konfirmasi
-- handover (source_handover_id terisi), 'receive' seperti semula untuk
-- pembelian riil. Tidak mengubah perilaku untuk baris yang sudah ada.
create or replace function public.fn_batch_lines_ledger()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_lot receiving_lots%rowtype;
  v_txn receiving_transactions%rowtype;
  v_movement_type text;
begin
  select * into v_lot from receiving_lots where id = NEW.receiving_lot_id;
  select * into v_txn from receiving_transactions where id = v_lot.receiving_transaction_id;

  v_movement_type := case when v_txn.source_handover_id is not null then 'transfer_in' else 'receive' end;

  insert into inventory_ledger (
    batch_line_id, movement_type, qty_kg, event_at,
    ref_type, ref_id, user_id, client_id
  ) values (
    NEW.id, v_movement_type::movement_type, v_lot.qty_kg, v_txn.transaction_date::timestamptz,
    'batch_lines', NEW.id, v_txn.created_by, NEW.id
  );

  return NEW;
end;
$function$;

-- === 3. Trigger baru: koreksi varian saat konfirmasi terima ===========

create or replace function public.fn_handover_lines_confirm_variance()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_variance numeric;
  v_orig_ledger inventory_ledger%rowtype;
begin
  v_variance := NEW.qty_kg - NEW.qty_kg_received;

  if v_variance > 0 then
    select * into v_orig_ledger from inventory_ledger
    where ref_type = 'handover_lines' and ref_id = NEW.id
      and movement_type = 'transfer_out' and reversal_of is null;

    if not found then
      raise exception 'Baris ledger transfer_out asal untuk handover_line % tidak ditemukan.', NEW.id;
    end if;

    -- Balikkan transfer_out awal (qty penuh saat dispatch) — reversal, bukan
    -- update, sesuai rule #3.
    insert into inventory_ledger (batch_line_id, movement_type, qty_kg, event_at, ref_type, ref_id, reversal_of, user_id, client_id)
    values (NEW.batch_line_id, 'transfer_out', -v_orig_ledger.qty_kg, now(), 'handover_lines', NEW.id, v_orig_ledger.id, auth.uid(), gen_random_uuid());

    -- Ganti dengan transfer_out sejumlah qty yang benar-benar sampai...
    insert into inventory_ledger (batch_line_id, movement_type, qty_kg, event_at, ref_type, ref_id, user_id, client_id)
    values (NEW.batch_line_id, 'transfer_out', -NEW.qty_kg_received, now(), 'handover_lines', NEW.id, auth.uid(), gen_random_uuid());

    -- ...dan shrinkage untuk selisih yang hilang selama perjalanan.
    insert into inventory_ledger (batch_line_id, movement_type, qty_kg, event_at, ref_type, ref_id, user_id, client_id)
    values (NEW.batch_line_id, 'shrinkage', -v_variance, now(), 'handover_lines', NEW.id, auth.uid(), gen_random_uuid());
  end if;

  return NEW;
end;
$function$;

create trigger trg_handover_lines_confirm_variance
after update of qty_kg_received on handover_lines
for each row
when (old.qty_kg_received is null and new.qty_kg_received is not null)
execute function fn_handover_lines_confirm_variance();

revoke execute on function public.fn_handover_lines_confirm_variance() from public, anon, authenticated;

-- === 4. RLS: izinkan site tujuan mengonfirmasi (bukan cuma owner) ======

drop policy if exists handovers_update on handovers;
create policy handovers_update on handovers for update
using (
  auth_user_role() = 'owner'
  or (received_by is null and user_can_access_site(to_site_id))
)
with check (
  auth_user_role() = 'owner'
  or user_can_access_site(to_site_id)
);

drop policy if exists handover_lines_update on handover_lines;
create policy handover_lines_update on handover_lines for update
using (
  auth_user_role() = 'owner'
  or (
    qty_kg_received is null
    and exists (select 1 from handovers h where h.id = handover_lines.handover_id and user_can_access_site(h.to_site_id))
  )
)
with check (
  auth_user_role() = 'owner'
  or exists (select 1 from handovers h where h.id = handover_lines.handover_id and user_can_access_site(h.to_site_id))
);

-- === 5. RPC: Kirim (dispatch) ==========================================

create or replace function public.create_handover_dispatch(
  p_from_site_id uuid,
  p_to_site_id uuid,
  p_lines jsonb,
  p_notes text default null,
  p_client_id uuid default gen_random_uuid()
) returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_handover_id uuid;
  v_line jsonb;
  v_batch_line_id uuid;
  v_qty numeric;
  v_found_batch_line_id uuid;
  v_product_name text;
  v_tank_name text;
  v_available_qty numeric;
  v_line_count int := 0;
begin
  if p_from_site_id = p_to_site_id then
    raise exception 'Site asal dan site tujuan tidak boleh sama.';
  end if;

  insert into handovers (from_site_id, to_site_id, handed_over_at, handed_by, notes, client_id)
  values (p_from_site_id, p_to_site_id, now(), auth.uid(), p_notes, p_client_id)
  returning id into v_handover_id;

  for v_line in
    select value from jsonb_array_elements(p_lines) as value
    order by (value ->> 'batch_line_id')::uuid
  loop
    v_line_count := v_line_count + 1;
    v_batch_line_id := (v_line ->> 'batch_line_id')::uuid;
    v_qty := (v_line ->> 'qty_kg')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Qty handover harus lebih dari 0.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('batch_line:' || v_batch_line_id::text, 0));

    select bl.id, p.name, t.name
    into v_found_batch_line_id, v_product_name, v_tank_name
    from batch_lines bl
    join receiving_lots rl on rl.id = bl.receiving_lot_id
    join products p on p.id = rl.product_id
    join batches b on b.id = bl.batch_id
    join tanks t on t.id = b.tank_id
    where bl.id = v_batch_line_id
      and b.site_id = p_from_site_id;

    if v_found_batch_line_id is null then
      raise exception 'batch_line_id % tidak ditemukan di site asal.', v_batch_line_id;
    end if;

    select coalesce(sum(qty_kg), 0) into v_available_qty
    from inventory_ledger where batch_line_id = v_batch_line_id;

    if v_available_qty < v_qty then
      raise exception 'Saldo tidak cukup untuk batch_line % (produk: %, tank: %): diminta % kg, tersedia % kg.',
        v_batch_line_id, v_product_name, v_tank_name, v_qty, v_available_qty;
    end if;

    insert into handover_lines (handover_id, batch_line_id, qty_kg)
    values (v_handover_id, v_batch_line_id, v_qty);
  end loop;

  if v_line_count = 0 then
    raise exception 'Minimal satu baris handover harus diisi.';
  end if;

  return v_handover_id;
end;
$function$;

-- === 6. RPC: Konfirmasi Terima ==========================================

create or replace function public.confirm_handover_receipt(
  p_handover_id uuid,
  p_to_tank_id uuid,
  p_business_date date,
  p_lines jsonb
) returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_updated int;
  v_line jsonb;
  v_handover_line_id uuid;
  v_qty_received numeric;
  v_hl handover_lines%rowtype;
  v_origin_product_id uuid;
  v_origin_price numeric;
  v_to_site_id uuid;
  v_txn_id uuid;
  v_lot_id uuid;
  v_batch_id uuid;
  v_new_batch_line_id uuid;
  v_line_count int := 0;
begin
  select to_site_id into v_to_site_id from handovers where id = p_handover_id;
  if v_to_site_id is null then
    raise exception 'Handover % tidak ditemukan.', p_handover_id;
  end if;

  if not exists (select 1 from tanks where id = p_to_tank_id and site_id = v_to_site_id) then
    raise exception 'Tank tujuan tidak valid untuk site tujuan handover ini.';
  end if;

  update handovers
  set received_by = auth.uid(), received_at = now(), to_tank_id = p_to_tank_id, received_business_date = p_business_date
  where id = p_handover_id and received_by is null;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Handover % sudah dikonfirmasi sebelumnya, atau Anda tidak punya akses ke site tujuan.', p_handover_id;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) as value
  loop
    v_line_count := v_line_count + 1;
    v_handover_line_id := (v_line ->> 'handover_line_id')::uuid;
    v_qty_received := (v_line ->> 'qty_kg_received')::numeric;

    select * into v_hl from handover_lines
    where id = v_handover_line_id and handover_id = p_handover_id;

    if not found then
      raise exception 'handover_line_id % tidak ditemukan pada handover ini.', v_handover_line_id;
    end if;

    if v_hl.qty_kg_received is not null then
      raise exception 'Baris handover % sudah dikonfirmasi sebelumnya.', v_handover_line_id;
    end if;

    if v_qty_received is null or v_qty_received <= 0 or v_qty_received > v_hl.qty_kg then
      raise exception 'Qty diterima untuk baris % harus > 0 dan tidak boleh lebih dari qty dikirim (% kg).',
        v_handover_line_id, v_hl.qty_kg;
    end if;

    select rl.product_id, rl.buy_price_per_kg
    into v_origin_product_id, v_origin_price
    from batch_lines bl
    join receiving_lots rl on rl.id = bl.receiving_lot_id
    where bl.id = v_hl.batch_line_id;

    insert into receiving_transactions (supplier_id, site_id, transaction_date, source_handover_id, created_by)
    values (null, v_to_site_id, p_business_date, p_handover_id, auth.uid())
    returning id into v_txn_id;

    insert into receiving_lots (receiving_transaction_id, product_id, qty_kg, buy_price_per_kg)
    values (v_txn_id, v_origin_product_id, v_qty_received, v_origin_price)
    returning id into v_lot_id;

    v_batch_id := get_or_create_batch(v_to_site_id, p_to_tank_id, p_business_date);

    insert into batch_lines (batch_id, receiving_lot_id)
    values (v_batch_id, v_lot_id)
    returning id into v_new_batch_line_id;

    update handover_lines
    set qty_kg_received = v_qty_received, to_batch_line_id = v_new_batch_line_id
    where id = v_handover_line_id;
  end loop;

  if v_line_count = 0 then
    raise exception 'Minimal satu baris konfirmasi harus diisi.';
  end if;
end;
$function$;

-- === 7. ref_price(): kecualikan stok asal handover dari VWAP ===========

create or replace function public.ref_price(p_product_id uuid, p_site_id uuid, p_date date default current_date)
returns table(price numeric, source text)
language plpgsql
stable
as $function$
declare
  v_price numeric;
begin
  select pt.price into v_price
  from price_today pt
  where pt.product_id = p_product_id and pt.site_id = p_site_id and pt.effective_date = p_date;
  if v_price is not null then
    price := v_price; source := 'override'; return next; return;
  end if;

  select sum(rl.qty_kg * rl.buy_price_per_kg) / nullif(sum(rl.qty_kg), 0)
  into v_price
  from receiving_lots rl
  join receiving_transactions rt on rt.id = rl.receiving_transaction_id
  where rl.product_id = p_product_id
    and rt.site_id = p_site_id
    and rt.source_handover_id is null
    and rt.transaction_date > p_date - 7
    and rt.transaction_date <= p_date;
  if v_price is not null then
    price := v_price; source := 'vwap7_site'; return next; return;
  end if;

  select sum(rl.qty_kg * rl.buy_price_per_kg) / nullif(sum(rl.qty_kg), 0)
  into v_price
  from receiving_lots rl
  join receiving_transactions rt on rt.id = rl.receiving_transaction_id
  where rl.product_id = p_product_id
    and rt.source_handover_id is null
    and rt.transaction_date > p_date - 7
    and rt.transaction_date <= p_date;
  if v_price is not null then
    price := v_price; source := 'vwap7_all_site'; return next; return;
  end if;

  select sum(rl.qty_kg * rl.buy_price_per_kg) / nullif(sum(rl.qty_kg), 0)
  into v_price
  from receiving_lots rl
  join receiving_transactions rt on rt.id = rl.receiving_transaction_id
  where rl.product_id = p_product_id
    and rt.source_handover_id is null
    and rt.transaction_date > p_date - 30
    and rt.transaction_date <= p_date;
  if v_price is not null then
    price := v_price; source := 'vwap30_all_site'; return next; return;
  end if;

  price := null; source := 'none'; return next; return;
end;
$function$;
