-- =============================================================================
-- Lobster SC OS (Ernawa) — Penugasan User ke Site (fondasi scoping akses)
-- =============================================================================
-- Menutup sebagian item tech debt "users belum punya site/track scoping" (PRD
-- A3). Migration ini HANYA menyiapkan fondasi: tabel penugasan + fungsi helper
-- + backfill. TIDAK mengubah satu pun policy RLS tabel operasional — perilaku
-- akses aplikasi sama persis setelah migration ini dijalankan. Perubahan
-- policy ada di migration 0017 (terpisah, supaya bisa diuji dan di-review
-- sendiri).
--
-- MODEL: user_sites (user_id, site_id). Track tidak punya penugasan sendiri —
-- track mengikuti sites.type dari site yang ditugaskan.
--   * owner            : selalu boleh semua site (tidak perlu baris user_sites).
--   * lead/staf_lapangan: hanya site yang ada di user_sites miliknya.
--   * role lain/NULL    : tidak boleh site manapun.
-- Gagal-tertutup: user lapangan baru TANPA penugasan tidak melihat data site
-- manapun sampai owner menugaskannya.
--
-- RLS user_sites:
--   * SELECT : owner melihat semua; user lapangan hanya baris miliknya sendiri.
--   * INSERT/UPDATE/DELETE : owner saja. DELETE diizinkan HANYA di tabel
--     penugasan ini (bukan tabel transaksi/ledger) karena mencabut akses harus
--     mungkin; perubahan penugasan tercatat di audit_log lewat trigger.
--
-- user_can_access_site() SECURITY DEFINER + search_path terkunci, pola sama
-- dengan auth_user_role() (0003): perlu membaca user_sites tanpa terhalang RLS
-- milik pemanggil supaya tidak rekursif saat dipakai di policy tabel lain.
-- Hanya mengembalikan boolean untuk user yang sedang login (auth.uid()), tidak
-- bisa dipakai menebak penugasan user lain.
--
-- BACKFILL: setiap user ber-role lead_lapangan/staf_lapangan yang SUDAH ADA
-- ditugaskan ke SEMUA site yang ada sekarang, supaya tidak ada yang terkunci
-- saat 0017 diterapkan. Owner bisa mempersempitnya lewat UI/SQL sesudahnya.
-- Idempotent (ON CONFLICT DO NOTHING).
--
-- Migration ini HANYA CREATE TABLE/FUNCTION/POLICY/TRIGGER dan INSERT backfill.
-- Tidak ada DROP/ALTER/DELETE/TRUNCATE. JANGAN dieksekusi sebelum direview.
-- =============================================================================

create table user_sites (
  user_id uuid not null references users (id) on delete cascade,
  site_id uuid not null references sites (id),
  created_at timestamptz not null default now(),
  primary key (user_id, site_id)
);
create index idx_user_sites_site on user_sites (site_id);

comment on table user_sites is 'Penugasan user lapangan ke site. Track mengikuti sites.type. Owner tidak butuh baris di sini (akses semua site).';

alter table user_sites enable row level security;

create policy user_sites_select on user_sites for select to authenticated
  using (auth_user_role() = 'owner' or user_id = auth.uid());
create policy user_sites_insert on user_sites for insert to authenticated
  with check (auth_user_role() = 'owner');
create policy user_sites_update on user_sites for update to authenticated
  using (auth_user_role() = 'owner') with check (auth_user_role() = 'owner');
create policy user_sites_delete on user_sites for delete to authenticated
  using (auth_user_role() = 'owner');

create or replace function user_can_access_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when auth_user_role() = 'owner' then true
    when auth_user_role() in ('lead_lapangan', 'staf_lapangan') then
      exists (select 1 from user_sites us where us.user_id = auth.uid() and us.site_id = p_site_id)
    else false
  end;
$$;

revoke all on function user_can_access_site(uuid) from public, anon;
grant execute on function user_can_access_site(uuid) to authenticated;

-- Jejak audit untuk perubahan penugasan (siapa memberi/mencabut akses ke siapa).
create or replace function fn_user_sites_audit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if TG_OP = 'DELETE' then
    insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
    values ('user_sites', OLD.user_id, 'delete', to_jsonb(OLD), null, auth.uid());
    return OLD;
  end if;

  insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  values ('user_sites', NEW.user_id, lower(TG_OP), case when TG_OP = 'UPDATE' then to_jsonb(OLD) else null end, to_jsonb(NEW), auth.uid());
  return NEW;
end;
$$;

create trigger trg_user_sites_audit
  after insert or update or delete on user_sites
  for each row execute function fn_user_sites_audit();

-- Backfill dilakukan SETELAH trigger audit dibuat supaya penugasan awal juga
-- tercatat (changed_by NULL karena dijalankan dari SQL Editor/migration).
insert into user_sites (user_id, site_id)
select u.id, s.id
from users u
cross join sites s
where u.role in ('lead_lapangan', 'staf_lapangan')
on conflict do nothing;
