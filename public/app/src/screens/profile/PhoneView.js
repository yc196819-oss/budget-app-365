import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { captureStatus, newCaptureKey, stopCaptureKey, captureUrl } from '../../data/capture.js';
import { showToast } from '../../lib/toast.js';

// Exactly as the notification said it, agorot included.
const amountText = (p) => {
  if (!p || p.amount == null) return '?';
  const n = Number(p.amount).toLocaleString('he-IL', { minimumFractionDigits: Number.isInteger(p.amount) ? 0 : 2, maximumFractionDigits: 2 });
  return !p.currency || p.currency === 'ILS' ? '₪' + n : n + ' ' + p.currency;
};

const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) + ' ' + d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
};

function Copy({ label, value }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 2000); } catch (_e) { showToast('לא הצלחנו להעתיק. סמנו את הטקסט והעתיקו ידנית.'); }
  };
  return html`<div class="stack" style="gap:6px">
    <span class="muted" style="font-size:13px">${label}</span>
    <div class="phone-copy">
      <code dir="ltr">${value}</code>
      <button type="button" class="btn btn-ghost" style="flex:none" onClick=${copy}>${done ? 'הועתק' : 'להעתיק'}</button>
    </div>
  </div>`;
}

// "Payments from the phone": a personal key for an automation app
// (MacroDroid) that forwards each Google Wallet notification. For now the
// notifications are only kept, so we can see their exact words; no
// transaction is made from them yet.
export function PhoneView({ hid, onBack }) {
  const [st, setSt] = useState(null);
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);

  const load = () => captureStatus(hid).then((s) => { setSt(s); setFailed(false); }).catch(() => setFailed(true));
  useEffect(() => { load(); }, [hid]);

  const make = async () => {
    setBusy(true);
    try { setKey(await newCaptureKey(hid)); await load(); } catch (_e) { showToast('לא הצלחנו ליצור קוד. נסו שוב.'); }
    setBusy(false);
  };
  const stop = async () => {
    if (!sure) { setSure(true); return; }
    setBusy(true);
    try { await stopCaptureKey(hid); setKey(''); setSure(false); await load(); showToast('הקוד בוטל. הטלפון לא יוכל לשלוח יותר.'); } catch (_e) { showToast('הביטול לא הצליח. נסו שוב.'); }
    setBusy(false);
  };

  const active = st && st.key;
  return html`<div class="stack phone-capture">
    <button type="button" class="btn-text" style="align-self:flex-start" onClick=${onBack}>→ חזרה</button>
    <span class="muted" style="font-size:13px;line-height:1.6">כל תשלום ב-Google Wallet בטלפון שלך יגיע לכאן מעצמו. בשלב הראשון ההתראות רק נשמרות, כדי שנראה שהן נקראות נכון. תנועות ייווצרו מהן בשלב הבא.</span>

    ${st === null && !failed && html`<div class="skel-row"><span class="skel" style="width:70%"></span><span class="skel" style="width:50%"></span></div>`}
    ${failed && html`<span class="muted">לא הצלחנו לטעון. <button type="button" class="btn-text" onClick=${load}>לנסות שוב</button></span>`}

    ${st && html`<div class="card stack">
      <div class="row" style="gap:8px;align-items:center">
        <b style="flex:1">הטלפון שלך</b>
        <span class="badge" style=${active ? '--tone:var(--income)' : ''}>${active ? 'מחובר' : 'לא מחובר'}</span>
      </div>
      ${active && html`<span class="muted" style="font-size:13px">${active.last_used_at ? 'ההתראה האחרונה הגיעה ב-' + when(active.last_used_at) : 'עוד לא הגיעה התראה מהטלפון.'}</span>`}
      ${key && html`<div class="stack phone-key" role="region" aria-label="הקוד החדש">
        <b>הקוד מוצג רק עכשיו. העתיקו אותו ל-MacroDroid.</b>
        <${Copy} label="כתובת (URL)" value=${captureUrl()} />
        <${Copy} label="כותרת Authorization" value=${'Bearer ' + key} />
      </div>`}
      <button type="button" class=${active ? 'btn btn-ghost' : 'btn'} disabled=${busy} onClick=${make}>${active ? 'ליצור קוד חדש (הקודם יפסיק לעבוד)' : 'ליצור קוד לטלפון'}</button>
      ${active && html`<button type="button" class="btn-text" style="color:var(--danger);align-self:flex-start" disabled=${busy} onClick=${stop}>${sure ? 'בטוח? הטלפון יפסיק לשלוח' : 'לבטל את הקוד'}</button>`}
    </div>`}

    <details class="card phone-how" open=${!active || !!key}>
      <summary><b>איך מגדירים את MacroDroid</b></summary>
      <ol>
        <li>מתקינים את <b>MacroDroid</b> מ-Google Play (חינם) ופותחים.</li>
        <li>לוחצים <b>הוספת מאקרו</b>. בטריגר בוחרים <b>התראה ← התראה התקבלה</b>, ובאפליקציה בוחרים <b>Google Wallet</b>. מאשרים ל-MacroDroid גישה להתראות.</li>
        <li>בפעולה בוחרים <b>בקשת HTTP</b>. שיטה: <b>POST</b>. בכתובת מדביקים את הכתובת שלמעלה.</li>
        <li>בכותרות (Headers) מוסיפים <b dir="ltr">Authorization</b> ומדביקים את הערך שלמעלה.</li>
        <li>בגוף הבקשה (Body) בוחרים <b dir="ltr">text/plain</b> וכותבים בשתי שורות: <code dir="ltr">[notification_title]</code> ובשורה מתחת <code dir="ltr">[notification]</code>.</li>
        <li>שומרים. מהתשלום הבא ההתראה תופיע כאן למטה.</li>
      </ol>
    </details>

    ${st && st.recent.length > 0 && html`<div class="card stack" role="region" aria-label="מה הגיע לאחרונה">
      <b>מה הגיע לאחרונה</b>
      ${st.recent.map((n) => html`<div class="phone-note" key=${n.id}>
        <div class="row" style="gap:8px">
          <b style="flex:1;min-width:0">${(n.parsed && n.parsed.merchant) || n.title || 'בלי שם עסק'}</b>
          <span class="num">${amountText(n.parsed)}</span>
        </div>
        <span class="muted" style="font-size:12px">${when(n.received_at)}${n.parsed && n.parsed.last4 ? ' · כרטיס ' + n.parsed.last4 : ''} · נשמרה, עוד בלי תנועה</span>
        <span class="muted phone-raw" dir="auto">${[n.title, n.body].filter(Boolean).join(' · ')}</span>
      </div>`)}
    </div>`}
  </div>`;
}
