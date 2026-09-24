import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export interface Profile {
  full_name: string;
  role: string | null;
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  profileLoading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  profile: null,
  profileLoading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Profil (full_name, role) di-fetch sekali di sini, dipakai bersama oleh
  // TopNavbar dan halaman manapun yang butuh cek role (mis. SourcePage
  // untuk menyembunyikan tombol Edit selain owner) — hindari duplikasi
  // query users di banyak komponen.
  useEffect(() => {
    let active = true;
    const userId = session?.user.id;

    if (!userId) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    supabase
      .from('users')
      .select('full_name, role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) {
          setProfile(data as Profile | null);
          setProfileLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [session?.user.id]);

  return (
    <AuthContext.Provider value={{ session, loading, profile, profileLoading }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
