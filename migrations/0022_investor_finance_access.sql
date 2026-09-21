-- =============================================================================
-- Lobster SC OS (Ernawa) — Akses Investor ke Data Finance (PRD B4)
-- =============================================================================
-- Role 'investor' ada di constraint users.role sejak awal tapi tidak punya akses
-- ke apa pun. KEPUTUSAN (dari pengguna): investor melihat data FINANCE saja
-- (Dashboard Finance + Piutang & Aging), read-only.
--
-- PRINSIP: investor TIDAK diberi SELECT ke tabel mentah (deliveries,
-- settlements, receiving_lots dengan harga beli, ledger, dst.). View keuangan
-- bersifat security_invoker (sengaja, 0004), jadi investor otomatis tidak
-- melihat apa pun dari view itu. Akses diberikan lewat 4 function
-- SECURITY DEFINER yang hanya mengembalikan baris dari view Finance yang
-- sudah ada, dan MENOLAK (mengembalikan 0 baris) kalau pemanggil bukan
-- owner/investor. Kolom yang terlihat = kolom view yang sama persis dengan yang
-- dilihat owner di halaman Finance; view sudah memisahkan trading dan
-- budidaya (CLAUDE.md #1), tidak ada angka gabungan baru.
--
-- Investor TIDAK mendapat hak tulis apa pun (tidak ada policy INSERT/UPDATE
-- baru; tombol "Tandai Lunas" tetap owner-only).
--
-- users_select_self: agar aplikasi bisa membaca profil (nama, role) akun yang
-- sedang login. Policy users_select yang ada hanya untuk owner/lead/staf,
-- sehingga investor tidak bisa membaca baris dirinya sendiri dan aplikasi
-- tidak tahu rolenya. Policy baru HANYA mengizinkan membaca baris milik sendiri.
--
-- Bergantung pada 0020 (definisi view terbaru). Migration ini HANYA CREATE
-- POLICY / CREATE FUNCTION / GRANT. Tidak ada DROP/DELETE/TRUNCATE.
-- JANGAN dieksekusi sebelum direview.
-- =============================================================================

create policy users_select_self on users for select to authenticated
  using (id = auth.uid());

create or replace function investor_trading_delivery_margin()
returns setof v_trading_delivery_margin
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_trading_delivery_margin where auth_user_role() in ('owner', 'investor');
$$;

create or replace function investor_trading_capital_lockup()
returns setof v_trading_capital_lockup
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_trading_capital_lockup where auth_user_role() in ('owner', 'investor');
$$;

create or replace function investor_trading_receivable_cycle()
returns setof v_trading_receivable_cycle
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_trading_receivable_cycle where auth_user_role() in ('owner', 'investor');
$$;

create or replace function investor_settlements_aging()
returns setof v_settlements_aging
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_settlements_aging where auth_user_role() in ('owner', 'investor');
$$;

revoke all on function investor_trading_delivery_margin() from public, anon;
revoke all on function investor_trading_capital_lockup() from public, anon;
revoke all on function investor_trading_receivable_cycle() from public, anon;
revoke all on function investor_settlements_aging() from public, anon;
grant execute on function investor_trading_delivery_margin() to authenticated;
grant execute on function investor_trading_capital_lockup() to authenticated;
grant execute on function investor_trading_receivable_cycle() to authenticated;
grant execute on function investor_settlements_aging() to authenticated;
