import { html } from '../../lib/html.js';
import { LIFE, FIXED, categoriesFor } from '../../domain/onboarding.js';
import { money } from '../../domain/format.js';

const digits = (v) => String(v || '').replace(/[^\d]/g, '');

export function StepWho({ a, set }) {
  return html`
    <label class="field"><span>איך לקרוא לכם?</span>
      <input class="input" value=${a.name} onInput=${(e) => set({ name: e.target.value })} placeholder="השם הפרטי" autocomplete="given-name" /></label>
    <span class="field-label">מנהלים את התקציב</span>
    <div class="seg" role="group" aria-label="מנהלים את התקציב">
      <button type="button" aria-pressed=${String(a.mode === 'solo')} onClick=${() => set({ mode: 'solo' })}>לבד</button>
      <button type="button" aria-pressed=${String(a.mode === 'together')} onClick=${() => set({ mode: 'together' })}>ביחד</button>
    </div>
    ${a.mode === 'together' && html`<label class="field rise"><span>השם של בן/בת הזוג</span>
      <input class="input" value=${a.partner} onInput=${(e) => set({ partner: e.target.value })} placeholder="נשלח הזמנה בסוף" /></label>`}`;
}

export function StepLife({ a, set }) {
  const cats = categoriesFor(a.life);
  return html`
    <span class="muted" style="line-height:1.55">סמנו מה קיים אצלכם, ונבנה קטגוריות שמתאימות. אוכל, בית, בריאות ופנאי יש לכולם.</span>
    <div class="chips" role="group" aria-label="מה רלוונטי">
      ${LIFE.map((l) => html`<button type="button" class="chip" aria-pressed=${String(!!a.life[l.key])} onClick=${() => set({ life: { ...a.life, [l.key]: !a.life[l.key] } })}>${l.label}</button>`)}
    </div>
    <div class="card stack" style="gap:8px">
      <b>${cats.length} קטגוריות, ואפשר לשנות בכל רגע</b>
      <div class="chips">${cats.map((c) => html`<span class="chip" style="cursor:default">${c.icon} ${c.name}</span>`)}</div>
    </div>`;
}

export function StepCards({ a, set }) {
  const setCard = (i, patch) => set({ cards: a.cards.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  return html`
    <span class="muted" style="line-height:1.55">ככה נדע מתי לבקש מכם את הפירוט של כל כרטיס. בלי סיסמאות ובלי חיבור לבנק.</span>
    ${a.cards.map((c, i) => html`<div class="card stack" style="gap:10px" key=${i}>
      <div class="seg" role="group" aria-label="סוג כרטיס">
        <button type="button" aria-pressed=${String(c.type !== 'direct')} onClick=${() => setCard(i, { type: 'credit' })}>אשראי רגיל</button>
        <button type="button" aria-pressed=${String(c.type === 'direct')} onClick=${() => setCard(i, { type: 'direct' })}>חיוב מיידי</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 110px;gap:8px">
        <input class="input" value=${c.name} onInput=${(e) => setCard(i, { name: e.target.value })} placeholder="שם הכרטיס" aria-label="שם הכרטיס" />
        <input class="input num" value=${c.last4} onInput=${(e) => setCard(i, { last4: digits(e.target.value).slice(0, 4) })} placeholder="4 ספרות" inputmode="numeric" aria-label="4 ספרות אחרונות" />
      </div>
      ${c.type !== 'direct' && html`<span class="field-label">יום החיוב</span>
        <div class="chips" role="group" aria-label="יום החיוב">${[2, 10, 15, 20].map((d) => html`<button type="button" class="chip" aria-pressed=${String(c.day === d)} onClick=${() => setCard(i, { day: d })}>ה-${d}</button>`)}</div>`}
      <span class="faint" style="font-size:13px">${c.type === 'direct' ? 'חיוב מיידי יורד מהחשבון תוך יום-יומיים.' : 'ב-' + c.day + ' לחודש נזכיר להעלות את הפירוט. עד אז נציג הערכה.'}</span>
      ${a.cards.length > 1 && html`<button type="button" class="btn-text" style="align-self:flex-start;color:var(--danger)" onClick=${() => set({ cards: a.cards.filter((_, k) => k !== i) })}>להסיר</button>`}
    </div>`)}
    <button type="button" class="btn btn-dashed" onClick=${() => set({ cards: [...a.cards, { name: '', last4: '', day: 2, type: 'credit' }] })}>+ עוד כרטיס</button>`;
}

export function StepMoney({ a, set, pic }) {
  const setFixed = (k, v) => set({ fixed: { ...a.fixed, [k]: v } });
  const shown = FIXED.filter((f) => f.key !== 'kindergarten' || a.life.kids);
  return html`
    <label class="field"><span>כמה נכנס לחשבון בחודש, נטו? (כל משק הבית)</span>
      <input class="input num" value=${a.income} onInput=${(e) => set({ income: digits(e.target.value) })} inputmode="numeric" placeholder="₪ סכום" aria-label="הכנסה חודשית נטו" /></label>
    <div class="chips">${[10000, 15000, 20000, 25000].map((x) => html`<button type="button" class="chip" onClick=${() => set({ income: String(x) })}>${money(x)}</button>`)}</div>
    <span class="field-label">הוצאות קבועות בחודש (מה שידוע, בערך)</span>
    <div class="list">${shown.map((f) => html`<label class="row onb-fixed"><span class="row-main"><b>${f.label}</b></span>
      <input class="input num" value=${a.fixed[f.key] || ''} onInput=${(e) => setFixed(f.key, digits(e.target.value))} inputmode="numeric" placeholder="₪" aria-label=${f.label} /></label>`)}</div>
    <span class="field-label">כמה לשים בצד כל חודש?</span>
    <div class="chips" role="group" aria-label="חיסכון חודשי">
      ${[[500, '₪500'], [1000, '₪1,000'], [2000, '₪2,000'], [0, 'עוד לא יודעים']].map(([v, l]) => html`<button type="button" class="chip" aria-pressed=${String(a.saving === v)} onClick=${() => set({ saving: v })}>${l}</button>`)}
    </div>
    ${pic.income > 0 && html`<div class="card stack rise" style="gap:8px">
      <span style="display:flex;justify-content:space-between"><span>נשאר למחיה בחודש</span><b class="num" style=${'color:' + (pic.left < 0 ? 'var(--danger)' : 'var(--income)')}>${(pic.left < 0 ? '−' : '') + money(pic.left)}</b></span>
      <span class="muted" style="font-size:13px">${pic.left > 0 ? 'כ-' + money(pic.perDay) + ' ליום לסופר, אוכל, דלק וכל השאר' : 'ההוצאות הקבועות והחיסכון גבוהים מההכנסה. נבנה יחד תוכנית במסך התוכניות.'}</span>
    </div>`}`;
}

export function StepPrivacy({ a, set }) {
  return html`
    <label class="card check toggle-row" style="align-items:flex-start">
      <span style="flex:1;display:flex;flex-direction:column;gap:4px"><b>יועץ AI</b>
        <span class="muted" style="font-size:13px;line-height:1.55">כשהיועץ פעיל ושואלים אותו, נשלח סיכום של סכומים לפי קטגוריה וחודש. לא שמות בתי עסק, לא מספרי חשבון או כרטיס. אפשר לכבות אותו לגמרי, וכל השאר ימשיך לעבוד.</span></span>
      <input type="checkbox" role="switch" checked=${a.ai} onChange=${(e) => set({ ai: e.target.checked })} aria-label="יועץ AI" />
    </label>
    <span class="faint" style="font-size:13px;line-height:1.55">אפשר לשנות את זה בכל רגע בפרופיל.</span>`;
}
