import { html } from '../../lib/html.js';
import { Splash } from '../../components/Splash.js';
import { PictureCard } from '../picture/Picture.js';
import { useEffect, useState } from 'preact/hooks';
import { track } from '../../lib/telemetry.js';
import { monthPlan, cashNow, upcoming, attention, topCategories } from '../../domain/home.js';
import { TxSheet } from '../money/TxSheet.js';
import { Hero } from './Hero.js';
import { HeroSheet } from './HeroSheet.js';
import { CashCard } from './CashCard.js';
import { Attention } from './Attention.js';
import { Upcoming } from './Upcoming.js';
import { WhereMoney } from './WhereMoney.js';
import { LearnCard } from '../learn/LearnCard.js';
import { PlanCards } from '../plans/PlanCards.js';
import { PlanSheets, usePlanSheet } from '../plans/PlanSheets.js';
import { InstallCard } from '../../components/InstallCard.js';
import { TalkToUs } from '../../components/TalkToUs.js';
import { TripFound } from '../trips/TripFound.js';
import { useTrips } from '../../data/useTrips.js';
import { SetupGuide, guideOpen } from './SetupGuide.js';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { go } from '../../lib/go.js';
import { money } from '../../domain/format.js';
import { ImportNotice } from './ImportNotice.js';
import { RepairCard } from './RepairCard.js';
import { AnswerNotice } from './AnswerNotice.js';
import { MonthlyAsk } from './MonthlyAsk.js';
import { removeMany, keepBoth } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { SortSheet } from '../money/SortSheet.js';
import { TransferSheet } from './TransferSheet.js';
import { MoveSheet } from './MoveSheet.js';
import { FixedCheckCard } from './FixedCheck.js';
import { transferDays } from '../../domain/transfers.js';

// The month at a glance: what is left to spend, where the month is heading,
// what needs attention (one action each) and what is coming up.
export function HomeScreen({ data, onAdd, onImport, onPicture, onLearn, onAsk, userId, owner = false }) {
  // One sheet at a time: { kind: 'hero' } | { kind: 'tx', id } | null
  const [sheet, setSheet] = useState(null);
  // Pairs the household said are two real purchases (not a double charge).
  const dupeKey = 'dupe:ok:' + data.hid;
  // Saved for the whole household; this device's own list is kept as well
  // (from before, or while offline).
  const [, setDupeVer] = useState(0);
  let local = [];
  try { local = JSON.parse(readLocal(dupeKey, '[]')); } catch (_e) { local = []; }
  const dupeOk = new Set([...(data.dupeOk || []), ...local]);
  // The holiday plan and the quarterly check-in have their own sheets.
  const planSheet = usePlanSheet();
  // The new, calmer home: for now the owner's (to try before everyone).
  const [layout, setLayoutRaw] = useState(() => readLocal('home:layout', 'new'));
  const setLayout = (v) => { writeLocal('home:layout', v); setLayoutRaw(v); };
  const calm = owner && layout !== 'old';
  const [todo, setTodo] = useState(false);
  const [upOpen, setUpOpen] = useState(false);
  const trips = useTrips(data.hid);
  // The owner's numbers: the first time this person sees a month built from
  // their own data (once per person on this device; nothing else is sent).
  const hasData = data.status === 'ready' && data.txs.length > 0;
  useEffect(() => {
    if (!hasData || !userId || readLocal('fv:' + userId, '')) return;
    writeLocal('fv:' + userId, '1');
    track('first_value');
  }, [hasData, userId]);

  if (data.status === 'loading' || data.status === 'idle') return html`<${Splash} />`;
  if (data.status === 'error') {
    return html`<div class="card empty" role="alert"><b style="color:var(--text)">לא הצלחנו לטעון את הנתונים</b><span>${data.error}</span>
      <button type="button" class="btn btn-ghost" onClick=${data.reload}>לנסות שוב</button></div>`;
  }

  const today = new Date();
  // (The owner's board first: payments still to come this month are spoken for.)
  const plan = monthPlan({ txs: data.txs, budgets: data.budgets, today, smart: owner });
  const catName = (id) => (data.categories.find((c) => c.id === id) || {}).name || '';
  const cash = cashNow(data.accounts, data.cards, data.txs, today);
  const soon = upcoming({ txs: data.txs, cards: data.cards, today });
  // "Complete the picture" (its card, or the ✓ at the top) already says which
  // statement is due: the "card was charged, upload it" notes would repeat it.
  const days = transferDays(readLocal('transfer:days:' + data.hid, '2'));
  const items = attention({ txs: data.txs, categories: data.categories, budgets: data.budgets, cards: onPicture ? [] : data.cards, today, plan, dupeOk, transferDays: days });
  const top = topCategories(data.txs, data.categories, data.budgets, today);

  const act = async (a) => {
    if (a.to === 'dupe-ok') {
      writeLocal(dupeKey, JSON.stringify([...new Set([...local, a.key])]));
      setDupeVer((v) => v + 1);
      try { await keepBoth(a.key); showToast('נשמר: שתי קניות נפרדות. לא נשאל עליהן שוב, גם לא את בן או בת הזוג.'); }
      catch (_e) { showToast('נשמר במכשיר הזה. לא הצלחנו לשמור לכל משק הבית, ננסה שוב בפעם הבאה.'); }
      return;
    }
    if (a.to === 'cardtwice') {
      // Into the recycle bin: they come back from "המידע שלנו" within 30 days.
      try { await removeMany(a.ids); showToast(a.ids.length === 1 ? 'החיוב הכפול הוסר. אפשר לשחזר תוך 30 יום.' : a.ids.length + ' חיובים כפולים הוסרו. אפשר לשחזר תוך 30 יום.'); }
      catch (_e) { showToast('לא הצלחנו להסיר. נסו שוב.'); }
      return;
    }
    if (a.to === 'transfers') { planSheet.close(); setSheet({ kind: 'transfers' }); return; }
    if (a.to === 'ask') { planSheet.close(); setSheet({ kind: 'ask', id: a.id, ask: a.kind }); return; }
    if (a.to === 'import') onImport();
    else if (a.to === 'sort') { planSheet.close(); setSheet({ kind: 'sort' }); }
    else if (a.to === 'tx') { planSheet.close(); setSheet({ kind: 'tx', id: a.id }); }
    else if (a.to === 'money-cats') location.hash = '#/money/cats';
    else location.hash = '#/' + a.to;
  };
  const sheetTx = sheet && sheet.kind === 'tx' ? data.txs.find((t) => t.id === sheet.id) : null;
  const askTx = sheet && sheet.kind === 'ask' ? data.txs.find((t) => t.id === sheet.id) : null;

  const guide = html`<${SetupGuide} data=${data} userId=${userId} onImport=${onImport} onAdd=${onAdd} onAsk=${onAsk || (() => {})} onPicture=${onPicture} />`;
  const switchLink = owner && html`<button type="button" class="btn-text faint home-switch" onClick=${() => setLayout(calm ? 'old' : 'new')}>${calm ? 'למסך הבית הקודם' : 'לנסות את מסך הבית החדש'}</button>`;
  const footer = html`<p class="home-foot muted">משהו לא עובד? יש רעיון? <button type="button" class="btn-text" onClick=${() => go('profile/feedback')}>כתבו לנו</button>${onLearn ? html` · <button type="button" class="btn-text" onClick=${onLearn}>פינת הלמידה</button>` : ''}</p>`;

  // ── the calm home ──
  if (calm && !data.txs.length) {
    // The first day: the statements come first, the number appears after.
    return html`<div class="stack home calm">
      <div class="home-main stack">
      <${AnswerNotice} userId=${userId} />
      <section class="card stack first-day" aria-label="הצעד הראשון">
        <small class="first-day-k">יום ראשון · הצעד הראשון</small>
        <b style="font-size:20px">בואו נכניס את המספרים האמיתיים</b>
        <span class="muted" style="font-size:14px;line-height:1.55">בוחרים בנק וכרטיסים, ומעלים פירוטים של 6 החודשים האחרונים (אקסל, PDF או צילום מסך). דקה או שתיים.</span>
        <button type="button" class="btn" onClick=${onPicture || onImport}>לבחור בנק וכרטיסים ולהעלות</button>
        <button type="button" class="btn btn-ghost" onClick=${onImport}>יש לי כבר קובץ: להעלות עכשיו</button>
        <button type="button" class="btn-text" style="align-self:flex-start" onClick=${onAdd}>או להוסיף הוצאה ידנית / בקול</button>
        <span class="faint" style="font-size:12px;line-height:1.5">אחר כך: לסווג, כמה נכנס בחודש, תקציב. נעבור על זה ביחד, צעד אחרי צעד.</span>
      </section>
      </div>
      <div class="home-side stack">
      <section class="hero hero-empty" aria-label="כמה נשאר החודש">
        <span style="font-weight:700;color:var(--hero-muted)">כמה נשאר החודש</span>
        <span class="display num" style="font-size:40px;line-height:1" aria-hidden="true">—</span>
        <span style="font-size:13px;color:var(--hero-muted)">יופיע כאן אחרי ההעלאה הראשונה</span>
      </section>
      ${footer}
      ${switchLink}
      </div>
    </div>`;
  }
  if (calm) {
    const nextKey = guideOpen(data);
    // What the next step already asks is not asked again below it.
    const calmItems = nextKey === 'sort' ? items.filter((a) => a.kind !== 'loose') : items;
    const moreSheet = todo && html`<${Sheet} title="דברים לסדר" onClose=${() => setTodo(false)}>
      <div class="stack">
        ${onPicture && html`<${PictureCard} data=${data} onOpen=${() => { setTodo(false); onPicture(); }} />`}
        ${guide}
        <${MonthlyAsk} userId=${userId} data=${data} />
        <${FixedCheckCard} data=${data} />
        <${InstallCard} />
      </div>
    <//>`;
    const upSum = soon.reduce((s, u) => s + (u.amount && u.amount < 0 ? -u.amount : 0), 0);
    return html`<div class="stack home calm">
      <div class="home-main stack">
      <${AnswerNotice} userId=${userId} />
      <${RepairCard} data=${data} />
      <${ImportNotice} data=${data} onImport=${onImport} />
      <${Hero} plan=${plan} catName=${catName} onImport=${onImport} onOpen=${() => { planSheet.close(); setSheet({ kind: 'hero' }); }} />
      ${nextKey
        ? html`<${SetupGuide} data=${data} userId=${userId} onImport=${onImport} onAdd=${onAdd} onAsk=${onAsk || (() => {})} onPicture=${onPicture} compact=${true} onMore=${() => setTodo(true)} />`
        : html`<div class="calm-next">${onPicture && html`<${PictureCard} data=${data} onOpen=${onPicture} />`}<button type="button" class="btn-text" style="align-self:flex-end" onClick=${() => setTodo(true)}>עוד דברים לסדר ›</button></div>`}
      <${Attention} items=${calmItems} onAct=${act} limit=${2} />
      <${WhereMoney} top=${top} />
      </div>
      <div class="home-side stack">
      <${PlanCards} data=${data} onSheet=${(s) => { setSheet(null); planSheet.open(s); }} />
      <${TripFound} data=${data} trips=${trips} />
      <div class="calm-tiles">
        ${cash.known && html`<button type="button" class="card calm-tile" onClick=${() => go('assets')}><small>כסף פנוי בחשבון</small><b class="num" style=${cash.free < 0 ? 'color:var(--danger)' : ''}>${(cash.free < 0 ? '−' : '') + money(Math.abs(cash.free))}</b></button>`}
        <button type="button" class="card calm-tile" aria-expanded=${String(upOpen)} onClick=${() => setUpOpen((v) => !v)}><small>בשבועיים הקרובים</small><b>${soon.length ? (upSum ? '−' + money(upSum) : soon.length + ' צפויים') : 'אין חיובים צפויים'}</b>${soon.length > 0 && html`<span class="faint" style="font-size:12px">${soon.length === 1 ? 'חיוב אחד' : soon.length + ' חיובים'} · ${upOpen ? 'להסתיר' : 'לראות'}</span>`}</button>
      </div>
      ${upOpen && soon.length > 0 && html`<${Upcoming} items=${soon} />`}
      ${footer}
      ${switchLink}
      </div>
      ${moreSheet}
      <${PlanSheets} data=${data} sheet=${planSheet.value} onClose=${planSheet.close} />
      ${sheet && sheet.kind === 'sort' && html`<${SortSheet} data=${data} onClose=${() => setSheet(null)} />`}
      ${askTx && html`<${MoveSheet} key=${askTx.id} data=${data} line=${askTx} kind=${sheet.ask} onClose=${() => setSheet(null)} />`}
      ${sheet && sheet.kind === 'transfers' && html`<${TransferSheet} data=${data} dupeOk=${dupeOk} onClose=${() => setSheet(null)} onDays=${() => setDupeVer((v) => v + 1)} />`}
      ${sheet && sheet.kind === 'hero' && html`<${HeroSheet} plan=${plan} catName=${catName} onClose=${() => setSheet(null)} />`}
      ${sheetTx && html`<${TxSheet} key=${sheetTx.id} tx=${sheetTx} txs=${data.txs} categories=${data.categories} members=${data.members} onClose=${() => setSheet(null)} />`}
    </div>`;
  }

  if (!data.txs.length) {
    return html`<div class="stack">
      <${AnswerNotice} userId=${userId} />
      ${onPicture && html`<${PictureCard} data=${data} onOpen=${onPicture} />`}
      ${guide}
      <${InstallCard} />
      ${switchLink}
    </div>`;
  }


  return html`<div class="stack home">
    <div class="home-main stack">
      <${AnswerNotice} userId=${userId} />
      <${RepairCard} data=${data} />
      <${ImportNotice} data=${data} onImport=${onImport} />
      <${MonthlyAsk} userId=${userId} data=${data} />
      ${onPicture && html`<${PictureCard} data=${data} onOpen=${onPicture} />`}
      ${guide}
      <${Hero} plan=${plan} catName=${catName} onImport=${onImport} onOpen=${() => { planSheet.close(); setSheet({ kind: 'hero' }); }} />
      <${InstallCard} />
      <${TripFound} data=${data} trips=${trips} />
      <${Attention} items=${items} onAct=${act} />
      <${FixedCheckCard} data=${data} />
      <${PlanCards} data=${data} onSheet=${(s) => { setSheet(null); planSheet.open(s); }} />
      <${WhereMoney} top=${top} />
      ${switchLink}
    </div>
    <div class="home-side stack">
      <${CashCard} cash=${cash} accounts=${data.accounts} />
      ${onLearn && html`<${LearnCard} userId=${userId} onOpen=${onLearn} />`}
      <${Upcoming} items=${soon} />
      <${TalkToUs} />
    </div>
    <${PlanSheets} data=${data} sheet=${planSheet.value} onClose=${planSheet.close} />
    ${sheet && sheet.kind === 'sort' && html`<${SortSheet} data=${data} onClose=${() => setSheet(null)} />`}
    ${askTx && html`<${MoveSheet} key=${askTx.id} data=${data} line=${askTx} kind=${sheet.ask} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.kind === 'transfers' && html`<${TransferSheet} data=${data} dupeOk=${dupeOk} onClose=${() => setSheet(null)} onDays=${() => setDupeVer((v) => v + 1)} />`}
    ${sheet && sheet.kind === 'hero' && html`<${HeroSheet} plan=${plan} catName=${catName} onClose=${() => setSheet(null)} />`}
    ${sheetTx && html`<${TxSheet} key=${sheetTx.id} tx=${sheetTx} txs=${data.txs} categories=${data.categories} members=${data.members} onClose=${() => setSheet(null)} />`}
  </div>`;
}
