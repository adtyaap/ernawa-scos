-- site_forecast (PRD-MASTER §3/§16 open question, dikonfirmasi user: bangun
-- sekarang meski model masih kasar). Prediksi kebutuhan pasokan per site ke
-- depan.
--
-- SENGAJA proyeksi SEDERHANA (rata-rata harian tertimbang dari riwayat
-- penerimaan N hari terakhir, diekstrapolasi ke depan) -- BUKAN model
-- time-series/statistik canggih. Trading masih volume pilot dan budidaya
-- belum beroperasi sama sekali (CLAUDE.md), jadi model rumit hanya akan
-- mengarang presisi yang tidak didukung data. `data_points` disertakan
-- eksplisit supaya user bisa menilai sendiri reliabilitasnya (mis. cuma 1-2
-- transaksi dalam 30 hari = proyeksi lemah, bukan prediksi yang bisa
-- diandalkan) -- BUKAN disembunyikan di balik satu angka yang terlihat pasti.
--
-- Sengaja TIDAK ada tabel snapshot -- ini fungsi baca murni (SECURITY
-- INVOKER, RLS receiving_lots/receiving_transactions yang sudah ada otomatis
-- membatasi ke site yang bisa diakses caller), dihitung on-demand dari
-- inventory_ledger/receiving_lots yang sudah ada. Snapshot periodik butuh
-- infrastruktur cron yang belum ada di proyek ini -- ditunda sampai memang
-- dibutuhkan (bandingkan/analisis akurasi forecast dari waktu ke waktu),
-- bukan dibangun spekulatif sekarang.
--
-- Stok asal handover (source_handover_id) DIKECUALIKAN -- itu pindahan stok
-- antar site, bukan pasokan baru, sama seperti pengecualian yang sama di
-- ref_price() (migration 0029).

create or replace function public.get_site_forecast(
  p_site_id uuid,
  p_history_days integer default 30,
  p_forecast_days integer default 7
)
returns table(
  product_id uuid,
  product_name text,
  data_points integer,
  total_received_kg numeric,
  avg_daily_kg numeric,
  forecast_kg numeric,
  first_received_at date,
  last_received_at date
)
language sql
stable
set search_path to 'public'
as $function$
  select
    rl.product_id,
    p.name as product_name,
    count(*)::integer as data_points,
    sum(rl.qty_kg) as total_received_kg,
    sum(rl.qty_kg) / greatest(p_history_days, 1) as avg_daily_kg,
    (sum(rl.qty_kg) / greatest(p_history_days, 1)) * p_forecast_days as forecast_kg,
    min(rt.transaction_date) as first_received_at,
    max(rt.transaction_date) as last_received_at
  from receiving_lots rl
  join receiving_transactions rt on rt.id = rl.receiving_transaction_id
  join products p on p.id = rl.product_id
  where rt.site_id = p_site_id
    and rt.source_handover_id is null
    and rt.transaction_date > current_date - greatest(p_history_days, 1)
    and rt.transaction_date <= current_date
  group by rl.product_id, p.name
  order by total_received_kg desc;
$function$;
