-- DPO (Days Payable Outstanding) + CCC (Cash Conversion Cycle) -- gap
-- terakhir dari 5 gap Control Tower (perbandingan UI vs artifact lama
-- "Lobster Trading Control Tower"). CCC = Inventory Days + DSO - DPO;
-- Inventory Days (v_trading_capital_lockup) & DSO (v_trading_receivable_cycle)
-- sudah ada, DPO belum ada sama sekali -- tidak ada field termin bayar ke
-- supplier di skema manapun.
--
-- Dikonfirmasi user lewat pertanyaan eksplisit sebelum dibangun:
--   1. Termin per SUPPLIER (bukan per transaksi penerimaan) -- kolom baru
--      suppliers.payment_term_days, pola identik customers.payment_term_days
--      yang sudah ada (migration 0006).
--   2. Realitas bisnis dikonfirmasi: SEBAGIAN/SEMUA supplier memang punya
--      termin bayar (bukan selalu tunai di tempat) -- jadi DPO relevan
--      dihitung, bukan selalu 0. (Catatan: PRD v3 Bagian 7 menyebut "Kas
--      panjar per orang -- Pembayaran ke nelayan tunai di tempat, DPO nol"
--      sbg kemampuan v43 yang wajib dipertahankan -- itu benar utk SEBAGIAN
--      supplier/pembelian, bukan generalisasi "semua pembelian selalu
--      tunai". Kas Panjar tetap ada & tidak berubah; DPO ini murni metrik
--      tambahan di atasnya utk supplier yang memang punya termin.)
--
-- v_trading_dpo_inputs: granularitas SAMA PERSIS dgn v_trading_capital_lockup
-- (per delivery_allocation, filter site.type='trading', delivered_at is not
-- null, cancelled_at is null) supaya CCC (gabungan 3 metrik) konsisten
-- populasinya. buy_price_per_kg dari delivery_allocations (migration 0037,
-- HARGA TERKUNCI saat alokasi -- bukan live-join, konsisten dgn perbaikan
-- P10 sebelumnya). payment_term_days NULLABLE di level baris (supplier
-- belum tentu sudah diisi termin-nya) -- DIHITUNG SEBAGAI WEIGHTED AVERAGE
-- di frontend HANYA dari baris yang payment_term_days-nya terisi (bukan
-- diasumsikan 0), dgn coverage % ditampilkan supaya user tahu seberapa
-- representatif angkanya -- BUKAN mengarang termin utk supplier yang belum
-- diisi (konsisten prinsip proyek: jangan mengisi kosong dgn karangan,
-- sama seperti alasan ref_price() migration 0028 tidak membuat katalog
-- statis).
--
-- Receiving asal Serah Terima (handover, migration 0029 -- supplier_id
-- NULL, source_handover_id terisi) DIKECUALIKAN -- itu bukan pembelian
-- riil dari supplier eksternal, tidak ada kewajiban bayar yang relevan
-- (konsisten dgn ref_price() yang sudah mengecualikan hal yang sama).

alter table suppliers add column payment_term_days integer check (payment_term_days is null or payment_term_days >= 0);
comment on column suppliers.payment_term_days is 'Termin bayar ke supplier (hari). NULL = belum diklasifikasi (BUKAN sama dgn 0/tunai -- 0 harus diisi eksplisit kalau memang tunai di tempat).';

create view v_trading_dpo_inputs with (security_invoker = true) as
select
  da.id as delivery_allocation_id,
  da.qty_kg,
  da.buy_price_per_kg,
  da.qty_kg * da.buy_price_per_kg as purchase_value,
  sup.payment_term_days
from delivery_allocations da
join deliveries d on d.id = da.delivery_id
join sites site on site.id = d.site_id
join batch_lines bl on bl.id = da.batch_line_id
join receiving_lots rl on rl.id = bl.receiving_lot_id
join receiving_transactions rt on rt.id = rl.receiving_transaction_id
join suppliers sup on sup.id = rt.supplier_id
where site.type = 'trading'
  and d.delivered_at is not null
  and d.cancelled_at is null
  and rt.supplier_id is not null;

create or replace function investor_trading_dpo_inputs()
returns setof v_trading_dpo_inputs
language sql
stable
security definer
set search_path to 'public'
as $$
  select * from v_trading_dpo_inputs where auth_user_role() in ('owner', 'investor');
$$;

revoke all on function investor_trading_dpo_inputs() from public, anon;
grant execute on function investor_trading_dpo_inputs() to authenticated;
