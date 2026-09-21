-- =============================================================================
-- Lobster SC OS (Ernawa) — RPC Koreksi Ledger via Reversal
-- =============================================================================
-- Membuat koreksi ledger bisa dilakukan dari aplikasi (sebelumnya harus SQL
-- manual). Sesuai CLAUDE.md #3: TIDAK ada UPDATE/DELETE — koreksi = baris baru
-- (movement_type 'adjustment', qty berlawanan tanda) dengan reversal_of
-- menunjuk ke baris asal.
--
-- SECURITY INVOKER (bukan DEFINER): inventory_ledger_insert dan
-- audit_log_insert (0003) sudah owner-only, jadi function ini otomatis
-- owner-only lewat RLS tanpa pengecekan role manual dan tanpa celah privilege
-- baru. Diuji harus ditolak untuk lead_lapangan/staf_lapangan.
--
-- ATURAN:
--   * Alasan wajib (tidak boleh kosong) dan dicatat di audit_log
--     (action 'reversal', new_data berisi reason + baris asal).
--   * Hanya baris movement_type 'receive' dan 'mortality' yang boleh
--     dikoreksi di sini. Baris 'delivery' SENGAJA ditolak: membalik ledger
--     tanpa membalik delivery_allocations akan membuat keduanya tidak
--     sinkron; koreksi delivery butuh alur sendiri.
--   * Baris yang sendiri adalah reversal, atau yang sudah pernah dikoreksi,
--     ditolak (tidak ada rantai/ganda).
--   * Koreksi ditolak kalau saldo batch_line hasilnya akan negatif (mis.
--     receive yang stoknya sudah terpakai alokasi).
--   * Advisory lock per batch_line — kunci SAMA dengan alokasi (0013) dan
--     guard mortalitas (0014) — supaya konkuren-safe.
--
-- Migration ini HANYA CREATE OR REPLACE FUNCTION (function baru). Tidak ada
-- DROP/ALTER/DELETE. Mengembalikan id baris reversal.
-- =============================================================================

create or replace function create_ledger_reversal(
  p_ledger_id uuid,
  p_reason text
)
returns uuid
language plpgsql
as $$
declare
  v_orig inventory_ledger%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_balance numeric;
  v_new_id uuid;
begin
  if v_reason = '' then
    raise exception 'Alasan koreksi wajib diisi.';
  end if;

  select * into v_orig from inventory_ledger where id = p_ledger_id;
  if not found then
    raise exception 'Baris ledger % tidak ditemukan.', p_ledger_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('batch_line:' || v_orig.batch_line_id::text, 0));

  if v_orig.reversal_of is not null then
    raise exception 'Baris ini sendiri adalah reversal dan tidak bisa dikoreksi lagi.';
  end if;

  if v_orig.movement_type not in ('receive', 'mortality') then
    raise exception 'Baris bertipe % tidak bisa dikoreksi di sini (hanya receive dan mortality).', v_orig.movement_type;
  end if;

  if exists (select 1 from inventory_ledger where reversal_of = v_orig.id) then
    raise exception 'Baris ini sudah pernah dikoreksi.';
  end if;

  select coalesce(sum(qty_kg), 0) into v_balance
  from inventory_ledger
  where batch_line_id = v_orig.batch_line_id;

  if v_balance - v_orig.qty_kg < 0 then
    raise exception
      'Koreksi ditolak: saldo batch_line % akan menjadi negatif (saldo % kg, koreksi %).',
      v_orig.batch_line_id, v_balance, -v_orig.qty_kg;
  end if;

  insert into inventory_ledger (
    batch_line_id, movement_type, qty_kg, event_at,
    ref_type, ref_id, reversal_of, user_id, client_id
  ) values (
    v_orig.batch_line_id, 'adjustment', -v_orig.qty_kg, now(),
    'inventory_ledger', v_orig.id, v_orig.id, auth.uid(), gen_random_uuid()
  )
  returning id into v_new_id;

  insert into audit_log (table_name, row_id, action, old_data, new_data, changed_by)
  values (
    'inventory_ledger', v_new_id, 'reversal', to_jsonb(v_orig),
    jsonb_build_object('reason', v_reason, 'reversal_of', v_orig.id, 'qty_kg', -v_orig.qty_kg),
    auth.uid()
  );

  return v_new_id;
end;
$$;
