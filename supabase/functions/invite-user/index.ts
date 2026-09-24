// Edge Function: invite-user (PRD B1).
//
// Owner membuat akun baru dari aplikasi. service_role key TIDAK ada di kode ini
// maupun di repo — Supabase menyuntikkannya sebagai env var saat runtime
// (SUPABASE_SERVICE_ROLE_KEY), dan hanya dipakai di sini, di sisi server
// (CLAUDE.md #5). Pemanggil WAJIB owner: role dibaca lewat JWT pemanggil sendiri
// (RPC auth_user_role) SEBELUM service_role dipakai untuk apa pun.
//
// Alur: validasi -> buat akun auth (email langsung terkonfirmasi, katasandi
// sementara acak) -> insert public.users -> insert user_sites -> audit_log.
// Kalau langkah setelah pembuatan akun gagal, akun auth dihapus (users &
// user_sites ikut terhapus lewat ON DELETE CASCADE) supaya tidak ada akun yatim.
// Katasandi sementara hanya dikembalikan SEKALI di respons dan tidak pernah
// ditulis ke log/DB.
//
// `owner` termasuk role yang boleh diundang lewat sini (bukan cuma
// lead_lapangan/staf_lapangan/investor) — tidak ada batas jumlah akun Owner.
// Ini BUKAN celah keamanan baru: pemanggil tetap wajib owner (langkah 1 di
// bawah), dan Owner yang sudah ada SUDAH BISA menaikkan role user manapun
// jadi owner lewat dropdown di ManajemenUserPage (RLS `users_update_by_owner`,
// migration 0003) — ini cuma menghapus langkah tambahan (invite-lalu-promote)
// jadi bisa langsung dibuat sebagai owner. `insert public.users` di bawah
// memakai service_role (admin client), yang dikenali trigger
// fn_users_protect_role (migration 0018) sbg trusted — TIDAK terhalang
// pengecekan "hanya owner yang boleh menetapkan role" krn pengecekan itu
// memang untuk jalur PostgREST/aplikasi biasa, bukan service_role.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ROLES = ['owner', 'lead_lapangan', 'staf_lapangan', 'investor'] as const;
type InviteRole = (typeof ROLES)[number];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metode tidak didukung.' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Harus login.' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1. Pastikan pemanggil owner, memakai JWT-nya sendiri (bukan service_role).
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: callerData, error: callerError } = await userClient.auth.getUser();
  if (callerError || !callerData.user) return json({ error: 'Sesi tidak valid.' }, 401);
  const { data: callerRole } = await userClient.rpc('auth_user_role');
  if (callerRole !== 'owner') return json({ error: 'Hanya Owner yang boleh menambah user.' }, 403);

  // 2. Validasi input.
  let payload: { email?: string; full_name?: string; role?: string; site_ids?: string[] };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body harus JSON.' }, 400);
  }
  const email = (payload.email ?? '').trim().toLowerCase();
  const fullName = (payload.full_name ?? '').trim();
  const role = payload.role as InviteRole;
  const siteIds = Array.isArray(payload.site_ids) ? payload.site_ids : [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Format email tidak valid.' }, 400);
  if (!fullName) return json({ error: 'Nama wajib diisi.' }, 400);
  if (!ROLES.includes(role)) return json({ error: 'Role harus owner, lead_lapangan, staf_lapangan, atau investor.' }, 400);
  if (siteIds.some((id) => typeof id !== 'string')) return json({ error: 'site_ids tidak valid.' }, 400);

  // 3. Buat akun (service_role dipakai mulai di sini).
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = tempPassword();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created.user) {
    const already = /already|registered|exists/i.test(createError?.message ?? '');
    return json({ error: already ? 'Email sudah terdaftar.' : `Gagal membuat akun: ${createError?.message ?? 'tidak diketahui'}` }, already ? 409 : 500);
  }
  const newId = created.user.id;

  const rollback = async (message: string, status = 500) => {
    await admin.auth.admin.deleteUser(newId);
    return json({ error: message }, status);
  };

  // 4. Profil aplikasi + penugasan site.
  const { error: userInsertError } = await admin.from('users').insert({ id: newId, full_name: fullName, role });
  if (userInsertError) return await rollback(`Gagal menyimpan profil user: ${userInsertError.message}`);

  const assignable = role === 'lead_lapangan' || role === 'staf_lapangan';
  if (assignable && siteIds.length > 0) {
    const { error: siteError } = await admin.from('user_sites').insert(siteIds.map((site_id) => ({ user_id: newId, site_id })));
    if (siteError) return await rollback(`Gagal menugaskan site: ${siteError.message}`);
  }

  // 5. Jejak audit (tanpa katasandi).
  await admin.from('audit_log').insert({
    table_name: 'users',
    row_id: newId,
    action: 'invite',
    new_data: { email, full_name: fullName, role, site_ids: assignable ? siteIds : [] },
    changed_by: callerData.user.id,
  });

  return json({ user_id: newId, email, temp_password: password });
});
