-- 3 gap AR yang ketahuan saat verifikasi ulang cermat "apakah semua sudah
-- sesuai artifact Control Tower" (permintaan user langsung, bukan diklaim
-- tanpa dicek): AR Aging 4-bucket, KPI total piutang outstanding, dan
-- ambang piutang lewat tempo (ar_watch_days) yang configurable -- ketiganya
-- luput dari audit gap sebelumnya krn fokus cuma ke tab Ringkasan, bukan
-- tab Pengaturan artifact yang juga punya ar_watch_days. Dikonfirmasi user
-- utk dibangun sekarang.
--
-- v_settlements_aging (migration 0009) TIDAK PUNYA kolom track sama sekali
-- -- ditambahkan di sini (additive, security_invoker DIPERTAHANKAN eksplisit
-- supaya tidak regresi ke security_definer default) supaya FinancePage bisa
-- filter trading-only (aturan #1, konsisten pola semua metrik Finance lain).
-- PiutangPage & investor_settlements_aging() tidak perlu diubah -- kolom
-- baru ditambahkan di akhir, tidak mengubah kolom yang sudah ada.
--
-- ar_watch_days: kolom baru di finance_targets (per track, config data spt
-- margin_target_pct yang sudah ada) -- NULLABLE, TIDAK diisi default
-- (konsisten pola product_holding_policy/mortality_thresholds: Owner WAJIB
-- mengisi dulu supaya alert jenis ini mulai aktif, bukan diasumsikan angka
-- artifact lama 30 hari begitu saja).

create or replace view v_settlements_aging
with (security_invoker = true) as
select
  s.id as settlement_id,
  s.delivery_id,
  s.customer_id,
  c.name as customer_name,
  s.mode,
  s.amount,
  s.due_date,
  s.settled_at,
  s.due_date - current_date as days_until_due,
  site.type::text as track
from settlements s
join customers c on c.id = s.customer_id
join deliveries d on d.id = s.delivery_id
join sites site on site.id = d.site_id
where s.mode = 'term'::settlement_mode;

alter table finance_targets add column ar_watch_days integer check (ar_watch_days is null or ar_watch_days > 0);
comment on column finance_targets.ar_watch_days is 'Ambang hari lewat tempo utk memicu alert piutang di Panel Peringatan Aktif. NULL = belum diatur -- alert AR tidak aktif utk track itu sampai Owner mengisi (konsisten pola product_holding_policy/mortality_thresholds).';
