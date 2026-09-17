-- =============================================================================
-- Lobster SC OS (Ernawa) — Role-Based RLS
-- =============================================================================
-- Menggantikan baseline "authenticated = full access" dari migration 0001
-- (lihat TODO di 0001, bagian ROW LEVEL SECURITY) dengan policy berbasis
-- users.role: 'owner', 'lead_lapangan', 'staf_lapangan', 'investor'.
--
-- ATURAN AKSES (per instruksi pengguna):
--   - owner: full SELECT/INSERT/UPDATE di semua tabel, KECUALI inventory_ledger,
--     cash_ledger, audit_log — tetap append-only untuk semua role (sudah
--     diperkuat trigger ledger_immutable() sejak 0001, di sini juga tidak
--     diberi policy UPDATE sama sekali, termasuk untuk owner).
--   - lead_lapangan & staf_lapangan (diperlakukan sama untuk sekarang):
--       * SELECT semua tabel master (sites, tanks, products,
--         product_holding_policy, suppliers, customers).
--       * INSERT HANYA di suppliers & customers (nelayan/pembeli baru di
--         lapangan) — TIDAK BOLEH insert/update sites, tanks, products,
--         product_holding_policy (domain owner).
--       * Tabel operasional: SELECT + INSERT, TIDAK ADA UPDATE/DELETE —
--         KECUALI dua pengecualian kolom-terbatas: `demands.status` dan
--         `deliveries.actual_weight_kg` / `deliveries.delivered_at` (lihat
--         bagian PROTEKSI KOLOM di akhir file).
--       * TIDAK PERNAH insert langsung ke inventory_ledger — ledger hanya
--         terisi lewat trigger otomatis (lihat bagian KOREKSI di bawah).
--       * Belum ada pembatasan per site pada fase pilot ini.
--   - investor: TIDAK diberi policy SELECT di tabel manapun untuk sekarang
--     (default-deny RLS). Akses lewat view ringkasan khusus menyusul di
--     migration terpisah.
--
-- CATATAN ASUMSI (di luar instruksi eksplisit, ditulis di sini secara
-- transparan supaya bisa dikoreksi saat review):
--   1. `batches` tidak disebut eksplisit di daftar tabel operasional, tapi
--      diberi perlakuan sama (SELECT+INSERT untuk lead/staf, tanpa
--      UPDATE/DELETE) karena get_or_create_batch() melakukan INSERT ke
--      batches atas nama user yang memanggil (fungsi ini invoker-rights,
--      bukan security definer) — tanpa policy INSERT ini, alur penerimaan
--      barang oleh lead/staf lapangan akan gagal di tengah jalan.
--   2. [SELESAI DIPERBAIKI] `inventory_ledger` TIDAK lagi diberi INSERT
--      untuk lead/staf — hanya SELECT. Jalur insert ledger sekarang HANYA
--      lewat 4 fungsi trigger yang sudah diubah jadi SECURITY DEFINER
--      (fn_mortality_events_ledger, fn_batch_lines_ledger,
--      fn_handover_lines_ledger, fn_delivery_allocations_ledger), yang
--      tetap berjalan normal walau pemanggilnya bukan owner karena
--      dieksekusi sebagai role pemilik fungsi (bypass RLS), bukan sebagai
--      role pemanggil.
--   3. `cash_ledger` dan `audit_log` DIBATASI owner-only (SELECT+INSERT),
--      karena tidak disebut di daftar tabel operasional lead/staf dan
--      sifatnya sensitif (kas & audit trail).
--   4. `price_today` diberi SELECT untuk owner+lead+staf (field staff perlu
--      tahu harga acuan hari ini), tapi INSERT tetap owner-only (penentuan
--      harga acuan adalah keputusan sentral). Tidak disebut eksplisit di
--      instruksi — mohon dikoreksi kalau salah asumsi.
--   5. [SELESAI DIPERBAIKI] `demands` dan `deliveries` sekarang punya
--      pengecualian UPDATE kolom-terbatas untuk lead/staf (status; dan
--      actual_weight_kg/delivered_at) lewat trigger
--      fn_demands_restrict_field_update / fn_deliveries_restrict_field_update
--      — bukan lagi owner-only penuh seperti draf sebelumnya.
--   6. Perbaikan celah role di `users` diperluas ke jalur INSERT juga, tidak
--      cuma UPDATE seperti yang diminta eksplisit — kalau tidak dibatasi,
--      user baru bisa self-insert langsung dengan role='owner' dan celah
--      yang sama pindah jalur. Konsekuensinya: bootstrap owner PERTAMA kali
--      wajib dilakukan lewat akses langsung ke database (service_role /
--      SQL editor Supabase yang bypass RLS), bukan lewat alur aplikasi biasa.
--
-- Migration ini HANYA mengubah policy RLS (DROP + CREATE POLICY) dan
-- menambah 1 CHECK constraint + 1 trigger. Tidak ada DROP TABLE/COLUMN.
-- JANGAN dieksekusi ke database sebelum direview oleh pengguna.
-- =============================================================================

-- =============================================================================
-- STRUKTUR ROLE
-- =============================================================================

alter table users
  add constraint users_role_check
  check (role in ('owner', 'lead_lapangan', 'staf_lapangan', 'investor'));

-- Helper: role user yang sedang login. SECURITY DEFINER supaya tetap bisa
-- dipakai di dalam policy tabel lain tanpa bergantung pada policy SELECT
-- `users` yang berlaku saat itu (mis. kalau nanti policy SELECT users
-- diperketat lebih lanjut). Hanya membaca baris milik auth.uid() sendiri,
-- jadi tidak membuka kebocoran data.
create or replace function auth_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from users where id = auth.uid();
$$;

-- =============================================================================
-- KOREKSI: 4 fungsi trigger auto-insert ledger (dari 0001) jadi SECURITY
-- DEFINER, supaya jalur insert ke inventory_ledger HANYA lewat trigger ini
-- (jalan sebagai role pemilik fungsi/tabel, otomatis lolos RLS), TIDAK
-- PERNAH lewat insert manual langsung oleh staf. Policy INSERT langsung ke
-- inventory_ledger untuk lead_lapangan/staf_lapangan dicabut di bagian
-- KATEGORI D di bawah.
-- =============================================================================

create or replace function fn_mortality_events_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ledger_id uuid;
begin
  insert into inventory_ledger (
    batch_line_id, movement_type, qty_kg, event_at,
    ref_type, ref_id, user_id, client_id
  ) values (
    NEW.batch_line_id, 'mortality', -NEW.qty_kg, NEW.event_at,
    'mortality_events', NEW.id, NEW.recorded_by, NEW.id
  )
  returning id into v_ledger_id;

  update mortality_events set inventory_ledger_id = v_ledger_id where id = NEW.id;

  return NEW;
end;
$$;

create or replace function fn_batch_lines_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot receiving_lots%rowtype;
  v_txn receiving_transactions%rowtype;
begin
  select * into v_lot from receiving_lots where id = NEW.receiving_lot_id;
  select * into v_txn from receiving_transactions where id = v_lot.receiving_transaction_id;

  insert into inventory_ledger (
    batch_line_id, movement_type, qty_kg, event_at,
    ref_type, ref_id, user_id, client_id
  ) values (
    NEW.id, 'receive', v_lot.qty_kg, v_txn.transaction_date::timestamptz,
    'batch_lines', NEW.id, v_txn.created_by, NEW.id
  );

  return NEW;
end;
$$;

create or replace function fn_handover_lines_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

  insert into inventory_ledger (
    batch_line_id, movement_type, qty_kg, event_at,
    ref_type, ref_id, user_id, client_id
  ) values (
    NEW.batch_line_id, 'transfer_in', NEW.qty_kg, v_handover.handed_over_at,
    'handover_lines', NEW.id, v_handover.received_by, md5(NEW.id::text || ':transfer_in')::uuid
  );

  return NEW;
end;
$$;

create or replace function fn_delivery_allocations_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery deliveries%rowtype;
begin
  select * into v_delivery from deliveries where id = NEW.delivery_id;

  insert into inventory_ledger (
    batch_line_id, movement_type, qty_kg, event_at,
    ref_type, ref_id, user_id, client_id
  ) values (
    NEW.batch_line_id, 'delivery', -NEW.qty_kg, coalesce(v_delivery.delivered_at, now()),
    'delivery_allocations', NEW.id, v_delivery.created_by, NEW.id
  );

  return NEW;
end;
$$;

-- =============================================================================
-- DROP POLICY BASELINE (dari migration 0001)
-- =============================================================================

drop policy if exists sites_select on sites;
drop policy if exists sites_insert on sites;
drop policy if exists sites_update on sites;

drop policy if exists tanks_select on tanks;
drop policy if exists tanks_insert on tanks;
drop policy if exists tanks_update on tanks;

drop policy if exists suppliers_select on suppliers;
drop policy if exists suppliers_insert on suppliers;
drop policy if exists suppliers_update on suppliers;

drop policy if exists customers_select on customers;
drop policy if exists customers_insert on customers;
drop policy if exists customers_update on customers;

drop policy if exists products_select on products;
drop policy if exists products_insert on products;
drop policy if exists products_update on products;

drop policy if exists product_holding_policy_select on product_holding_policy;
drop policy if exists product_holding_policy_insert on product_holding_policy;
drop policy if exists product_holding_policy_update on product_holding_policy;

drop policy if exists users_select on users;
drop policy if exists users_insert_self on users;
drop policy if exists users_update_self on users;

drop policy if exists receiving_transactions_select on receiving_transactions;
drop policy if exists receiving_transactions_insert on receiving_transactions;

drop policy if exists receiving_lots_select on receiving_lots;
drop policy if exists receiving_lots_insert on receiving_lots;

drop policy if exists batches_select on batches;
drop policy if exists batches_insert on batches;

drop policy if exists batch_lines_select on batch_lines;
drop policy if exists batch_lines_insert on batch_lines;

drop policy if exists quality_inspections_select on quality_inspections;
drop policy if exists quality_inspections_insert on quality_inspections;

drop policy if exists mortality_events_select on mortality_events;
drop policy if exists mortality_events_insert on mortality_events;

drop policy if exists handovers_select on handovers;
drop policy if exists handovers_insert on handovers;

drop policy if exists handover_lines_select on handover_lines;
drop policy if exists handover_lines_insert on handover_lines;

drop policy if exists demands_select on demands;
drop policy if exists demands_insert on demands;
drop policy if exists demands_update on demands;

drop policy if exists deliveries_select on deliveries;
drop policy if exists deliveries_insert on deliveries;
drop policy if exists deliveries_update on deliveries;

drop policy if exists delivery_allocations_select on delivery_allocations;
drop policy if exists delivery_allocations_insert on delivery_allocations;

drop policy if exists settlements_select on settlements;
drop policy if exists settlements_insert on settlements;

drop policy if exists price_today_select on price_today;
drop policy if exists price_today_insert on price_today;

drop policy if exists inventory_ledger_select on inventory_ledger;
drop policy if exists inventory_ledger_insert on inventory_ledger;

drop policy if exists cash_ledger_select on cash_ledger;
drop policy if exists cash_ledger_insert on cash_ledger;

drop policy if exists audit_log_select on audit_log;
drop policy if exists audit_log_insert on audit_log;

-- =============================================================================
-- KATEGORI A — Master, domain owner sepenuhnya
-- (SELECT: owner + lead_lapangan + staf_lapangan; INSERT/UPDATE: owner saja)
-- =============================================================================

create policy sites_select on sites for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy sites_insert on sites for insert to authenticated
  with check (auth_user_role() = 'owner');
create policy sites_update on sites for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy tanks_select on tanks for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy tanks_insert on tanks for insert to authenticated
  with check (auth_user_role() = 'owner');
create policy tanks_update on tanks for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy products_select on products for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy products_insert on products for insert to authenticated
  with check (auth_user_role() = 'owner');
create policy products_update on products for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy product_holding_policy_select on product_holding_policy for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy product_holding_policy_insert on product_holding_policy for insert to authenticated
  with check (auth_user_role() = 'owner');
create policy product_holding_policy_update on product_holding_policy for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

-- =============================================================================
-- KATEGORI B — Master dengan INSERT lapangan (suppliers, customers)
-- (SELECT & INSERT: owner + lead_lapangan + staf_lapangan; UPDATE: owner saja)
-- =============================================================================

create policy suppliers_select on suppliers for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy suppliers_insert on suppliers for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy suppliers_update on suppliers for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy customers_select on customers for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy customers_insert on customers for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy customers_update on customers for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

-- =============================================================================
-- KATEGORI C — Tabel operasional
-- (SELECT & INSERT: owner + lead_lapangan + staf_lapangan; UPDATE: owner saja;
--  tidak ada policy DELETE untuk siapapun)
-- =============================================================================

create policy receiving_transactions_select on receiving_transactions for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy receiving_transactions_insert on receiving_transactions for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy receiving_transactions_update on receiving_transactions for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy receiving_lots_select on receiving_lots for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy receiving_lots_insert on receiving_lots for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy receiving_lots_update on receiving_lots for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

-- batches: lihat CATATAN ASUMSI #1 di atas.
create policy batches_select on batches for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy batches_insert on batches for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy batches_update on batches for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy batch_lines_select on batch_lines for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy batch_lines_insert on batch_lines for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy batch_lines_update on batch_lines for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy quality_inspections_select on quality_inspections for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy quality_inspections_insert on quality_inspections for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy quality_inspections_update on quality_inspections for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy mortality_events_select on mortality_events for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy mortality_events_insert on mortality_events for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy mortality_events_update on mortality_events for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy handovers_select on handovers for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy handovers_insert on handovers for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy handovers_update on handovers for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy handover_lines_select on handover_lines for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy handover_lines_insert on handover_lines for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy handover_lines_update on handover_lines for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy demands_select on demands for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy demands_insert on demands for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
-- UPDATE dibuka row-level untuk lead/staf juga; pembatasan HANYA kolom
-- `status` yang boleh mereka ubah dijaga oleh trigger
-- fn_demands_restrict_field_update di bawah (RLS tidak bisa per-kolom).
create policy demands_update on demands for update to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'))
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));

create policy deliveries_select on deliveries for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy deliveries_insert on deliveries for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
-- UPDATE dibuka row-level untuk lead/staf juga; pembatasan HANYA kolom
-- `actual_weight_kg` dan `delivered_at` yang boleh mereka ubah dijaga oleh
-- trigger fn_deliveries_restrict_field_update di bawah (RLS tidak bisa
-- per-kolom).
create policy deliveries_update on deliveries for update to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'))
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));

create policy delivery_allocations_select on delivery_allocations for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy delivery_allocations_insert on delivery_allocations for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy delivery_allocations_update on delivery_allocations for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

create policy settlements_select on settlements for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy settlements_insert on settlements for insert to authenticated
  with check (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy settlements_update on settlements for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

-- =============================================================================
-- KATEGORI D — Inventory ledger (append-only untuk SEMUA role)
-- SELECT: owner + lead_lapangan + staf_lapangan (perlu lihat stok/aging).
-- INSERT langsung: OWNER SAJA. lead_lapangan/staf_lapangan TIDAK diberi
-- policy INSERT ke inventory_ledger sama sekali — ledger hanya boleh terisi
-- lewat trigger otomatis (fn_mortality_events_ledger, fn_batch_lines_ledger,
-- fn_handover_lines_ledger, fn_delivery_allocations_ledger), yang sekarang
-- SECURITY DEFINER sehingga tetap berjalan meski pemanggilnya bukan owner.
-- TIDAK ADA UPDATE sama sekali untuk siapapun — diperkuat trigger
-- ledger_immutable() sejak 0001.
-- =============================================================================

create policy inventory_ledger_select on inventory_ledger for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy inventory_ledger_insert on inventory_ledger for insert to authenticated
  with check (auth_user_role() = 'owner');

-- =============================================================================
-- KATEGORI E — Kas & audit, owner-only (SELECT & INSERT; TIDAK ADA UPDATE
-- untuk siapapun — diperkuat trigger ledger_immutable() sejak 0001)
-- =============================================================================

create policy cash_ledger_select on cash_ledger for select to authenticated
  using (auth_user_role() = 'owner');
create policy cash_ledger_insert on cash_ledger for insert to authenticated
  with check (auth_user_role() = 'owner');

create policy audit_log_select on audit_log for select to authenticated
  using (auth_user_role() = 'owner');
create policy audit_log_insert on audit_log for insert to authenticated
  with check (auth_user_role() = 'owner');

-- =============================================================================
-- KATEGORI F — Harga acuan harian (lihat CATATAN ASUMSI #4)
-- (SELECT: owner + lead_lapangan + staf_lapangan; INSERT: owner saja)
-- =============================================================================

create policy price_today_select on price_today for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));
create policy price_today_insert on price_today for insert to authenticated
  with check (auth_user_role() = 'owner');

-- =============================================================================
-- USERS — SELECT role-based, dan proteksi kolom `role` lewat trigger
-- (RLS Postgres tidak punya proteksi per-kolom bawaan; kombinasi row-level
-- RLS + trigger column-level ini yang mengimplementasikan aturannya).
-- =============================================================================

create policy users_select on users for select to authenticated
  using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan'));

create policy users_insert_self on users for insert to authenticated
  with check (id = auth.uid());

-- User biasa boleh update baris sendiri (RLS row-level); owner boleh update
-- baris siapapun. Proteksi bahwa kolom `role` cuma boleh diubah oleh owner
-- (baik lewat INSERT pertama kali maupun UPDATE) ada di trigger di bawah,
-- BUKAN di sini — Postgres RLS tidak bisa membatasi per-kolom.
create policy users_update_self on users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy users_update_by_owner on users for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');

-- Lihat CATATAN ASUMSI #6: proteksi ini sengaja diperluas ke INSERT juga,
-- tidak cuma UPDATE, supaya user baru tidak bisa self-insert dengan
-- role='owner'. Konsekuensinya, owner pertama HARUS di-bootstrap lewat akses
-- database langsung (service_role/SQL editor), bukan lewat RLS.
create or replace function fn_users_protect_role()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.role is not null and coalesce(auth_user_role(), '') <> 'owner' then
      raise exception 'Hanya owner yang boleh menetapkan role user baru.';
    end if;
  elsif TG_OP = 'UPDATE' then
    if NEW.role is distinct from OLD.role and coalesce(auth_user_role(), '') <> 'owner' then
      raise exception 'Hanya owner yang boleh mengubah role user.';
    end if;
  end if;
  return NEW;
end;
$$;

create trigger trg_users_protect_role
  before insert or update on users
  for each row execute function fn_users_protect_role();

-- =============================================================================
-- PROTEKSI KOLOM: lead_lapangan/staf_lapangan dapat UPDATE terbatas di
-- demands (hanya status) dan deliveries (hanya actual_weight_kg,
-- delivered_at). RLS row-level di atas (demands_update, deliveries_update)
-- sudah mengizinkan mereka meng-UPDATE baris; trigger di bawah ini yang
-- menahan supaya kolom LAIN tidak ikut berubah kalau pemanggilnya bukan
-- owner. Owner tetap bebas mengubah kolom apa saja.
-- =============================================================================

create or replace function fn_demands_restrict_field_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth_user_role(), '') <> 'owner' then
    if NEW.id is distinct from OLD.id
       or NEW.customer_id is distinct from OLD.customer_id
       or NEW.product_id is distinct from OLD.product_id
       or NEW.requested_qty_kg is distinct from OLD.requested_qty_kg
       or NEW.expected_price_per_kg is distinct from OLD.expected_price_per_kg
       or NEW.needed_by is distinct from OLD.needed_by
       or NEW.created_by is distinct from OLD.created_by
       or NEW.created_at is distinct from OLD.created_at
    then
      raise exception 'lead_lapangan/staf_lapangan hanya boleh mengubah kolom status pada demands.';
    end if;
  end if;
  return NEW;
end;
$$;

create trigger trg_demands_restrict_field_update
  before update on demands
  for each row execute function fn_demands_restrict_field_update();

create or replace function fn_deliveries_restrict_field_update()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth_user_role(), '') <> 'owner' then
    if NEW.id is distinct from OLD.id
       or NEW.demand_id is distinct from OLD.demand_id
       or NEW.site_id is distinct from OLD.site_id
       or NEW.planned_kg is distinct from OLD.planned_kg
       or NEW.created_by is distinct from OLD.created_by
       or NEW.created_at is distinct from OLD.created_at
    then
      raise exception 'lead_lapangan/staf_lapangan hanya boleh mengubah kolom actual_weight_kg dan delivered_at pada deliveries.';
    end if;
  end if;
  return NEW;
end;
$$;

create trigger trg_deliveries_restrict_field_update
  before update on deliveries
  for each row execute function fn_deliveries_restrict_field_update();
