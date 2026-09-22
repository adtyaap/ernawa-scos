-- Papan Favorit untuk Terima Cepat (gap audit per-modul 22 Sept): shortcut
-- kombinasi supplier/site/tank/produk yang sering dipakai, supaya staf
-- lapangan tidak pilih dropdown yang sama berulang tiap hari untuk entri
-- rutin (mis. selalu terima dari supplier X di site Y tank Z produk W).
--
-- Ini murni preferensi UI PER USER, bukan data bisnis/finansial/inventory --
-- TIDAK tunduk pada rule #2/#3 CLAUDE.md (append-only + reversal-only).
-- UPDATE/DELETE biasa cukup, tidak perlu ledger/reversal. Setiap user cuma
-- bisa lihat & kelola favoritnya sendiri (RLS by auth.uid(), tidak ada
-- konsep "favorit bersama tim" di versi ini).

create table terima_cepat_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  label text not null,
  supplier_id uuid not null references suppliers(id),
  site_id uuid not null references sites(id),
  tank_id uuid not null references tanks(id),
  product_id uuid not null references products(id),
  created_at timestamptz not null default now()
);

alter table terima_cepat_favorites enable row level security;

create policy terima_cepat_favorites_select on terima_cepat_favorites
  for select using (user_id = auth.uid());

create policy terima_cepat_favorites_insert on terima_cepat_favorites
  for insert with check (user_id = auth.uid());

create policy terima_cepat_favorites_delete on terima_cepat_favorites
  for delete using (user_id = auth.uid());
