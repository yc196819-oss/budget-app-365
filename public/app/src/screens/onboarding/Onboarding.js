import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { createHousehold } from '../../data/onboarding.js';
import { firstPicture } from '../../domain/onboarding.js';
import { setAiEnabled } from '../../lib/settings.js';
import { StepWho, StepLife, StepCards, StepMoney, StepPrivacy } from './Steps.js';
import { DoneScreen } from './DoneScreen.js';

const STEPS = ['מי אתם?', 'מה רלוונטי לכם?', 'איך אתם משלמים?', 'כמה נכנס וכמה קבוע?', 'פרטיות'];
const INITIAL = { name: '', mode: 'together', partner: '', life: { car: true, subs: true }, cards: [{ name: 'ויזה', last4: '', day: 10, type: 'credit' }], income: '', fixed: {}, saving: 0, ai: true };

// A new user: welcome, five short steps, then a summary with what to do first.
// Every step after the first can be skipped; everything can be changed later.
export function Onboarding({ session }) {
  const meta = session.user.user_metadata || {};
  const [stage, setStage] = useState('welcome'); // welcome | setup | saving | done
  const [step, setStep] = useState(1);
  const [a, setA] = useState(() => ({ ...INITIAL, name: meta.display_name || (meta.full_name || meta.name || '').split(' ')[0] || '' }));
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const set = (patch) => setA((cur) => ({ ...cur, ...patch }));
  const canNext = step !== 1 || a.name.trim();

  const finish = async () => {
    setStage('saving'); setError('');
    try {
      setAiEnabled(a.ai);
      const membership = await createHousehold(session.user, a);
      setCreated(membership);
      setStage('done');
    } catch (err) {
      setError('לא הצלחנו לשמור. בדקו את החיבור ונסו שוב. (' + (err.message || err) + ')');
      setStage('setup');
    }
  };
  const next = () => { if (!canNext) return; if (step === 5) finish(); else setStep(step + 1); };

  if (stage === 'welcome') {
    return html`<main class="login onb">
      <div class="brand-login"><img class="brand-mark" src="/icon.svg" alt="" /><b class="display" style="font-size:22px">התקציב שלנו</b></div>
      <h1 class="display" style="font-size:34px;line-height:1.15;margin:0">לדעת בכל רגע כמה נשאר להוציא</h1>
      <div class="stack" style="gap:10px">
        ${[['⚡', 'כל הוצאה במקום אחד', 'הקלדה מהירה או העלאת פירוט מחברת האשראי'], ['✨', 'יועץ שמכיר את המספרים', 'תשובות קצרות, מחושבות מהנתונים שלכם'], ['👥', 'ביחד עם בן/בת הזוג', 'תקציב אחד, שני טלפונים']].map(([i, t, d]) => html`<div class="card onb-perk"><span aria-hidden="true">${i}</span><span><b>${t}</b><small>${d}</small></span></div>`)}
      </div>
      <button type="button" class="btn" onClick=${() => setStage('setup')}>מתחילים · 2 דקות</button>
      <button type="button" class="btn-text" onClick=${session.signOut}>זה לא החשבון שלי, להתנתק</button>
    </main>`;
  }
  if (stage === 'done') return html`<${DoneScreen} answers=${a} membership=${created} session=${session} />`;

  const pic = firstPicture(a);
  return html`<main class="login onb">
    <div class="onb-head">
      <span class="muted" style="font-size:13px;font-weight:700">שלב ${step} מתוך 5</span>
      <div class="onb-bars" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => html`<span class=${i <= step ? 'on' : ''}></span>`)}</div>
      <h1 class="display" style="font-size:30px;margin:4px 0 0">${STEPS[step - 1]}</h1>
    </div>
    <div class="stack onb-body">
      ${step === 1 && html`<${StepWho} a=${a} set=${set} />`}
      ${step === 2 && html`<${StepLife} a=${a} set=${set} />`}
      ${step === 3 && html`<${StepCards} a=${a} set=${set} />`}
      ${step === 4 && html`<${StepMoney} a=${a} set=${set} pic=${pic} />`}
      ${step === 5 && html`<${StepPrivacy} a=${a} set=${set} />`}
    </div>
    ${error && html`<p class="error" role="alert">${error}</p>`}
    <div class="onb-nav">
      <button type="button" class="btn btn-ghost" disabled=${stage === 'saving'} onClick=${() => (step === 1 ? setStage('welcome') : setStep(step - 1))}>חזרה</button>
      ${step >= 2 && step <= 4 && html`<button type="button" class="btn-text" disabled=${stage === 'saving'} onClick=${() => setStep(step + 1)}>דילוג</button>`}
      <button type="button" class="btn" disabled=${!canNext || stage === 'saving'} onClick=${next}>${stage === 'saving' ? 'מכינים…' : step === 5 ? 'סיום' : 'המשך'}</button>
    </div>
  </main>`;
}
