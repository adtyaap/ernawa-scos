-- Breakdown kategori opex (gap Finance #3 sisa dari PRD v1 lama, Bagian
-- 7.5: "breakdown kategori opex"). company_cash_ledger.category = 'opex'
-- (migration 0040) sejauh ini cuma satu bucket datar -- tidak bisa dibedakan
-- sewa/gaji/listrik/dll. Dikonfirmasi user lewat pertanyaan eksplisit
-- sebelum dibangun:
--   1. Kategori dikelola OWNER SENDIRI lewat UI (pola sama persis Kelola
--      Tank/Kelola Produk -- migration 0031/0022-audit) -- BUKAN daftar
--      tetap di-hardcode, supaya tidak butuh migration baru tiap kali nama
--      kategori riil Ernawa berubah/bertambah.
--   2. finance_budgets (Anggaran vs Realisasi, migration 0041) TETAP satu
--      angka opex gabungan per bulan -- breakdown ini SENGAJA cuma utk
--      pelaporan/riwayat di Kas & Bank Perusahaan, TIDAK mengubah skema
--      finance_budgets/get_budget_actuals() sama sekali.
--
-- opex_categories: master data murni (nama kategori), bukan data
-- finansial/inventory -- tidak tunduk rule append-only/reversal, boleh
-- UPDATE nama biasa (konsisten pola tanks/products). Baca terbuka
-- (`using (true)`) krn cuma daftar nama, tidak ada info sensitif.
--
-- company_cash_ledger.opex_category_id: WAJIB diisi kalau category='opex'
-- (CHECK constraint), NULL utk kategori lain. company_cash_ledger sedang
-- kosong sama sekali di produksi (belum ada data finansial riil yang
-- diinput sejak migration 0040) jadi CHECK ini aman diterapkan langsung
-- tanpa perlu backfill/carve-out data lama.

create table opex_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table opex_categories enable row level security;

create policy opex_categories_select on opex_categories for select to authenticated using (true);
create policy opex_categories_insert on opex_categories for insert to authenticated
  with check ((select auth_user_role()) = 'owner');
create policy opex_categories_update on opex_categories for update to authenticated
  using ((select auth_user_role()) = 'owner')
  with check ((select auth_user_role()) = 'owner');

alter table company_cash_ledger add column opex_category_id uuid references opex_categories(id);
alter table company_cash_ledger add constraint company_cash_ledger_opex_category_check
  check (category <> 'opex' or opex_category_id is not null);

create index idx_company_cash_ledger_opex_category on company_cash_ledger (opex_category_id);
