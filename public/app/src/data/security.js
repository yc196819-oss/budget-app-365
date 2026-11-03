import { sb } from '../lib/supabase.js';
import { api } from '../lib/api.js';
import { cleanCode } from '../domain/security.js';
export { cleanCode, deviceName } from '../domain/security.js';

// Two-step login. Each person picks how: a code from an authenticator app
// (Supabase's own TOTP), or a code sent by email (our server). The database
// lets the data through only once this sign-in passed one of them.

// { totp, email, required, ok }, or null when it could not be checked.
export async function mfaState() {
  const { data, error } = await sb.rpc('my_mfa_state');
  if (error || !data || Array.isArray(data) || typeof data !== 'object') return null;
  return data;
}

async function factors() {
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) throw error;
  return data || { all: [], totp: [] };
}

// The verified authenticator apps.
export async function totpApps() {
  const f = await factors();
  return (f.totp || []).filter((x) => x.status === 'verified');
}

// Starts adding an app: returns the QR picture and the key to type by hand.
// An unfinished earlier attempt is cleared first.
export async function startTotp() {
  const f = await factors();
  for (const x of f.all || []) {
    if (x.factor_type === 'totp' && x.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: x.id });
  }
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'אפליקציית קודים ' + new Date().toISOString().slice(0, 16) });
  if (error) throw error;
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function confirmTotp(factorId, code) {
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: cleanCode(code) });
  if (error) throw new Error('הקוד לא נכון. נסו את הקוד שמופיע עכשיו באפליקציה.');
}

// At sign-in: the code from the app.
export async function passTotp(code) {
  const [app] = await totpApps();
  if (!app) throw new Error('לא נמצאה אפליקציית קודים בחשבון.');
  return confirmTotp(app.id, code);
}

export async function removeTotp(factorId) {
  const { error } = await sb.auth.mfa.unenroll({ factorId });
  if (error) throw new Error('לא הצלחנו לכבות. אם נכנסתם עם קוד במייל, היכנסו פעם אחת עם קוד מהאפליקציה ונסו שוב.');
}

// By email (through our server).
export const emailStatus = () => api('/api/2fa/status');
export const sendEmailCode = (purpose = 'login') => api('/api/2fa/email/send', { method: 'POST', body: { purpose } });
export const passEmail = (code) => api('/api/2fa/email/verify', { method: 'POST', body: { code: cleanCode(code) } });
export const enableEmail = (code) => api('/api/2fa/email/enable', { method: 'POST', body: { code: cleanCode(code) } });
export const disableEmail = () => api('/api/2fa/email/disable', { method: 'POST' });

// Where this account is signed in.
export async function mySessions() {
  const { data, error } = await sb.rpc('my_sessions');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}
export async function signOutOthers() {
  const { error } = await sb.auth.signOut({ scope: 'others' });
  if (error) throw error;
}
