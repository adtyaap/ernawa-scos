-- =============================================================================
-- Lobster SC OS (Ernawa) — Fungsi Stock-Picker: get_available_batch_lines
-- =============================================================================
-- Dipakai oleh halaman Deliver > Alokasi & Kirim untuk menampilkan
-- batch_line yang tersedia di SATU site, terurut FEFO (paling lama duluan),
-- lengkap dengan info "lewat ambang holding" per product+track.
--
-- KENAPA FUNCTION, BUKAN VIEW: p_site_id adalah PARAMETER WAJIB, bukan
-- filter opsional yang bisa lupa dipasang di query client (mis. `.eq()` di
-- atas sebuah view yang, kalau lupa, akan mengembalikan SEMUA site). Filter
-- site menempel di badan SQL function ini sendiri (join `batches b on
-- b.id = bl.batch_id and b.site_id = p_site_id`), jadi tidak ada cara
-- memanggil function ini tanpa site, dan tidak ada cara ia mengembalikan
-- baris dari site lain.
--
-- STABLE + tanpa SECURITY DEFINER (invoker-rights, sama seperti
-- get_or_create_batch() di 0001): tetap tunduk RLS milik pemanggil.
-- Kalau pemanggil tidak punya akses SELECT ke inventory_ledger/batch_lines/
-- batches/sites/product_holding_policy, function ini pun tidak bisa
-- membocorkan apa-apa — bukan bypass seperti trigger ledger otomatis yang
-- SECURITY DEFINER.
--
-- SALDO: dihitung langsung SUM(qty_kg) di query ini (bukan lewat
-- v_batch_line_balance terpisah), karena join batch_lines->batches->sites
-- untuk filter site sudah dibutuhkan di sini juga — tidak ada untung
-- menambah satu join balik ke view lain.
--
-- AMBANG HOLDING: max_holding_hours diambil dari product_holding_policy
-- di-JOIN pakai (product_id, track) — bukan cuma product_id — supaya nilai
-- yang dipakai selalu sesuai track site yang sedang dipilih (trading vs
-- budidaya beda jauh). LEFT JOIN supaya batch_line tanpa baris policy tetap
-- muncul (max_holding_hours/age_hours/is_overdue jadi NULL, ditandai
-- "ambang belum diatur" di UI) — bukan diam-diam dianggap aman atau malah
-- hilang dari daftar.
--
-- Migration ini HANYA menambah 1 fungsi baru (CREATE OR REPLACE FUNCTION).
-- Tidak ada DROP/ALTER apa pun. JANGAN dieksekusi ke database sebelum
-- direview oleh pengguna.
-- =============================================================================

create or replace function get_available_batch_lines(p_site_id uuid)
returns table (
  batch_line_id uuid,
  tank_name text,
  product_id uuid,
  product_name text,
  balance_kg numeric,
  received_at timestamptz,
  max_holding_hours integer,
  age_hours numeric,
  is_overdue boolean
)
language sql
stable
as $$
  select
    bl.id as batch_line_id,
    t.name as tank_name,
    rl.product_id,
    p.name as product_name,
    sum(il.qty_kg) as balance_kg,
    min(il.event_at) filter (where il.movement_type = 'receive') as received_at,
    php.max_holding_hours,
    extract(epoch from (now() - min(il.event_at) filter (where il.movement_type = 'receive'))) / 3600 as age_hours,
    (
      php.max_holding_hours is not null
      and extract(epoch from (now() - min(il.event_at) filter (where il.movement_type = 'receive'))) / 3600
          > php.max_holding_hours
    ) as is_overdue
  from batch_lines bl
  join batches b on b.id = bl.batch_id and b.site_id = p_site_id
  join sites s on s.id = b.site_id
  join tanks t on t.id = b.tank_id
  join receiving_lots rl on rl.id = bl.receiving_lot_id
  join products p on p.id = rl.product_id
  left join product_holding_policy php on php.product_id = rl.product_id and php.track = s.type
  join inventory_ledger il on il.batch_line_id = bl.id
  group by bl.id, t.name, rl.product_id, p.name, php.max_holding_hours
  having sum(il.qty_kg) > 0
  order by received_at asc nulls last;
$$;
