import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY belum diset di .env.local');
}

// Hanya anon key yang boleh ada di sini (client-side). service_role key
// TIDAK PERNAH boleh dipakai di kode frontend — lihat CLAUDE.md aturan #5.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
