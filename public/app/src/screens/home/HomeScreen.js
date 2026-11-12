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
import { SetupGuide } from './SetupGuide.js';
import { ImportNotice } from './ImportNotice.js';
import { RepairCard } from './RepairCard.js';
import { AnswerNotice } from './AnswerNotice.js';
import { MonthlyAsk } from './MonthlyAsk.js';
import { removeMany, keepBoth } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { SortSheet } from '../money/SortSheet.js';
import { TransferSheet } from './TransferSheet.js';

// The month at a glance: what is left to spend, where the month is heading,
// what needs attention (one action each) and what is coming up.
export function HomeScreen({ data, onAdd, onImport, onPicture, onLearn, onAsk, userId }) {
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
  const plan = monthPlan({ txs: data.txs, budgets: data.budgets, today });
  const cash = cashNow(data.accounts, data.cards, data.txs, today);
  const soon = upcoming({ txs: data.txs, cards: data.cards, today });
  // "Complete the picture" (its card, or the ✓ at the top) already says which
  // statement is due: the "card was charged, upload it" notes would repeat it.
  const items = attention({ txs: data.txs, categories: data.categories, budgets: data.budgets, cards: onPicture ? [] : data.cards, today, plan, dupeOk });
  const top = topCategories(data.txs, data.categories, data.budgets, today);

  const guide = html`<${SetupGuide} data=${data} userId=${userId} onImport=${onImport} onAdd=${onAdd} onAsk=${onAsk || (() => {})} />`;
  if (!data.txs.length) {
    return html`<div class="stack">
      <${AnswerNotice} userId=${userId} />
      ${onPicture && html`<${PictureCard} data=${data} onOpen=${onPicture} />`}
      ${guide}
      <${InstallCard} />
    </div>`;
  }

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
    if (a.to === 'import') onImport();
    else if (a.to === 'sort') { planSheet.close(); setSheet({ kind: 'sort' }); }
    else if (a.to === 'tx') { planSheet.close(); setSheet({ kind: 'tx', id: a.id }); }
    else if (a.to === 'money-cats') location.hash = '#/money/cats';
    else location.hash = '#/' + a.to;
  };
  const sheetTx = sheet && sheet.kind === 'tx' ? data.txs.find((t) => t.id === sheet.id) : null;

  return html`<div class="stack home">
    <div class="home-main stack">
      <${AnswerNotice} userId=${userId} />
      <${RepairCard} data=${data} />
      <${ImportNotice} data=${data} onImport=${onImport} />
      <${MonthlyAsk} userId=${userId} data=${data} />
      ${guide}
      ${onPicture && html`<${PictureCard} data=${data} onOpen=${onPicture} />`}
      <${Hero} plan=${plan} onOpen=${() => { planSheet.close(); setSheet({ kind: 'hero' }); }} />
      <${InstallCard} />
      <${TripFound} data=${data} trips=${trips} />
      <${Attention} items=${items} onAct=${act} />
      <${PlanCards} data=${data} onSheet=${(s) => { setSheet(null); planSheet.open(s); }} />
      <${WhereMoney} top=${top} />
    </div>
    <div class="home-side stack">
      <${CashCard} cash=${cash} accounts=${data.accounts} />
      ${onLearn && html`<${LearnCard} userId=${userId} onOpen=${onLearn} />`}
      <${Upcoming} items=${soon} />
      <${TalkToUs} />
    </div>
    <${PlanSheets} data=${data} sheet=${planSheet.value} onClose=${planSheet.close} />
    ${sheet && sheet.kind === 'sort' && html`<${SortSheet} data=${data} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.kind === 'transfers' && html`<${TransferSheet} data=${data} dupeOk=${dupeOk} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.kind === 'hero' && html`<${HeroSheet} plan=${plan} onClose=${() => setSheet(null)} />`}
    ${sheetTx && html`<${TxSheet} key=${sheetTx.id} tx=${sheetTx} txs=${data.txs} categories=${data.categories} members=${data.members} onClose=${() => setSheet(null)} />`}
  </div>`;
}
