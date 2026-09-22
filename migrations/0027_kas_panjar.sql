-- =============================================================================
-- Lobster SC OS (Ernawa) — Kas Panjar per PIC (PRD gap: FR-CASH-001/002)
-- =============================================================================
-- cash_ledger SUDAH ADA sejak migration 0001 (site_id, amount, category,
-- ref_type, ref_id, event_at, created_by, reversal_of) tapi RLS-nya owner-only
-- total (SELECT & INSERT) dan tidak punya konsep "milik siapa" terpisah dari
-- "siapa yang mencatat" — 0 baris data, belum pernah dipakai.
--
-- KEPUTUSAN (dari pengguna): fungsi "Finance" dipetakan ke role owner yang
-- sudah ada (bukan role baru) — konsisten dengan Piutang/Koreksi Ledger/Audit
-- Log/Manajemen User yang semuanya sudah owner-only. Saldo dihitung PER (PIC,
-- site) — bukan satu angka per orang — supaya kas juga tidak tercampur lintas
-- track kalau satu PIC ditugaskan ke lebih dari satu site (CLAUDE.md #1).
--
-- PERUBAHAN:
--   1. cash_ledger.pic_user_id (NOT NULL, FK users) — milik siapa saldo ini.
--      created_by dipertegas NOT NULL (siapa yang mencatat — bisa beda dari
--      pic_user_id saat owner top-up/koreksi atas nama PIC lain). Kedua kolom
--      WAJIB NOT NULL langsung (tabel masih 0 baris, tidak ada migrasi data).
--   2. category dibatasi CHECK ke 4 nilai: 'topup' (owner mengisi saldo PIC),
--      'expense' (PIC keluar biaya operasional), 'return' (PIC kembalikan
--      sisa kas), 'adjustment' (koreksi manual owner, jarang dipakai langsung
--      — reversal adalah jalur koreksi utama).
--   3. RLS diganti total:
--      - SELECT: owner lihat semua; PIC lihat baris miliknya sendiri.
--      - INSERT: owner boleh apa saja (topup/expense/return/adjustment/
--        reversal, atas nama siapa pun). lead_lapangan/staf_lapangan HANYA
--        boleh insert untuk DIRINYA SENDIRI (pic_user_id = created_by =
--        auth.uid()), HANYA kategori 'expense'/'return' (topup/adjustment
--        tetap owner-only), dan TIDAK BOLEH mengisi reversal_of (self-
--        koreksi tidak diizinkan, sama seperti inventory_ledger — koreksi
--        lewat create_cash_reversal, owner-only).
--   4. Guard saldo (BEFORE INSERT, INVOKER, advisory lock 'cash:<pic>:<site>'
--      — namespace lock baru, tidak bentrok dengan 'batch_line:'/'demand:'
--      yang sudah ada): tolak insert yang membuat SUM(amount) per (pic_user_id,
--      site_id) jadi negatif. Berlaku untuk SEMUA insert termasuk punya owner,
--      supaya tidak ada jalur yang bisa bikin saldo minus.
--   5. create_cash_reversal(p_ledger_id, p_reason) — pola identik dengan
--      create_ledger_reversal (0015): owner-only (lewat RLS insert di atas +
--      pengecekan eksplisit karena reversal harus SELALU owner terlepas
--      kategori aslinya), alasan wajib, tidak bisa reversal ganda/reversal-
--      dari-reversal, dicatat ke audit_log.
--   6. v_cash_balance (security_invoker): saldo per (pic_user_id, site_id),
--      dengan nama PIC dan track site — dipakai halaman Kas Panjar supaya
--      owner tidak perlu agregasi manual di client.
--
-- Migration ini berisi ALTER TABLE ADD COLUMN + ALTER COLUMN SET NOT NULL
-- pada tabel yang masih 0 baris (tidak ada risiko data), CREATE POLICY/
-- FUNCTION/TRIGGER/VIEW. Tidak ada DROP/DELETE/TRUNCATE. JANGAN dieksekusi
-- sebelum direview.
-- =============================================================================

alter table cash_ledger add column pic_user_id uuid references users (id);
update cash_ledger set pic_user_id = created_by where pic_user_id is null; -- no-op, tabel kosong
alter table cash_ledger alter column pic_user_id set not null;
alter table cash_ledger alter column created_by set not null;

alter table cash_ledger add constraint cash_ledger_category_check
  check (category in ('topup', 'expense', 'return', 'adjustment'));

comment on column cash_ledger.pic_user_id is 'Milik siapa saldo kas ini (PIC lapangan). Beda dari created_by saat owner top-up/koreksi atas nama PIC lain.';
comment on column cash_ledger.category is 'topup (owner mengisi saldo PIC) | expense (PIC keluar biaya) | return (PIC kembalikan sisa) | adjustment (koreksi manual owner).';

drop policy if exists cash_ledger_select on cash_ledger;
drop policy if exists cash_ledger_insert on cash_ledger;

create policy cash_ledger_select on cash_ledger for select to authenticated
  using (auth_user_role() = 'owner' or pic_user_id = auth.uid());

create policy cash_ledger_insert on cash_ledger for insert to authenticated
  with check (
    auth_user_role() = 'owner'
    or (
      auth_user_role() in ('lead_lapangan', 'staf_lapangan')
      and pic_user_id = auth.uid()
      and created_by = auth.uid()
      and reversal_of is null
      and category in ('expense', 'return')
    )
  );

create or replace function fn_cash_ledger_balance_guard()
returns trigger
language plpgsql
as $$
declare
  v_balance numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('cash:' || NEW.pic_user_id::text || ':' || NEW.site_id::text, 0));

  select coalesce(sum(amount), 0)
  into v_balance
  from cash_ledger
  where pic_user_id = NEW.pic_user_id and site_id = NEW.site_id;

  if v_balance + NEW.amount < 0 then
    raise exception
      'Saldo kas tidak cukup untuk PIC % di site %: saldo % , transaksi %.',
      NEW.pic_user_id, NEW.site_id, v_balance, NEW.amount;
  end if;

  return NEW;
end;
$$;

create trigger trg_cash_ledger_balance_guard
  before insert on cash_ledger
  for each row execute function fn_cash_ledger_balance_guard();

create or replace function create_cash_reversal(p_ledger_id uuid, p_reason text)
returns uuid
language plpgsql
as $$
declare
  v_orig cash_ledger%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_new_id uuid;
begin
  if coalesce(auth_user_role(), '') <> 'owner' then
    raise exception 'Hanya Owner yang boleh mengoreksi kas.';
  end if;
  if v_reason = '' then
    raise exception 'Alasan koreksi wajib diisi.';
  end if;

  select * into v_orig from cash_ledger where id = p_ledger_id;
  if not found then
    raise exception 'Baris kas % tidak ditemukan.', p_ledger_id;
  end if;
  if v_orig.reversal_of is not null then
    raise exception 'Baris ini sendiri adalah reversal dan tidak bisa dikoreksi lagi.';
  end if;
  if exists (select 1 from cash_ledger where reversal_of = v_orig.id) then
    raise exception 'Baris ini sudah pernah dikoreksi.';
  end if;

  insert into cash_ledger (site_id, amount, category, ref_type, ref_id, event_at, created_by, pic_user_id, reversal_of)
  values (v_orig.site_id, -v_orig.amount, 'adjustment', 'cash_ledger', v_orig.id, now(), auth.uid(), v_orig.pic_user_id, v_orig.id)
  returning id into v_new_id;

  insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  values (
    'cash_ledger', v_new_id, 'reversal', to_jsonb(v_orig),
    jsonb_build_object('reason', v_reason, 'reversal_of', v_orig.id, 'amount', -v_orig.amount),
    auth.uid()
  );

  return v_new_id;
end;
$$;

create or replace view v_cash_balance
with (security_invoker = true) as
select
  cl.pic_user_id,
  u.full_name as pic_name,
  cl.site_id,
  s.name as site_name,
  s.type as track,
  sum(cl.amount) as balance
from cash_ledger cl
join users u on u.id = cl.pic_user_id
join sites s on s.id = cl.site_id
group by cl.pic_user_id, u.full_name, cl.site_id, s.name, s.type;

revoke all on v_cash_balance from public, anon;
grant select on v_cash_balance to authenticated;
