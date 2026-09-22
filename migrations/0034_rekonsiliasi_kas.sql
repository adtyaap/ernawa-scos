-- Rekonsiliasi Kas (gap audit per-modul 22 Sept, item (b)): tutup periode +
-- cocokkan Kas Panjar dengan kas fisik — beda dari saldo berjalan Kas Panjar
-- yang sudah ada (migration 0027), yang cuma running balance tanpa titik
-- "resmi dicocokkan dengan fisik" yang terkunci.
--
-- Keputusan desain (dikonfirmasi user):
-- 1. Lead/Staf SELF-reconcile: PIC lapangan sendiri yang input hasil hitung
--    fisik untuk (pic=dirinya sendiri, site yang ditugaskan ke dirinya).
--    Owner cuma approve/reject, tidak input hitungan fisik sendiri (meski
--    RLS tetap izinkan owner insert atas nama siapa pun, konsisten dgn pola
--    Kas Panjar yang sudah ada -- "unrestricted" utk owner).
-- 2. Approve MENGUNCI periode: baris cash_ledger dgn event_at <=
--    period_end_date utk (pic, site) itu TIDAK BISA lagi direversal lewat
--    create_cash_reversal begitu ada reconciliation berstatus 'approved'
--    yang meng-cover tanggal itu.
-- 3. Selisih (physical - system) OTOMATIS tercatat sebagai baris
--    cash_ledger kategori 'adjustment' saat owner approve (bukan saat
--    lead/staf submit) -- category='adjustment' cuma boleh diinsert owner
--    per RLS cash_ledger_insert yang sudah ada, jadi ini pas dilakukan pas
--    approve, bukan pas pengajuan.

create table cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  pic_user_id uuid not null references users(id),
  site_id uuid not null references sites(id),
  period_end_date date not null,
  physical_amount numeric not null check (physical_amount >= 0),
  system_balance numeric not null,
  variance numeric not null,
  status text not null default 'pending_approval' check (status in ('pending_approval', 'approved', 'rejected')),
  notes text,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  approved_by uuid references users(id),
  approved_at timestamptz,
  approval_reason text,
  adjustment_ledger_id uuid references cash_ledger(id)
);

alter table cash_reconciliations enable row level security;

create policy cash_reconciliations_select on cash_reconciliations for select
using (
  auth_user_role() = 'owner'
  or pic_user_id = auth.uid()
);

create policy cash_reconciliations_update on cash_reconciliations for update
using (auth_user_role() = 'owner')
with check (auth_user_role() = 'owner');

-- INSERT selalu SELF (pic_user_id = created_by = auth.uid()) -- desain yang
-- disepakati adalah "self-reconcile", tidak ada yang mengajukan atas nama
-- orang lain (termasuk owner). system_balance/variance TETAP dihitung server
-- di create_cash_reconciliation() (tidak bisa dipalsukan client) meski policy
-- ini juga mengizinkan INSERT langsung secara teknis -- RPC yang jadi jalur
-- resminya di UI.
create policy cash_reconciliations_insert on cash_reconciliations for insert
with check (
  pic_user_id = auth.uid()
  and created_by = auth.uid()
  and user_can_access_site(site_id)
);

create or replace function public.create_cash_reconciliation(
  p_site_id uuid,
  p_period_end_date date,
  p_physical_amount numeric,
  p_notes text default null
) returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_system_balance numeric;
  v_id uuid;
begin
  if p_physical_amount is null or p_physical_amount < 0 then
    raise exception 'Jumlah kas fisik harus diisi dan tidak boleh negatif.';
  end if;
  if not user_can_access_site(p_site_id) then
    raise exception 'Anda tidak punya akses ke site ini.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cash-reconcile:' || auth.uid()::text || ':' || p_site_id::text, 0));

  select coalesce(sum(amount), 0)
  into v_system_balance
  from cash_ledger
  where pic_user_id = auth.uid()
    and site_id = p_site_id
    and event_at::date <= p_period_end_date;

  insert into cash_reconciliations (pic_user_id, site_id, period_end_date, physical_amount, system_balance, variance, notes, created_by)
  values (auth.uid(), p_site_id, p_period_end_date, p_physical_amount, v_system_balance, p_physical_amount - v_system_balance, p_notes, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.approve_cash_reconciliation(
  p_reconciliation_id uuid,
  p_approve boolean,
  p_reason text default null
) returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_row cash_reconciliations%rowtype;
  v_adjustment_id uuid;
begin
  if coalesce(auth_user_role(), '') <> 'owner' then
    raise exception 'Hanya Owner yang boleh menyetujui/menolak rekonsiliasi.';
  end if;

  select * into v_row from cash_reconciliations where id = p_reconciliation_id;
  if not found then
    raise exception 'Rekonsiliasi % tidak ditemukan.', p_reconciliation_id;
  end if;
  if v_row.status <> 'pending_approval' then
    raise exception 'Rekonsiliasi ini sudah diproses sebelumnya (status: %).', v_row.status;
  end if;

  if p_approve then
    if v_row.variance <> 0 then
      insert into cash_ledger (site_id, pic_user_id, created_by, category, amount, ref_type, ref_id, event_at)
      values (v_row.site_id, v_row.pic_user_id, auth.uid(), 'adjustment', v_row.variance, 'cash_reconciliations', v_row.id, now())
      returning id into v_adjustment_id;
    end if;

    update cash_reconciliations
    set status = 'approved', approved_by = auth.uid(), approved_at = now(), approval_reason = p_reason, adjustment_ledger_id = v_adjustment_id
    where id = p_reconciliation_id;
  else
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'Alasan penolakan wajib diisi.';
    end if;
    update cash_reconciliations
    set status = 'rejected', approved_by = auth.uid(), approved_at = now(), approval_reason = p_reason
    where id = p_reconciliation_id;
  end if;
end;
$function$;

-- Kunci: cash_ledger yang sudah tercakup rekonsiliasi APPROVED tidak bisa
-- direversal lagi.
create or replace function public.create_cash_reversal(p_ledger_id uuid, p_reason text)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
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
  if exists (
    select 1 from cash_reconciliations cr
    where cr.pic_user_id = v_orig.pic_user_id
      and cr.site_id = v_orig.site_id
      and cr.status = 'approved'
      and cr.period_end_date >= v_orig.event_at::date
  ) then
    raise exception 'Baris ini sudah tercakup rekonsiliasi kas yang disetujui dan tidak bisa dikoreksi lagi.';
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
$function$;
