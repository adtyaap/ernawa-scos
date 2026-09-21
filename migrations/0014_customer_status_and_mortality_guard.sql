-- =============================================================================
-- Lobster SC OS (Ernawa) — Customer status + guard saldo mortalitas
-- =============================================================================
-- BAGIAN 1 — customers.status
-- Tidak ada policy DELETE di tabel manapun, jadi customer salah input/uji tidak
-- bisa dihapus. Sama seperti pola suppliers (migration 0005): kolom status
-- sebagai pengganti delete. Default 'active' -> semua baris yang sudah ada
-- otomatis 'aktif', tidak ada baris yang melanggar CHECK. UPDATE tetap
-- owner-only lewat policy customers_update yang sudah ada (tidak ada policy
-- baru). Data customers tidak dihapus/diubah oleh migration ini.
--
-- BAGIAN 2 — guard saldo di mortality_events
-- Trigger ledger mortalitas (fn_mortality_events_ledger, SECURITY DEFINER)
-- tidak mengecek saldo, jadi mortalitas melebihi stok membuat saldo negatif.
-- Ditambah trigger BEFORE INSERT (SECURITY INVOKER, tidak butuh privilege
-- baru): qty harus > 0 dan <= saldo SUM(inventory_ledger) batch_line, dihitung
-- setelah mengambil advisory lock yang SAMA dengan create_delivery_with_
-- allocations (migration 0013), sehingga mortalitas & alokasi konkuren pada
-- batch_line yang sama saling serial. Trigger AFTER INSERT yang sudah ada tidak
-- berubah.
--
-- Migration ini HANYA ADD COLUMN, ADD CONSTRAINT, CREATE FUNCTION, CREATE
-- TRIGGER. Tidak ada DROP/DELETE/TRUNCATE. JANGAN dieksekusi ke database
-- sebelum direview oleh pengguna.
-- =============================================================================

alter table customers
  add column status text not null default 'aktif';

alter table customers
  add constraint customers_status_check check (status in ('aktif', 'nonaktif'));

comment on column customers.status is 'aktif | nonaktif (sama seperti suppliers.status). Pengganti DELETE (tidak ada policy DELETE). Customer nonaktif disembunyikan dari dropdown, riwayat tetap utuh.';

create or replace function fn_mortality_events_balance_guard()
returns trigger
language plpgsql
as $$
declare
  v_available_qty numeric;
begin
  if NEW.qty_kg <= 0 then
    raise exception 'Qty mortalitas harus lebih dari 0.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('batch_line:' || NEW.batch_line_id::text, 0));

  select coalesce(sum(qty_kg), 0)
  into v_available_qty
  from inventory_ledger
  where batch_line_id = NEW.batch_line_id;

  if v_available_qty < NEW.qty_kg then
    raise exception
      'Saldo tidak cukup untuk batch_line %: mortalitas % kg, tersedia % kg.',
      NEW.batch_line_id, NEW.qty_kg, v_available_qty;
  end if;

  return NEW;
end;
$$;

create trigger trg_mortality_events_balance_guard
  before insert on mortality_events
  for each row execute function fn_mortality_events_balance_guard();
