import { useEffect, useState } from 'preact/hooks';
import { sb } from '../lib/supabase.js';
import { clearSensitiveLocal } from '../lib/storage.js';

// Session + the household the user belongs to. The session is shared with
// the current app (same origin, same Supabase storage key), so whoever is
// logged in there is logged in here too.
export function useSession() {
  const [state, setState] = useState({ loading: true, user: null, household: null });

  useEffect(() => {
    let alive = true;
    const load = async (session) => {
      const user = session?.user || null;
      if (!user) { if (alive) setState({ loading: false, user: null, household: null }); return; }
      const { data } = await sb.from('memberships')
        .select('household_id,display_name,role')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1);
      if (alive) setState({ loading: false, user, household: data && data[0] ? data[0] : null });
    };
    sb.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => load(session));
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  const signOut = async () => {
    clearSensitiveLocal();
    setState({ loading: false, user: null, household: null });
    try { await sb.auth.signOut(); } catch (_err) { /* the local state is already cleared */ }
  };

  return { ...state, signOut };
}
