// Mounts the live auth session into the store's transient cloudUser (Task 3 —
// packages/editor-state/src/slices/cloudSlice.ts). No-ops entirely when the env isn't configured,
// so a self-hosted build with no Supabase project pays zero runtime cost (no network call, no
// dynamic import of supabase-js).
import { useEffect } from 'react';
import { useEditor } from '../store/store';
import { cloudConfig } from './env';
import { getSupabase } from './supabaseCloudStore';

export function useCloudSession(): void {
  useEffect(() => {
    if (cloudConfig() === null) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    void getSupabase().then((client) => {
      if (cancelled) return;
      void client.auth.getSession().then(({ data }) => {
        if (cancelled) return;
        const user = data.session?.user;
        useEditor.getState().setCloudUser(user ? { id: user.id, email: user.email ?? null } : null);
      });
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        useEditor.getState().setCloudUser(user ? { id: user.id, email: user.email ?? null } : null);
      });
      unsubscribe = () => data.subscription.unsubscribe();
      if (cancelled) unsubscribe();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
}
