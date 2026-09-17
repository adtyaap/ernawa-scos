-- =============================================================================
-- Lobster SC OS (Ernawa) — Initial Schema
-- =============================================================================
-- CATATAN PENTING (lihat CLAUDE.md untuk aturan lengkap):
--   1. Dua track bisnis (trading vs budidaya) TIDAK PERNAH digabung. `sites.type`
--      adalah sumber kebenaran track; setiap tabel finansial harus bisa
--      ditelusuri ke sites.type lewat site_id (langsung atau lewat FK chain).
--   2. Inventory adalah ledger append-only: qty tersedia = SUM(inventory_ledger),
--      bukan kolom running-total.
--   3. Ledger (inventory_ledger, cash_ledger, audit_log) TIDAK BOLEH di-UPDATE
--      atau di-DELETE — koreksi wajib berupa baris reversal baru (reversal_of).
--   4. RLS aktif di SEMUA tabel sejak awal.
--
-- Migration ini HANYA membuat schema. JANGAN dieksekusi ke database sebelum
-- direview oleh pengguna.
-- =============================================================================

create extension if not exists pgcrypto;

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

create type site_type as enum ('trading', 'budidaya');
create type settlement_mode as enum ('cod', 'term');
create type movement_type as enum (
  'receive',
  'mortality',
  'shrinkage',
  'delivery',
  'reject',
  'transfer_in',
  'transfer_out',
  'adjustment'
);

-- =============================================================================
-- FUNGSI UTILITY
-- =============================================================================

-- Mencegah UPDATE/DELETE pada tabel ledger append-only.
-- Koreksi hanya boleh lewat baris reversal baru (lihat kolom reversal_of).
create or replace function ledger_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Baris pada tabel % bersifat append-only. UPDATE/DELETE tidak diizinkan; gunakan baris reversal.',
    TG_TABLE_NAME;
  return null;
end;
$$;

-- =============================================================================
-- MASTER
-- =============================================================================

create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type site_type not null,
  monthly_cost numeric(14, 2) not null default 0 check (monthly_cost >= 0),
  created_at timestamptz not null default now()
);
comment on table sites is 'Master lokasi. type membedakan track trading vs budidaya — jangan pernah agregasi lintas type tanpa breakdown.';

create table tanks (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (site_id, name)
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  acceptance_policy jsonb not null default '{}'::jsonb,
  settlement_mode settlement_mode not null,
  created_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Ambang SLA holding berbeda total antara track: trading = refreshment
-- (jam-hari), budidaya = grow-out (bulan). Satu produk bisa punya kebijakan
-- berbeda per track, karenanya dipisah dari products, bukan kolom tunggal.
create table product_holding_policy (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  track site_type not null,
  max_holding_hours integer not null check (max_holding_hours > 0),
  created_at timestamptz not null default now(),
  unique (product_id, track)
);

-- Profil user aplikasi, 1:1 dengan auth.users (auth.uid()).
create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role text, -- teks bebas untuk sekarang, belum dipakai untuk RLS (lihat TODO di bagian RLS)
  created_at timestamptz not null default now()
);

-- =============================================================================
-- PENERIMAAN
-- =============================================================================

create table receiving_transactions (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers (id),
  site_id uuid not null references sites (id),
  transaction_date date not null,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index idx_receiving_transactions_site on receiving_transactions (site_id);
create index idx_receiving_transactions_date on receiving_transactions (transaction_date);

create table receiving_lots (
  id uuid primary key default gen_random_uuid(),
  receiving_transaction_id uuid not null references receiving_transactions (id),
  product_id uuid not null references products (id),
  qty_kg numeric(12, 3) not null check (qty_kg > 0),
  buy_price_per_kg numeric(14, 2) not null check (buy_price_per_kg > 0),
  created_at timestamptz not null default now()
);
create index idx_receiving_lots_transaction on receiving_lots (receiving_transaction_id);

-- Batch dibentuk otomatis oleh sistem lewat get_or_create_batch(), bukan input
-- manual. Identitas batch = kombinasi (site_id, tank_id, business_date).
create table batches (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  tank_id uuid not null references tanks (id),
  business_date date not null,
  created_at timestamptz not null default now(),
  unique (site_id, tank_id, business_date)
);
comment on table batches is 'JANGAN insert manual — gunakan fungsi get_or_create_batch(site_id, tank_id, business_date).';
create index idx_batches_site on batches (site_id);

create or replace function get_or_create_batch(
  p_site_id uuid,
  p_tank_id uuid,
  p_business_date date
) returns uuid
language plpgsql
as $$
declare
  v_batch_id uuid;
begin
  insert into batches (site_id, tank_id, business_date)
  values (p_site_id, p_tank_id, p_business_date)
  on conflict (site_id, tank_id, business_date) do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select id into v_batch_id
    from batches
    where site_id = p_site_id
      and tank_id = p_tank_id
      and business_date = p_business_date;
  end if;

  return v_batch_id;
end;
$$;

create table batch_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches (id),
  receiving_lot_id uuid not null references receiving_lots (id),
  created_at timestamptz not null default now()
);
comment on table batch_lines is 'Asumsi: satu receiving_lot masuk utuh ke satu batch_line (tidak dipecah ke beberapa tank/batch). Baris inventory_ledger pasangan (movement_type = receive) dibuat OTOMATIS oleh trigger trg_batch_lines_ledger (lihat bagian INVENTORY LEDGER).';
create index idx_batch_lines_batch on batch_lines (batch_id);
create index idx_batch_lines_lot on batch_lines (receiving_lot_id);

-- =============================================================================
-- INVENTORY LEDGER (append-only, WAJIB)
-- =============================================================================

create table inventory_ledger (
  id uuid primary key default gen_random_uuid(),
  batch_line_id uuid not null references batch_lines (id),
  movement_type movement_type not null,
  qty_kg numeric(12, 3) not null check (qty_kg <> 0),
  event_at timestamptz not null,
  created_at timestamptz not null default now(),
  ref_type text,
  ref_id uuid,
  reversal_of uuid references inventory_ledger (id),
  user_id uuid references users (id),
  client_id uuid not null unique
);
comment on table inventory_ledger is 'Append-only. Stok tersedia = SUM(qty_kg) per batch_line, dihitung saat query. Koreksi = baris baru dengan reversal_of terisi.';
create index idx_inventory_ledger_batch_line on inventory_ledger (batch_line_id);
create index idx_inventory_ledger_event_at on inventory_ledger (event_at);
create index idx_inventory_ledger_ref on inventory_ledger (ref_type, ref_id);

create trigger trg_inventory_ledger_immutable
  before update or delete on inventory_ledger
  for each row execute function ledger_immutable();

-- Trigger: setiap INSERT ke batch_lines otomatis membuat baris pasangan di
-- inventory_ledger (movement_type='receive'). qty_kg diambil dari
-- receiving_lots terkait; event_at memakai transaction_date dari
-- receiving_transactions induk (bukan created_at saat ini), supaya aging
-- stok dihitung dari tanggal terima sungguhan, bukan tanggal input sistem.
create or replace function fn_batch_lines_ledger()
returns trigger
language plpgsql
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

create trigger trg_batch_lines_ledger
  after insert on batch_lines
  for each row execute function fn_batch_lines_ledger();

-- View bantu: saldo stok per batch_line, dihitung dari ledger (bukan running-total).
create view v_batch_line_balance as
select
  batch_line_id,
  sum(qty_kg) as balance_kg
from inventory_ledger
group by batch_line_id;

-- View bantu: ledger inventory dengan track (trading/budidaya) yang bisa
-- ditelusuri dari sites.type, untuk memastikan laporan tidak pernah blended.
create view v_inventory_ledger_with_track as
select
  il.*,
  b.site_id,
  s.type as track
from inventory_ledger il
join batch_lines bl on bl.id = il.batch_line_id
join batches b on b.id = bl.batch_id
join sites s on s.id = b.site_id;

-- =============================================================================
-- KUALITAS & SERAH TERIMA
-- =============================================================================

create table quality_inspections (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches (id),
  inspected_at timestamptz not null,
  inspector_id uuid references users (id),
  grade text,
  notes text,
  created_at timestamptz not null default now(),
  client_id uuid not null unique
);
create index idx_quality_inspections_batch on quality_inspections (batch_id);

create table mortality_events (
  id uuid primary key default gen_random_uuid(),
  batch_line_id uuid not null references batch_lines (id),
  event_at timestamptz not null,
  qty_kg numeric(12, 3) not null check (qty_kg > 0),
  cause text,
  recorded_by uuid references users (id),
  inventory_ledger_id uuid references inventory_ledger (id),
  created_at timestamptz not null default now(),
  client_id uuid not null unique
);
comment on table mortality_events is 'Baris inventory_ledger pasangan (movement_type = mortality, qty_kg negatif) dibuat OTOMATIS oleh trigger trg_mortality_events_ledger — jangan insert manual ke inventory_ledger untuk event ini.';
create index idx_mortality_events_batch_line on mortality_events (batch_line_id);

-- Trigger: setiap INSERT ke mortality_events otomatis membuat baris
-- pasangan di inventory_ledger (movement_type='mortality', qty_kg negatif)
-- dan mengisi kembali mortality_events.inventory_ledger_id. Menghindari
-- ketergantungan pada aplikasi untuk insert dua kali secara manual.
create or replace function fn_mortality_events_ledger()
returns trigger
language plpgsql
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

create trigger trg_mortality_events_ledger
  after insert on mortality_events
  for each row execute function fn_mortality_events_ledger();

create table handovers (
  id uuid primary key default gen_random_uuid(),
  from_site_id uuid not null references sites (id),
  to_site_id uuid not null references sites (id),
  handed_over_at timestamptz not null,
  handed_by uuid references users (id),
  received_by uuid references users (id),
  notes text,
  created_at timestamptz not null default now(),
  client_id uuid not null unique
);
create index idx_handovers_from_site on handovers (from_site_id);
create index idx_handovers_to_site on handovers (to_site_id);

create table handover_lines (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references handovers (id),
  batch_line_id uuid not null references batch_lines (id),
  qty_kg numeric(12, 3) not null check (qty_kg > 0),
  created_at timestamptz not null default now()
);
comment on table handover_lines is 'Dua baris inventory_ledger pasangan (transfer_out & transfer_in) dibuat OTOMATIS oleh trigger trg_handover_lines_ledger, memakai batch_line_id yang sama untuk kedua sisi.';
create index idx_handover_lines_handover on handover_lines (handover_id);
create index idx_handover_lines_batch_line on handover_lines (batch_line_id);

-- Trigger: setiap INSERT ke handover_lines otomatis membuat DUA baris di
-- inventory_ledger — transfer_out (qty_kg negatif, user_id = handed_by) dan
-- transfer_in (qty_kg positif, user_id = received_by) — dengan qty_kg dan
-- batch_line_id yang sama, event_at = handed_over_at dari handovers induk.
-- client_id transfer_in diturunkan deterministik dari id baris ini supaya
-- tetap unik tanpa perlu kolom client_id terpisah di handover_lines.
--
-- TODO — LIMITATION: handover lintas track (mis. budidaya→trading) TIDAK
-- membuat batch_line baru di site tujuan — batch_line_id tetap merujuk ke
-- site/track asal, sehingga laporan per-track di site tujuan tidak akan
-- menghitung stok ini sampai ada batch_line baru dibuat manual. WAJIB
-- diperbaiki (bikin batch_line baru di destination via get_or_create_batch)
-- sebelum budidaya mulai beroperasi dan transfer fisik lintas track jadi
-- mungkin terjadi.
create or replace function fn_handover_lines_ledger()
returns trigger
language plpgsql
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

create trigger trg_handover_lines_ledger
  after insert on handover_lines
  for each row execute function fn_handover_lines_ledger();

-- =============================================================================
-- PENJUALAN
-- =============================================================================

create table demands (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id),
  product_id uuid not null references products (id),
  requested_qty_kg numeric(12, 3) not null check (requested_qty_kg > 0),
  expected_price_per_kg numeric(14, 2) check (expected_price_per_kg is null or expected_price_per_kg > 0),
  needed_by timestamptz,
  status text not null default 'open',
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
create index idx_demands_customer on demands (customer_id);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  demand_id uuid references demands (id),
  site_id uuid not null references sites (id),
  planned_kg numeric(12, 3) not null check (planned_kg > 0),
  actual_weight_kg numeric(12, 3) check (actual_weight_kg is null or actual_weight_kg >= 0),
  delivered_at timestamptz,
  created_by uuid references users (id),
  created_at timestamptz not null default now()
);
comment on table deliveries is 'site_id wajib diisi agar track (trading/budidaya) selalu bisa ditelusuri lewat sites.type.';
create index idx_deliveries_site on deliveries (site_id);
create index idx_deliveries_demand on deliveries (demand_id);

create table delivery_allocations (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries (id),
  batch_line_id uuid not null references batch_lines (id),
  qty_kg numeric(12, 3) not null check (qty_kg > 0),
  fefo_rank integer not null check (fefo_rank > 0),
  override_reason text,
  created_at timestamptz not null default now()
);
comment on table delivery_allocations is 'override_reason wajib diisi jika alokasi tidak mengikuti urutan FEFO (fefo_rank) yang seharusnya. Baris inventory_ledger pasangan (movement_type = delivery, qty_kg negatif) dibuat OTOMATIS oleh trigger trg_delivery_allocations_ledger.';
create index idx_delivery_allocations_delivery on delivery_allocations (delivery_id);
create index idx_delivery_allocations_batch_line on delivery_allocations (batch_line_id);

-- Trigger: setiap INSERT ke delivery_allocations otomatis membuat baris
-- pasangan di inventory_ledger (movement_type='delivery', qty_kg negatif).
-- event_at & user_id diambil dari deliveries induknya; client_id memakai id
-- baris ini sendiri (sudah unik lewat primary key, tidak perlu client_id
-- terpisah di delivery_allocations).
create or replace function fn_delivery_allocations_ledger()
returns trigger
language plpgsql
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

create trigger trg_delivery_allocations_ledger
  after insert on delivery_allocations
  for each row execute function fn_delivery_allocations_ledger();

create table settlements (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries (id),
  customer_id uuid not null references customers (id),
  mode settlement_mode not null,
  amount numeric(14, 2) not null check (amount > 0),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_settlements_delivery on settlements (delivery_id);
create index idx_settlements_customer on settlements (customer_id);

-- =============================================================================
-- KAS & AUDIT
-- =============================================================================

create table cash_ledger (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites (id),
  amount numeric(14, 2) not null check (amount <> 0),
  category text not null,
  ref_type text,
  ref_id uuid,
  event_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references users (id),
  reversal_of uuid references cash_ledger (id)
);
comment on table cash_ledger is 'Append-only. site_id wajib diisi agar track selalu bisa ditelusuri. Koreksi = baris baru dengan reversal_of terisi.';
create index idx_cash_ledger_site on cash_ledger (site_id);
create index idx_cash_ledger_event_at on cash_ledger (event_at);
create index idx_cash_ledger_ref on cash_ledger (ref_type, ref_id);

create trigger trg_cash_ledger_immutable
  before update or delete on cash_ledger
  for each row execute function ledger_immutable();

-- View bantu: cash ledger dengan track (trading/budidaya) eksplisit, agar
-- laporan kas tidak pernah menampilkan angka blended tanpa breakdown per track.
create view v_cash_ledger_with_track as
select
  cl.*,
  s.type as track
from cash_ledger cl
join sites s on s.id = cl.site_id;

create table price_today (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id),
  site_id uuid not null references sites (id),
  price numeric(14, 2) not null check (price > 0),
  effective_date date not null,
  created_at timestamptz not null default now(),
  unique (product_id, site_id, effective_date)
);
create index idx_price_today_site on price_today (site_id);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid not null,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid references users (id),
  changed_at timestamptz not null default now()
);
comment on table audit_log is 'Append-only. Tidak boleh di-UPDATE/DELETE.';
create index idx_audit_log_table_row on audit_log (table_name, row_id);

create trigger trg_audit_log_immutable
  before update or delete on audit_log
  for each row execute function ledger_immutable();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- Baseline untuk single-tenant internal tool (staff Ernawa): semua user
-- `authenticated` bisa SELECT semua data operasional, dan INSERT pada tabel
-- transaksional. Tidak ada policy UPDATE/DELETE pada tabel ledger append-only
-- (inventory_ledger, cash_ledger, audit_log) — diperkuat juga oleh trigger di
-- atas.
--
-- TODO (WAJIB sebelum ada staf tambahan di luar tim awal): baseline "semua
-- authenticated = akses penuh baca + insert" ini HANYA sementara untuk tim
-- awal yang masih kecil dan saling percaya. Sebelum onboarding staf baru di
-- luar tim awal, policy di bawah WAJIB diganti jadi role-based menggunakan
-- kolom users.role (mis. batasi INSERT/SELECT sesuai role: admin, staf
-- lapangan trading, staf lapangan budidaya, viewer, dll). Jangan tambah staf
-- baru dengan policy seperti ini masih berlaku.

alter table sites enable row level security;
alter table tanks enable row level security;
alter table suppliers enable row level security;
alter table customers enable row level security;
alter table products enable row level security;
alter table product_holding_policy enable row level security;
alter table users enable row level security;
alter table receiving_transactions enable row level security;
alter table receiving_lots enable row level security;
alter table batches enable row level security;
alter table batch_lines enable row level security;
alter table inventory_ledger enable row level security;
alter table quality_inspections enable row level security;
alter table mortality_events enable row level security;
alter table handovers enable row level security;
alter table handover_lines enable row level security;
alter table demands enable row level security;
alter table deliveries enable row level security;
alter table delivery_allocations enable row level security;
alter table settlements enable row level security;
alter table cash_ledger enable row level security;
alter table price_today enable row level security;
alter table audit_log enable row level security;

-- Master data: baca semua, tulis/ubah oleh staff yang login.
create policy sites_select on sites for select to authenticated using (true);
create policy sites_insert on sites for insert to authenticated with check (true);
create policy sites_update on sites for update to authenticated using (true) with check (true);

create policy tanks_select on tanks for select to authenticated using (true);
create policy tanks_insert on tanks for insert to authenticated with check (true);
create policy tanks_update on tanks for update to authenticated using (true) with check (true);

create policy suppliers_select on suppliers for select to authenticated using (true);
create policy suppliers_insert on suppliers for insert to authenticated with check (true);
create policy suppliers_update on suppliers for update to authenticated using (true) with check (true);

create policy customers_select on customers for select to authenticated using (true);
create policy customers_insert on customers for insert to authenticated with check (true);
create policy customers_update on customers for update to authenticated using (true) with check (true);

create policy products_select on products for select to authenticated using (true);
create policy products_insert on products for insert to authenticated with check (true);
create policy products_update on products for update to authenticated using (true) with check (true);

create policy product_holding_policy_select on product_holding_policy for select to authenticated using (true);
create policy product_holding_policy_insert on product_holding_policy for insert to authenticated with check (true);
create policy product_holding_policy_update on product_holding_policy for update to authenticated using (true) with check (true);

-- users: direktori staff bisa dibaca semua, tapi hanya boleh mengubah baris sendiri.
create policy users_select on users for select to authenticated using (true);
create policy users_insert_self on users for insert to authenticated with check (id = auth.uid());
create policy users_update_self on users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Tabel transaksional operasional: baca semua, insert oleh staff yang login.
-- Tidak ada policy DELETE (riwayat transaksi tidak boleh dihapus).
create policy receiving_transactions_select on receiving_transactions for select to authenticated using (true);
create policy receiving_transactions_insert on receiving_transactions for insert to authenticated with check (true);

create policy receiving_lots_select on receiving_lots for select to authenticated using (true);
create policy receiving_lots_insert on receiving_lots for insert to authenticated with check (true);

create policy batches_select on batches for select to authenticated using (true);
create policy batches_insert on batches for insert to authenticated with check (true);

create policy batch_lines_select on batch_lines for select to authenticated using (true);
create policy batch_lines_insert on batch_lines for insert to authenticated with check (true);

create policy quality_inspections_select on quality_inspections for select to authenticated using (true);
create policy quality_inspections_insert on quality_inspections for insert to authenticated with check (true);

create policy mortality_events_select on mortality_events for select to authenticated using (true);
create policy mortality_events_insert on mortality_events for insert to authenticated with check (true);

create policy handovers_select on handovers for select to authenticated using (true);
create policy handovers_insert on handovers for insert to authenticated with check (true);

create policy handover_lines_select on handover_lines for select to authenticated using (true);
create policy handover_lines_insert on handover_lines for insert to authenticated with check (true);

create policy demands_select on demands for select to authenticated using (true);
create policy demands_insert on demands for insert to authenticated with check (true);
create policy demands_update on demands for update to authenticated using (true) with check (true);

create policy deliveries_select on deliveries for select to authenticated using (true);
create policy deliveries_insert on deliveries for insert to authenticated with check (true);
create policy deliveries_update on deliveries for update to authenticated using (true) with check (true);

create policy delivery_allocations_select on delivery_allocations for select to authenticated using (true);
create policy delivery_allocations_insert on delivery_allocations for insert to authenticated with check (true);

create policy settlements_select on settlements for select to authenticated using (true);
create policy settlements_insert on settlements for insert to authenticated with check (true);

create policy price_today_select on price_today for select to authenticated using (true);
create policy price_today_insert on price_today for insert to authenticated with check (true);

-- Tabel ledger append-only: hanya SELECT dan INSERT. UPDATE/DELETE tidak
-- diberi policy sama sekali (default-deny RLS), diperkuat trigger di atas.
create policy inventory_ledger_select on inventory_ledger for select to authenticated using (true);
create policy inventory_ledger_insert on inventory_ledger for insert to authenticated with check (true);

create policy cash_ledger_select on cash_ledger for select to authenticated using (true);
create policy cash_ledger_insert on cash_ledger for insert to authenticated with check (true);

create policy audit_log_select on audit_log for select to authenticated using (true);
create policy audit_log_insert on audit_log for insert to authenticated with check (true);
