import { sb } from '../lib/supabase.js';
import { readLocal, writeLocal } from '../lib/storage.js';
import { normalizeProgress } from '../domain/learning.js';

// Learning progress is per person, in user_settings.learning (own row only,
// by RLS), so it follows the person between phone and computer. A copy is
// kept on the device in case the server is not reachable.
const localKey = (userId) => 'learning:' + userId;

export async function loadProgress(userId) {
  const local = normalizeProgress(safeParse(readLocal(localKey(userId), '')));
  try {
    const { data, error } = await sb.from('user_settings').select('learning').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    const remote = normalizeProgress(data && data.learning);
    // Merge: a lesson done on any device counts.
    const merged = normalizeProgress({ done: { ...local.done, ...remote.done }, answers: { ...local.answers, ...remote.answers } });
    writeLocal(localKey(userId), JSON.stringify(merged));
    return merged;
  } catch (_err) {
    return local;
  }
}

export async function saveProgress(userId, householdId, progress) {
  writeLocal(localKey(userId), JSON.stringify(progress));
  const { error } = await sb.from('user_settings').upsert({ user_id: userId, household_id: householdId, learning: progress, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}

function safeParse(s) {
  try { return s ? JSON.parse(s) : null; } catch (_err) { return null; }
}
