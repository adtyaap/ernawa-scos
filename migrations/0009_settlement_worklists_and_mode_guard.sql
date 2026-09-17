-- =============================================================================
-- Lobster SC OS (Ernawa) — Settlement: Kolom override_reason + Guard Mode +
-- View Worklist (Settlement & Piutang/Aging)
-- =============================================================================
-- Dipakai oleh 2 halaman yang dibangun BARENGAN (bukan bertahap terpisah):
--   - Deliver > Settlement (buat settlement dari delivery yang siap di-settle)
--   - Finance > Piutang & Aging (worklist piutang term + aksi Tandai Lunas,
--     owner-only di level UI)
--
-- =============================================================================
-- BAGIAN 1 — override_reason + guard DB-level (bukan cuma validasi client)
-- =============================================================================
-- settlements belum punya kolom override_reason sama sekali (beda dari
-- delivery_allocations yang sudah punya sejak 0001). Ditambah di sini.
--
-- BEDA DARI POLA delivery_allocations.override_reason (yang TIDAK
-- ditegakkan DB, cuma konvensi): untuk settlements, override_reason WAJIB
-- ditegakkan DI DATABASE lewat trigger, bukan cuma validasi UI — karena
-- data ini menyentuh piutang/aging, laporan paling sensitif di proyek ini
-- (dasar pitch ke investor). Trigger SECURITY DEFINER (pola sama seperti
-- fn_delivery_allocations_site_guard di migration 0007): membandingkan
-- `mode` yang di-insert/update dengan `customers.settlement_mode` milik
-- `customer_id` terkait — kalau beda dan `override_reason` NULL, tolak
-- sama sekali (RAISE EXCEPTION), untuk SEMUA role termasuk owner.
--
-- Trigger jalan di INSERT maupun UPDATE OF mode/customer_id/override_reason
-- (bukan cuma INSERT) — alasan sama seperti migration 0007: settlements
-- tidak punya policy DELETE, jadi UPDATE adalah satu-satunya jalur koreksi,
-- dan guard ini tidak boleh bisa dilewati lewat UPDATE belakangan.
-- =============================================================================

alter table settlements
  add column override_reason text;

create or replace function fn_settlements_mode_override_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_mode settlement_mode;
begin
  select settlement_mode into v_customer_mode
  from customers
  where id = NEW.customer_id;

  if v_customer_mode is not null and NEW.mode <> v_customer_mode and NEW.override_reason is null then
    raise exception
      'Mode settlement (%) berbeda dari settlement_mode customer (%) — override_reason wajib diisi.',
      NEW.mode, v_customer_mode;
  end if;

  return NEW;
end;
$$;

create trigger trg_settlements_mode_override_guard
  before insert or update of mode, customer_id, override_reason on settlements
  for each row execute function fn_settlements_mode_override_guard();

-- =============================================================================
-- BAGIAN 2 — UNIQUE(delivery_id) di settlements
-- =============================================================================
-- Mencegah satu delivery punya lebih dari satu baris settlement (double-
-- invoice), termasuk kalau 2 user submit form Settlement untuk delivery
-- yang sama nyaris bersamaan (race condition) — anti-join di
-- v_deliveries_pending_settlement (BAGIAN 3) cuma mencegah ini di level
-- worklist/UI pada saat baca, bukan di saat tulis; constraint UNIQUE ini
-- yang jadi jaminan sesungguhnya di level database, terlepas dari timing.
--
-- SEBELUM DIEKSEKUSI — WAJIB DICEK MANUAL DULU (tidak bisa diverifikasi
-- dari sesi ini, tidak ada koneksi live ke database): tidak ada migration
-- ataupun kode frontend manapun sejauh ini yang pernah INSERT ke
-- `settlements` (halaman Settlement belum dibangun), jadi kemungkinan besar
-- tabel ini masih kosong — tapi kalau ada data uji coba yang dimasukkan
-- manual lewat SQL editor, jalankan dulu:
--   select delivery_id, count(*)
--   from settlements
--   group by delivery_id
--   having count(*) > 1;
-- Kalau query ini mengembalikan baris apa pun, ADD CONSTRAINT di bawah akan
-- GAGAL — laporkan hasilnya sebelum migration ini dieksekusi.
-- =============================================================================

alter table settlements
  add constraint settlements_delivery_id_unique unique (delivery_id);

-- =============================================================================
-- BAGIAN 3 — v_deliveries_pending_settlement
-- =============================================================================
-- Worklist untuk Deliver > Settlement: delivery yang sudah ditimbang
-- (actual_weight_kg IS NOT NULL) dan BELUM punya baris settlements
-- (anti-join lewat LEFT JOIN ... WHERE settlements.id IS NULL).
--
-- security_invoker = true SEJAK AWAL (pelajaran dari migration 0004 — kalau
-- lupa, view bypass RLS sepenuhnya karena jalan sebagai pemilik view).
-- =============================================================================

create view v_deliveries_pending_settlement
with (security_invoker = true)
as
select
  d.id as delivery_id,
  d.site_id,
  s.name as site_name,
  s.type as track,
  d.planned_kg,
  d.actual_weight_kg,
  d.delivered_at,
  d.demand_id,
  dm.customer_id,
  c.name as customer_name,
  dm.expected_price_per_kg
from deliveries d
join sites s on s.id = d.site_id
left join demands dm on dm.id = d.demand_id
left join customers c on c.id = dm.customer_id
left join settlements st on st.delivery_id = d.id
where d.actual_weight_kg is not null
  and st.id is null;

revoke all on v_deliveries_pending_settlement from public, anon, authenticated;
grant select on v_deliveries_pending_settlement to authenticated;

-- =============================================================================
-- BAGIAN 4 — v_settlements_aging
-- =============================================================================
-- Worklist untuk Finance > Piutang & Aging: semua settlements mode='term',
-- dengan hitungan hari (due_date - current_date). Positif = "X hari lagi",
-- negatif = "terlambat X hari" — frontend yang menentukan warna badge dari
-- tanda angkanya. View ini TIDAK memfilter settled_at (biar reusable untuk
-- riwayat nanti) — halaman Piutang yang akan filter settled_at IS NULL
-- untuk daftar outstanding.
--
-- security_invoker = true SEJAK AWAL, sama seperti view di atas.
-- =============================================================================

create view v_settlements_aging
with (security_invoker = true)
as
select
  s.id as settlement_id,
  s.delivery_id,
  s.customer_id,
  c.name as customer_name,
  s.mode,
  s.amount,
  s.due_date,
  s.settled_at,
  (s.due_date - current_date) as days_until_due
from settlements s
join customers c on c.id = s.customer_id
where s.mode = 'term';

revoke all on v_settlements_aging from public, anon, authenticated;
grant select on v_settlements_aging to authenticated;

-- =============================================================================
-- Migration ini menambah 1 kolom (nullable, non-destruktif), 1 trigger, 1
-- UNIQUE constraint, dan 2 view. Tidak ada DROP/ALTER DROP apa pun. JANGAN
-- dieksekusi ke database sebelum direview oleh pengguna DAN query
-- verifikasi di BAGIAN 2 sudah dijalankan.
-- =============================================================================
