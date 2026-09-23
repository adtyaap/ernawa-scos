-- Ledger Kas/Bank Perusahaan (gap Finance #2 dari PRD v1 lama, Bagian 7.5:
-- "saldo kas/bank riil, Working Capital saat ini menghitung AR/AP/Inventory,
-- bukan ledger kas aktual"). Dikonfirmasi user lewat pertanyaan eksplisit
-- sebelum dibangun:
--   1. Sumber data: AUTO-LINK dari alur yang sudah ada (topup Kas Panjar ->
--      kas keluar; settlement lunas -> kas masuk) + entri manual Owner utk
--      sisanya (bayar supplier, opex, dll) -- BUKAN murni manual semua.
--   2. Satu saldo gabungan (bukan multi-rekening/akun bank terpisah).
--   3. Akses baca: Owner + Investor (read-only), konsisten dengan akses
--      Finance lintas track yang investor sudah punya (migration 0022).
--
-- BEDA dari Kas Panjar (cash_ledger, migration 0027): Kas Panjar itu kas
-- FISIK di tangan PIC lapangan per site (scoped pic_user_id+site_id, guard
-- saldo tidak boleh negatif krn itu uang tunai riil). Ledger ini itu buku
-- kas/bank level PERUSAHAAN (scope global per track, BUKAN per PIC) -- tidak
-- ada guard saldo non-negatif di sini SENGAJA: data historis (opex/transfer
-- masa lalu yang belum diinput) akan membuat saldo awal "kelihatan minus"
-- sampai entri manual pelengkap diinput Owner; guard ketat di titik ini akan
-- memblokir pengisian data historis yang legitimate.
--
-- Rule #1 CLAUDE.md: kolom `track` eksplisit wajib, tidak ada angka blended
-- trading/budidaya -- breakdown per track dihitung di level query, bukan di
-- tabel (sama pola dengan finance_targets, migration 0036).
--
-- Rule #2/#3 CLAUDE.md: append-only, tidak ada policy UPDATE/DELETE sama
-- sekali. Koreksi lewat create_company_cash_reversal() (pola identik
-- create_cash_reversal Kas Panjar, migration 0027/0034).

create table company_cash_ledger (
  id uuid primary key default gen_random_uuid(),
  track text not null check (track in ('trading', 'budidaya')),
  amount numeric not null check (amount <> 0),
  category text not null check (category in (
    'settlement_in', 'kas_panjar_topup_out', 'supplier_payment',
    'opex', 'other_in', 'other_out', 'adjustment'
  )),
  description text,
  ref_type text,
  ref_id uuid,
  event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid not null references users(id),
  reversal_of uuid references company_cash_ledger(id)
);

comment on table company_cash_ledger is 'Ledger kas/bank level perusahaan (saldo gabungan, bukan per rekening). settlement_in & kas_panjar_topup_out auto-linked lewat trigger dari settlements/cash_ledger -- jangan insert manual dgn kategori itu (RLS tidak melarang krn Owner dipercaya penuh, tapi UI sengaja tidak menawarkan pilihan itu utk cegah dobel-hitung).';
comment on column company_cash_ledger.amount is 'Signed: positif = kas masuk, negatif = kas keluar. Konsisten dgn konvensi cash_ledger.amount.';

create index idx_company_cash_ledger_created_by on company_cash_ledger (created_by);
create index idx_company_cash_ledger_reversal_of on company_cash_ledger (reversal_of);
create index idx_company_cash_ledger_ref on company_cash_ledger (ref_type, ref_id);

alter table company_cash_ledger enable row level security;

create policy company_cash_ledger_select on company_cash_ledger
  for select to authenticated
  using ((select auth_user_role()) = 'owner');

create policy company_cash_ledger_insert on company_cash_ledger
  for insert to authenticated
  with check ((select auth_user_role()) = 'owner');

-- Koreksi (pola identik create_cash_reversal Kas Panjar). SECURITY INVOKER:
-- owner sudah punya hak insert kategori apa pun lewat RLS di atas.
create or replace function create_company_cash_reversal(p_id uuid, p_reason text)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_orig company_cash_ledger%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_new_id uuid;
begin
  if coalesce(auth_user_role(), '') <> 'owner' then
    raise exception 'Hanya Owner yang boleh mengoreksi kas perusahaan.';
  end if;
  if v_reason = '' then
    raise exception 'Alasan koreksi wajib diisi.';
  end if;

  select * into v_orig from company_cash_ledger where id = p_id;
  if not found then
    raise exception 'Baris kas perusahaan % tidak ditemukan.', p_id;
  end if;
  if v_orig.reversal_of is not null then
    raise exception 'Baris ini sendiri adalah reversal dan tidak bisa dikoreksi lagi.';
  end if;
  if exists (select 1 from company_cash_ledger where reversal_of = v_orig.id) then
    raise exception 'Baris ini sudah pernah dikoreksi.';
  end if;

  insert into company_cash_ledger (track, amount, category, description, ref_type, ref_id, event_at, created_by, reversal_of)
  values (v_orig.track, -v_orig.amount, 'adjustment', v_reason, 'company_cash_ledger', v_orig.id, now(), auth.uid(), v_orig.id)
  returning id into v_new_id;

  insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  values (
    'company_cash_ledger', v_new_id, 'reversal', to_jsonb(v_orig),
    jsonb_build_object('reason', v_reason, 'reversal_of', v_orig.id, 'amount', -v_orig.amount),
    auth.uid()
  );

  return v_new_id;
end;
$$;

revoke all on function create_company_cash_reversal(uuid, text) from public, anon;
grant execute on function create_company_cash_reversal(uuid, text) to authenticated;

-- ============================================================
-- Auto-link #1: topup Kas Panjar -> kas keluar dari treasury.
-- Reversal dari topup (create_cash_reversal, category='adjustment',
-- reversal_of -> topup asli) -> kas MASUK kembali ke treasury (formula
-- amount = -NEW.amount berlaku utk kedua arah krn cash_ledger.amount topup
-- positif & reversalnya negatif, lihat komentar di bawah).
-- SECURITY DEFINER: company_cash_ledger INSERT policy owner-only, tapi
-- trigger ini harus tetap jalan kalau caller bukan owner (utk kasus lain di
-- masa depan) -- konsisten pola SEMUA trigger penulis ledger di proyek ini.
-- ============================================================
create or replace function fn_cash_ledger_to_treasury()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_track text;
  v_orig_category text;
  v_orig_treasury_id uuid;
begin
  if NEW.category = 'topup' then
    select type into v_track from sites where id = NEW.site_id;
    insert into company_cash_ledger (track, amount, category, ref_type, ref_id, event_at, created_by)
    values (v_track, -NEW.amount, 'kas_panjar_topup_out', 'cash_ledger', NEW.id, NEW.event_at, NEW.created_by);

  elsif NEW.category = 'adjustment' and NEW.reversal_of is not null then
    select category into v_orig_category from cash_ledger where id = NEW.reversal_of;
    if v_orig_category = 'topup' then
      select type into v_track from sites where id = NEW.site_id;
      -- Cari baris treasury yang dibuat utk topup ASLI (bukan utk baris
      -- reversal cash_ledger ini sendiri -- NEW.reversal_of menunjuk ke topup
      -- asli), supaya reversal_of di treasury ikut membentuk rantai koreksi
      -- yang bisa ditelusuri, konsisten dgn pola reversal di seluruh proyek.
      select id into v_orig_treasury_id
      from company_cash_ledger
      where ref_type = 'cash_ledger' and ref_id = NEW.reversal_of and reversal_of is null;

      insert into company_cash_ledger (track, amount, category, ref_type, ref_id, event_at, created_by, reversal_of)
      values (v_track, -NEW.amount, 'kas_panjar_topup_out', 'cash_ledger', NEW.id, NEW.event_at, NEW.created_by, v_orig_treasury_id);
    end if;
  end if;

  return NEW;
end;
$$;

create trigger trg_cash_ledger_to_treasury
  after insert on cash_ledger
  for each row execute function fn_cash_ledger_to_treasury();

revoke all on function fn_cash_ledger_to_treasury() from public, anon, authenticated;

-- ============================================================
-- Auto-link #2: settlement lunas -> kas masuk ke treasury. Dua jalur:
-- (a) INSERT dengan settled_at langsung terisi (mode cash/transfer, lunas
--     seketika saat dicatat -- SettlementPage.tsx, RLS insert terbuka utk
--     owner/lead/staf makanya WAJIB SECURITY DEFINER);
-- (b) UPDATE settled_at dari NULL -> terisi (mode term/piutang yang baru
--     lunas belakangan -- PiutangPage.tsx tombol "Tandai Lunas", owner-only,
--     tapi tetap DEFINER utk konsistensi pola & jaga-jaga).
-- Pola identik fn_deliveries_confirm_weighing_variance (migration 0038):
-- transisi NULL -> terisi memicu trigger, tanpa mengubah halaman React sama
-- sekali.
-- ============================================================
create or replace function fn_settlements_to_treasury()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_track text;
begin
  select s.type into v_track
  from deliveries d
  join sites s on s.id = d.site_id
  where d.id = NEW.delivery_id;

  insert into company_cash_ledger (track, amount, category, ref_type, ref_id, event_at, created_by)
  values (v_track, NEW.amount, 'settlement_in', 'settlements', NEW.id, NEW.settled_at, auth.uid());

  return NEW;
end;
$$;

create trigger trg_settlements_insert_to_treasury
  after insert on settlements
  for each row
  when (new.settled_at is not null)
  execute function fn_settlements_to_treasury();

create trigger trg_settlements_update_to_treasury
  after update of settled_at on settlements
  for each row
  when (old.settled_at is null and new.settled_at is not null)
  execute function fn_settlements_to_treasury();

revoke all on function fn_settlements_to_treasury() from public, anon, authenticated;

-- ============================================================
-- Akses baca Investor (pola identik migration 0022 investor_*): TIDAK diberi
-- SELECT ke tabel mentah, hanya lewat function SECURITY DEFINER yang
-- menolak (0 baris) kalau caller bukan owner/investor.
-- ============================================================
create or replace function investor_company_cash_ledger()
returns setof company_cash_ledger
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from company_cash_ledger where auth_user_role() in ('owner', 'investor') order by event_at desc;
$$;

revoke all on function investor_company_cash_ledger() from public, anon;
grant execute on function investor_company_cash_ledger() to authenticated;
