-- Target margin (PRD-MASTER §16/§18 Open Question #5: "Definisi final
-- gm_target_pct 30%... harus konsisten di semua layar"). Dikonfirmasi user:
-- margin PER TRANSAKSI (bukan ROI turnover modal), dan angkanya HARUS bisa
-- diubah owner sendiri -- BUKAN di-hardcode 30% di kode, konsisten dengan
-- pola product_holding_policy (migration 0032): ambang/target sebaiknya
-- selalu configuration data yang bisa diubah tanpa deploy baru, bukan angka
-- mati di source.
--
-- Per TRACK (bukan satu angka global) -- FinancePage sudah memisah panel
-- Trading/Budidaya (CLAUDE.md #1), jadi target-nya ikut terpisah supaya
-- konsisten dan siap dipakai begitu budidaya mulai beroperasi dengan target
-- yang mungkin berbeda dari trading.

create table finance_targets (
  track text primary key check (track in ('trading', 'budidaya')),
  margin_target_pct numeric not null check (margin_target_pct > 0 and margin_target_pct <= 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id)
);

alter table finance_targets enable row level security;

create policy finance_targets_select on finance_targets for select
using (auth_user_role() in ('owner', 'lead_lapangan', 'staf_lapangan', 'investor'));

create policy finance_targets_insert on finance_targets for insert
with check (auth_user_role() = 'owner');

create policy finance_targets_update on finance_targets for update
using (auth_user_role() = 'owner')
with check (auth_user_role() = 'owner');
