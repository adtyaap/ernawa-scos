-- =============================================================================
-- Lobster SC OS (Ernawa) — Guard DB-Level: delivery_allocations Tidak Boleh
-- Lintas Site/Track
-- =============================================================================
-- CELAH YANG DITUTUP: deliveries.site_id adalah satu FK tunggal (satu
-- delivery = satu site), TAPI tidak ada CHECK/trigger yang memverifikasi
-- bahwa batch_line_id yang dipilih di delivery_allocations benar-benar
-- berasal dari batch di site yang SAMA dengan site milik delivery induknya.
-- Tanpa guard ini, pemisahan track (CLAUDE.md aturan #1) murni bergantung
-- pada disiplin UI — bug di frontend bisa diam-diam mengalokasikan stok
-- budidaya ke delivery yang site_id-nya trading (atau sebaliknya), dan DB
-- akan menerimanya begitu saja.
--
-- FIX: trigger BEFORE INSERT OR UPDATE OF batch_line_id, delivery_id di
-- delivery_allocations yang membandingkan site_id delivery induk
-- (deliveries.site_id) dengan site_id batch dari batch_line_id yang dipilih
-- (lewat batch_lines -> batches -> site_id). Kalau tidak sama, RAISE
-- EXCEPTION dan insert/update dibatalkan sama sekali.
--
-- KENAPA JUGA UPDATE, TIDAK CUKUP INSERT SAJA: delivery_allocations tidak
-- punya policy DELETE untuk role manapun, jadi satu-satunya cara koreksi
-- alokasi yang salah adalah UPDATE (owner-only). Kalau guard cuma jalan di
-- INSERT, celah cross-site/cross-track yang mau ditutup bisa muncul lagi
-- lewat UPDATE batch_line_id/delivery_id setelah baris tersimpan. Dibatasi
-- `OF batch_line_id, delivery_id` supaya trigger TIDAK re-validasi tiap kali
-- cuma override_reason yang diubah (kolom itu tidak memengaruhi konsistensi
-- site/track).
--
-- SECURITY DEFINER (pola sama seperti fn_mortality_events_ledger,
-- fn_batch_lines_ledger, fn_handover_lines_ledger, fn_delivery_allocations_ledger
-- di migration 0001/0003): berlaku untuk SEMUA role tanpa perlu grant
-- tambahan, dan tidak bisa dilewati oleh role manapun (termasuk owner) --
-- guard ini murni soal konsistensi data, bukan soal siapa boleh insert.
--
-- Untuk INSERT, trigger ini BEFORE, jadi berjalan SEBELUM
-- trg_delivery_allocations_ledger (AFTER INSERT, dari 0001/0003) — kalau
-- site tidak cocok, insert gagal duluan dan ledger otomatis pun tidak
-- pernah terpanggil. Untuk UPDATE batch_line_id/delivery_id, tidak ada
-- trigger ledger otomatis yang perlu diperhitungkan (ledger cuma dibuat
-- saat INSERT), jadi guard ini berdiri sendiri untuk kasus UPDATE.
--
-- Migration ini HANYA menambah 1 fungsi + 1 trigger (CREATE OR REPLACE /
-- CREATE TRIGGER). Tidak ada DROP/ALTER apa pun. JANGAN dieksekusi ke
-- database sebelum direview oleh pengguna.
-- =============================================================================

create or replace function fn_delivery_allocations_site_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery_site_id uuid;
  v_batch_site_id uuid;
begin
  select d.site_id into v_delivery_site_id
  from deliveries d
  where d.id = NEW.delivery_id;

  select b.site_id into v_batch_site_id
  from batch_lines bl
  join batches b on b.id = bl.batch_id
  where bl.id = NEW.batch_line_id;

  if v_delivery_site_id is null or v_batch_site_id is null then
    raise exception 'delivery_id atau batch_line_id tidak valid (site terkait tidak ditemukan).';
  end if;

  if v_delivery_site_id <> v_batch_site_id then
    raise exception
      'Site tidak cocok: delivery % terikat ke site %, tapi batch_line % berasal dari site %. Alokasi lintas site/track tidak diizinkan.',
      NEW.delivery_id, v_delivery_site_id, NEW.batch_line_id, v_batch_site_id;
  end if;

  return NEW;
end;
$$;

create trigger trg_delivery_allocations_site_guard
  before insert or update of batch_line_id, delivery_id on delivery_allocations
  for each row execute function fn_delivery_allocations_site_guard();
