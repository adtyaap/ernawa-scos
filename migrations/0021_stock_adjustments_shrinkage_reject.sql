-- =============================================================================
-- Lobster SC OS (Ernawa) — Penyusutan & Reject (PRD B6)
-- =============================================================================
-- movement_type 'shrinkage' dan 'reject' valid sejak schema awal tapi tidak
-- punya tabel/UI/guard saldo. Dikonfirmasi pengguna: keduanya memang dicatat di
-- lapangan. Polanya SAMA dengan mortality_events (0001/0003/0014):
--   * stock_adjustments = tabel kejadian (satu baris per kejadian, alasan
--     WAJIB diisi — beda dari mortalitas yang penyebabnya opsional).
--   * trigger BEFORE INSERT (INVOKER): qty > 0 dan tidak melebihi saldo, dengan
--     advisory lock 'batch_line:<id>' yang SAMA dengan alokasi/mortalitas/
--     koreksi, jadi konkuren-safe.
--   * trigger AFTER INSERT (SECURITY DEFINER): membuat baris inventory_ledger
--     negatif otomatis (append-only) — role lapangan tidak punya INSERT ledger.
--   * RLS ter-scope per site penugasan (0016/0017): SELECT & INSERT lewat
--     batch_line -> batch -> site. TIDAK ada policy UPDATE/DELETE sama sekali
--     (kejadian hanya dikoreksi lewat reversal ledger).
--
-- create_ledger_reversal (0015) diperluas: baris 'shrinkage' dan 'reject' kini
-- boleh dikoreksi (selain receive & mortality). Baris delivery tetap ditolak
-- di sana (dibatalkan lewat cancel_delivery, 0020).
--
-- Migration ini HANYA CREATE TABLE/FUNCTION/TRIGGER/POLICY dan CREATE OR REPLACE
-- FUNCTION. Tidak ada DROP/DELETE/TRUNCATE. JANGAN dieksekusi sebelum direview.
-- =============================================================================

create table stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  batch_line_id uuid not null references batch_lines (id),
  kind text not null check (kind in ('shrinkage', 'reject')),
  qty_kg numeric(12, 3) not null check (qty_kg > 0),
  reason text not null check (btrim(reason) <> ''),
  event_at timestamptz not null,
  recorded_by uuid references users (id),
  inventory_ledger_id uuid references inventory_ledger (id),
  client_id uuid not null unique,
  created_at timestamptz not null default now()
);
create index idx_stock_adjustments_batch_line on stock_adjustments (batch_line_id);

comment on table stock_adjustments is 'Penyusutan (shrinkage) dan reject stok. Trigger membuat baris ledger negatif otomatis; koreksi lewat reversal ledger, tidak ada UPDATE/DELETE.';

alter table stock_adjustments enable row level security;

create policy stock_adjustments_select on stock_adjustments for select to authenticated
  using (exists (
    select 1 from batch_lines bl join batches b on b.id = bl.batch_id
    where bl.id = stock_adjustments.batch_line_id and user_can_access_site(b.site_id)));

create policy stock_adjustments_insert on stock_adjustments for insert to authenticated
  with check (exists (
    select 1 from batch_lines bl join batches b on b.id = bl.batch_id
    where bl.id = stock_adjustments.batch_line_id and user_can_access_site(b.site_id)));

create or replace function fn_stock_adjustments_balance_guard()
returns trigger
language plpgsql
as $$
declare
  v_available_qty numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('batch_line:' || NEW.batch_line_id::text, 0));

  select coalesce(sum(qty_kg), 0)
  into v_available_qty
  from inventory_ledger
  where batch_line_id = NEW.batch_line_id;

  if v_available_qty < NEW.qty_kg then
    raise exception
      'Saldo tidak cukup untuk batch_line %: % % kg, tersedia % kg.',
      NEW.batch_line_id, NEW.kind, NEW.qty_kg, v_available_qty;
  end if;

  return NEW;
end;
$$;

create trigger trg_stock_adjustments_balance_guard
  before insert on stock_adjustments
  for each row execute function fn_stock_adjustments_balance_guard();

create or replace function fn_stock_adjustments_ledger()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ledger_id uuid;
begin
  insert into inventory_ledger (
    batch_line_id, movement_type, qty_kg, event_at,
    ref_type, ref_id, user_id, client_id
  ) values (
    NEW.batch_line_id, NEW.kind::movement_type, -NEW.qty_kg, NEW.event_at,
    'stock_adjustments', NEW.id, NEW.recorded_by, NEW.id
  )
  returning id into v_ledger_id;

  update stock_adjustments set inventory_ledger_id = v_ledger_id where id = NEW.id;

  return NEW;
end;
$$;

create trigger trg_stock_adjustments_ledger
  after insert on stock_adjustments
  for each row execute function fn_stock_adjustments_ledger();

-- ------------- koreksi ledger: izinkan shrinkage & reject --------------------
create or replace function create_ledger_reversal(
  p_ledger_id uuid,
  p_reason text
)
returns uuid
language plpgsql
as $$
declare
  v_orig inventory_ledger%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_balance numeric;
  v_new_id uuid;
begin
  if v_reason = '' then
    raise exception 'Alasan koreksi wajib diisi.';
  end if;

  select * into v_orig from inventory_ledger where id = p_ledger_id;
  if not found then
    raise exception 'Baris ledger % tidak ditemukan.', p_ledger_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('batch_line:' || v_orig.batch_line_id::text, 0));

  if v_orig.reversal_of is not null then
    raise exception 'Baris ini sendiri adalah reversal dan tidak bisa dikoreksi lagi.';
  end if;

  if v_orig.movement_type not in ('receive', 'mortality', 'shrinkage', 'reject') then
    raise exception 'Baris bertipe % tidak bisa dikoreksi di sini (hanya receive, mortality, shrinkage, reject).', v_orig.movement_type;
  end if;

  if exists (select 1 from inventory_ledger where reversal_of = v_orig.id) then
    raise exception 'Baris ini sudah pernah dikoreksi.';
  end if;

  select coalesce(sum(qty_kg), 0) into v_balance
  from inventory_ledger
  where batch_line_id = v_orig.batch_line_id;

  if v_balance - v_orig.qty_kg < 0 then
    raise exception
      'Koreksi ditolak: saldo batch_line % akan menjadi negatif (saldo % kg, koreksi %).',
      v_orig.batch_line_id, v_balance, -v_orig.qty_kg;
  end if;

  insert into inventory_ledger (
    batch_line_id, movement_type, qty_kg, event_at,
    ref_type, ref_id, reversal_of, user_id, client_id
  ) values (
    v_orig.batch_line_id, 'adjustment', -v_orig.qty_kg, now(),
    'inventory_ledger', v_orig.id, v_orig.id, auth.uid(), gen_random_uuid()
  )
  returning id into v_new_id;

  insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  values (
    'inventory_ledger', v_new_id, 'reversal', to_jsonb(v_orig),
    jsonb_build_object('reason', v_reason, 'reversal_of', v_orig.id, 'qty_kg', -v_orig.qty_kg),
    auth.uid()
  );

  return v_new_id;
end;
$$;
