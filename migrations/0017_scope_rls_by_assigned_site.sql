-- =============================================================================
-- Lobster SC OS (Ernawa) — Scoping RLS per Site Penugasan (PRD A3)
-- =============================================================================
-- Mengganti pengecekan "role lapangan boleh semua" menjadi "role lapangan hanya
-- untuk SITE YANG DITUGASKAN" (user_sites, migration 0016) di semua tabel
-- operasional yang terikat site. Owner tetap akses penuh
-- (user_can_access_site() selalu true untuk owner). Role selain
-- owner/lead/staf (mis. investor) tetap TIDAK punya akses di tabel-tabel ini,
-- sama seperti sebelumnya.
--
-- DIPAKAI ALTER POLICY (bukan DROP/CREATE): nama policy, command, dan target
-- role tidak berubah; hanya ekspresi USING / WITH CHECK yang diganti. Tidak ada
-- policy yang sempat hilang di antara dua langkah.
--
-- CARA SITE DITURUNKAN:
--   langsung  : sites(id), tanks, receiving_transactions, batches, deliveries,
--               price_today (kolom site_id); handovers (from_site_id/to_site_id).
--   lewat join: receiving_lots -> receiving_transactions; batch_lines,
--               quality_inspections -> batches; inventory_ledger,
--               mortality_events, handover_lines -> batch_lines -> batches;
--               delivery_allocations, settlements -> deliveries.
--
-- TIDAK DIUBAH (sengaja):
--   * UPDATE yang sudah owner-only tetap owner-only.
--   * INSERT inventory_ledger tetap owner-only (baris ledger lain dibuat oleh
--     trigger SECURITY DEFINER, tidak terkena RLS).
--   * Master global: customers, suppliers, products, product_holding_policy,
--     demands (tidak punya site_id) tetap terbuka untuk 3 role lapangan.
--   * users (nama user untuk kolom "dicatat oleh"), audit_log, cash_ledger,
--     user_sites.
--   * View (semua security_invoker) dan RPC (semua SECURITY INVOKER) otomatis
--     ikut ter-scope. Trigger ledger SECURITY DEFINER tidak terpengaruh.
--
-- PENTING: user lapangan tanpa baris user_sites tidak akan melihat data site
-- manapun (gagal-tertutup). Backfill di 0016 sudah menugaskan user lapangan
-- yang ada ke semua site, jadi tidak ada yang terkunci saat ini.
--
-- Migration ini HANYA ALTER POLICY. Tidak ada DROP/DELETE/TRUNCATE. Dijalankan
-- dalam satu transaksi: kalau satu statement gagal, semua kembali seperti
-- semula. JANGAN dieksekusi sebelum direview.
-- =============================================================================

-- ------------------------------ langsung: site_id ----------------------------
alter policy sites_select on sites
  using (user_can_access_site(id));

alter policy tanks_select on tanks
  using (user_can_access_site(site_id));

alter policy price_today_select on price_today
  using (user_can_access_site(site_id));

alter policy receiving_transactions_select on receiving_transactions
  using (user_can_access_site(site_id));
alter policy receiving_transactions_insert on receiving_transactions
  with check (user_can_access_site(site_id));

alter policy batches_select on batches
  using (user_can_access_site(site_id));
alter policy batches_insert on batches
  with check (user_can_access_site(site_id));

alter policy deliveries_select on deliveries
  using (user_can_access_site(site_id));
alter policy deliveries_insert on deliveries
  with check (user_can_access_site(site_id));
alter policy deliveries_update on deliveries
  using (user_can_access_site(site_id))
  with check (user_can_access_site(site_id));

-- ------------------------------- lewat join ----------------------------------
alter policy receiving_lots_select on receiving_lots
  using (exists (
    select 1 from receiving_transactions rt
    where rt.id = receiving_lots.receiving_transaction_id and user_can_access_site(rt.site_id)));
alter policy receiving_lots_insert on receiving_lots
  with check (exists (
    select 1 from receiving_transactions rt
    where rt.id = receiving_lots.receiving_transaction_id and user_can_access_site(rt.site_id)));

alter policy batch_lines_select on batch_lines
  using (exists (
    select 1 from batches b
    where b.id = batch_lines.batch_id and user_can_access_site(b.site_id)));
alter policy batch_lines_insert on batch_lines
  with check (exists (
    select 1 from batches b
    where b.id = batch_lines.batch_id and user_can_access_site(b.site_id)));

alter policy quality_inspections_select on quality_inspections
  using (exists (
    select 1 from batches b
    where b.id = quality_inspections.batch_id and user_can_access_site(b.site_id)));
alter policy quality_inspections_insert on quality_inspections
  with check (exists (
    select 1 from batches b
    where b.id = quality_inspections.batch_id and user_can_access_site(b.site_id)));

alter policy inventory_ledger_select on inventory_ledger
  using (exists (
    select 1 from batch_lines bl join batches b on b.id = bl.batch_id
    where bl.id = inventory_ledger.batch_line_id and user_can_access_site(b.site_id)));

alter policy mortality_events_select on mortality_events
  using (exists (
    select 1 from batch_lines bl join batches b on b.id = bl.batch_id
    where bl.id = mortality_events.batch_line_id and user_can_access_site(b.site_id)));
alter policy mortality_events_insert on mortality_events
  with check (exists (
    select 1 from batch_lines bl join batches b on b.id = bl.batch_id
    where bl.id = mortality_events.batch_line_id and user_can_access_site(b.site_id)));

alter policy delivery_allocations_select on delivery_allocations
  using (exists (
    select 1 from deliveries d
    where d.id = delivery_allocations.delivery_id and user_can_access_site(d.site_id)));
alter policy delivery_allocations_insert on delivery_allocations
  with check (exists (
    select 1 from deliveries d
    where d.id = delivery_allocations.delivery_id and user_can_access_site(d.site_id)));

alter policy settlements_select on settlements
  using (exists (
    select 1 from deliveries d
    where d.id = settlements.delivery_id and user_can_access_site(d.site_id)));
alter policy settlements_insert on settlements
  with check (exists (
    select 1 from deliveries d
    where d.id = settlements.delivery_id and user_can_access_site(d.site_id)));

-- ------------------------- handover (lintas site) ----------------------------
-- Boleh melihat kalau punya akses ke site asal ATAU tujuan; boleh membuat kalau
-- punya akses ke site asal (yang menyerahkan stok).
alter policy handovers_select on handovers
  using (user_can_access_site(from_site_id) or user_can_access_site(to_site_id));
alter policy handovers_insert on handovers
  with check (user_can_access_site(from_site_id));

alter policy handover_lines_select on handover_lines
  using (exists (
    select 1 from handovers h
    where h.id = handover_lines.handover_id
      and (user_can_access_site(h.from_site_id) or user_can_access_site(h.to_site_id))));
alter policy handover_lines_insert on handover_lines
  with check (exists (
    select 1 from handovers h
    where h.id = handover_lines.handover_id and user_can_access_site(h.from_site_id)));
