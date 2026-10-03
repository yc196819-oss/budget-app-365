import { useEffect, useState } from 'preact/hooks';
import { sb } from '../lib/supabase.js';
import { clearSensitiveLocal, readCache, writeCache } from '../lib/storage.js';

// Session + the household the user belongs to. The session is shared with
// the current app (same origin, same Supabase storage key), so whoever is
// logged in there is logged in here too.
export function useSession() {
  const [state, setState] = useState({ loading: true, user: null, household: null });

  const [tick, setTick] = useState(0);
  // Arrived from a password-reset email: ask for a new password first.
  const [recovery, setRecovery] = useState(() => /type=recovery/.test(location.hash));
  useEffect(() => {
    let alive = true;
    const load = async (session) => {
      const user = session?.user || null;
      if (!user) { if (alive) setState({ loading: false, user: null, household: null }); return; }
      // The household seen last time on this device: the app opens with it at
      // once, and the check below confirms or corrects it.
      const cached = readCache('member:' + user.id);
      if (cached && alive) setState({ loading: false, user, household: cached.data });
      const { data, error } = await sb.from('memberships')
        .select('household_id,display_name,role')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1);
      if (!alive) return;
      // A failed check (weak connection) must not look like "no household".
      if (error) { if (!cached) setState({ loading: false, user, household: null, offline: true }); return; }
      const household = data && data[0] ? data[0] : null;
      if (household) writeCache('member:' + user.id, household);
      setState({ loading: false, user, household });
    };
    sb.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      load(session);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [tick]);

  const signOut = async () => {
    clearSensitiveLocal();
    setState({ loading: false, user: null, household: null });
    try { await sb.auth.signOut(); } catch (_err) { /* the local state is already cleared */ }
  };

  // After creating or joining a household.
  const refresh = () => setTick((t) => t + 1);

  return { ...state, signOut, refresh, recovery, doneRecovery: () => setRecovery(false) };
}
