-- Optimisasi performa RLS: bungkus auth.uid()/auth_user_role()/
-- user_can_access_site() dengan (select ...) di 11 policy yang ditandai
-- performance advisor Supabase (auth_rls_initplan, level WARN) --
-- ditemukan lewat audit proaktif "get_advisors(type='performance')" yang
-- belum pernah dijalankan sebelumnya di sesi ini (baru security advisors
-- yang rutin dicek).
--
-- MASALAH: tanpa dibungkus (select ...), Postgres planner mengevaluasi
-- ulang auth.uid()/fungsi STABLE lain di USING/WITH CHECK untuk SETIAP
-- BARIS yang dipindai (bukan sekali per-query) -- makin banyak baris di
-- tabel, makin lambat. Membungkusnya dalam sub-SELECT membuat planner bisa
-- mengubahnya jadi InitPlan (dievaluasi sekali, hasilnya di-cache untuk
-- seluruh query). auth_user_role() dan user_can_access_site() juga STABLE
-- (dicek lewat pg_proc.provolatile = 's') jadi ikut dibungkus juga di sini
-- meski linter cuma menyebut nama auth.uid() secara eksplisit -- akar
-- masalahnya sama persis, dan keduanya dipanggil di policy yang sama yang
-- sudah disentuh, jadi sekalian dibereskan (bukan menambah linter baru
-- untuk gap yang identik).
--
-- MURNI OPTIMISASI QUERY PLANNER -- tidak ada perubahan logika akses sama
-- sekali (kondisi USING/WITH CHECK persis sama secara semantik, cuma cara
-- planner mengevaluasinya yang berubah). Tetap diuji per-role sesuai
-- disiplin proyek (CLAUDE.md: setiap perubahan RLS wajib disimulasikan per
-- role) karena in-place DROP+CREATE POLICY punya risiko salah ketik cakupan
-- meskipun niatnya cuma optimisasi.

-- users
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists users_insert_self on public.users;
create policy users_insert_self on public.users
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- terima_cepat_favorites
drop policy if exists terima_cepat_favorites_select on public.terima_cepat_favorites;
create policy terima_cepat_favorites_select on public.terima_cepat_favorites
  for select
  using (user_id = (select auth.uid()));

drop policy if exists terima_cepat_favorites_insert on public.terima_cepat_favorites;
create policy terima_cepat_favorites_insert on public.terima_cepat_favorites
  for insert
  with check (user_id = (select auth.uid()));

drop policy if exists terima_cepat_favorites_delete on public.terima_cepat_favorites;
create policy terima_cepat_favorites_delete on public.terima_cepat_favorites
  for delete
  using (user_id = (select auth.uid()));

-- cash_ledger
drop policy if exists cash_ledger_select on public.cash_ledger;
create policy cash_ledger_select on public.cash_ledger
  for select to authenticated
  using (
    (select auth_user_role()) = 'owner'
    or pic_user_id = (select auth.uid())
  );

drop policy if exists cash_ledger_insert on public.cash_ledger;
create policy cash_ledger_insert on public.cash_ledger
  for insert to authenticated
  with check (
    (select auth_user_role()) = 'owner'
    or (
      (select auth_user_role()) = any (array['lead_lapangan', 'staf_lapangan'])
      and pic_user_id = (select auth.uid())
      and created_by = (select auth.uid())
      and reversal_of is null
      and category = any (array['expense', 'return'])
    )
  );

-- cash_reconciliations
drop policy if exists cash_reconciliations_select on public.cash_reconciliations;
create policy cash_reconciliations_select on public.cash_reconciliations
  for select
  using (
    (select auth_user_role()) = 'owner'
    or pic_user_id = (select auth.uid())
  );

drop policy if exists cash_reconciliations_insert on public.cash_reconciliations;
create policy cash_reconciliations_insert on public.cash_reconciliations
  for insert
  with check (
    pic_user_id = (select auth.uid())
    and created_by = (select auth.uid())
    and (select user_can_access_site(site_id))
  );

-- user_sites
drop policy if exists user_sites_select on public.user_sites;
create policy user_sites_select on public.user_sites
  for select to authenticated
  using (
    (select auth_user_role()) = 'owner'
    or user_id = (select auth.uid())
  );
