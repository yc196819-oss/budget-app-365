import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { categoryRows, parseDate, MONTH_NAMES } from '../../domain/money.js';
import { money } from '../../domain/format.js';
import { catColor } from '../../domain/colors.js';
import { averages, suggestBudget, paceOf, monthlyFor, averageLeft } from '../../domain/goals.js';
import { setBudget, saveGoal, deleteGoal, setPeople } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';
import { Icon } from '../../components/Icon.js';
import { SuggestSheet } from './SuggestSheet.js';
import { GoalSheet } from './GoalSheet.js';

const toNumber = (v) => { const n = Number(String(v).replace(/[,₪\s]/g, '')); return Number.isFinite(n) ? n : null; };
const PEOPLE = [1, 2, 3, 4, 5, 6, 7];

// The month so far, a budget for each category (typed, or one tap from the
// household's own average), how many people live at home, and the goals.
export function BudgetGoals({ data, onTrip }) {
  const [editing, setEditing] = useState(null);
  const [goalOpen, setGoalOpen] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const today = new Date();
  const mo = { y: today.getFullYear(), m: today.getMonth() };
  const avg = averages({ txs: data.txs, categories: data.categories, today });
  const spent = new Map(categoryRows(data.txs, data.categories, data.budgets, [mo]).map((r) => [r.id, r.spent]));
  const budgetOf = new Map(data.budgets.map((b) => [b.category_id, Number(b.monthly_amount) || 0]));
  const tops = data.categories.filter((c) => !c.parent_id && c.kind !== 'income')
    .map((c) => ({ ...c, spent: spent.get(c.id) || 0, budget: budgetOf.get(c.id) || 0, avg: avg.byCat.get(c.id) || 0 }))
    .filter((c) => c.budget > 0 || c.spent > 0 || c.avg > 0)
    .sort((a, b) => b.budget - a.budget || b.avg - a.avg || b.spent - a.spent);
  const total = tops.reduce((s, c) => s + c.budget, 0);
  const pace = paceOf({ txs: data.txs, categories: data.categories, budgets: data.budgets, today });
  const missing = tops.filter((c) => !c.budget && c.avg > 0).length;
  const people = data.people || null;
  const perPerson = (n) => (people && people > 1 ? money(n / people) + ' לנפש' : '');
  const left = averageLeft(data.txs, avg.months);

  const choosePeople = async (n) => {
    try { await setPeople(n); setPeopleOpen(false); showToast('נשמר: ' + n + ' נפשות בבית'); } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
  };

  return html`<div class="stack">
    ${pace.planned > 0 && html`<section class="card stack pace-card" style="gap:8px">
      <b style="font-size:17px">${MONTH_NAMES[mo.m]} עד עכשיו</b>
      <div class="sec-row"><span class="muted">הוצאתם</span><b class="num">${money(pace.spent)} מתוך ${money(pace.planned)}</b></div>
      <span class="bar pace-bar"><span style=${'width:' + Math.min(100, Math.round((pace.spent / pace.planned) * 100)) + '%;background:' + (pace.state === 'ok' ? 'var(--accent)' : 'var(--danger)')}></span><i class="pace-tick" style=${'inset-inline-start:' + Math.round(pace.pace * 100) + '%'} aria-hidden="true"></i></span>
      <span class="muted" style="font-size:14px;line-height:1.55">היום ה-${today.getDate()} בחודש, ${Math.round(pace.pace * 100)}% מהחודש. ${
        pace.state === 'over' ? 'עברתם את התקציב של החודש.' : pace.state === 'ahead' ? 'אתם מעל הקצב' + (pace.worst ? ', בעיקר ב' + pace.worst.name : '') + '.' : 'אתם בקצב.'}</span>
    </section>`}

    ${avg.months.length > 0 && missing > 0 && html`<section class="card stack suggest-card" style="gap:8px">
      <b class="suggest-title"><${Icon} name="bulb" size=${19} />הצעה לפי מה שאתם מוציאים באמת</b>
      <span style="font-size:15px;line-height:1.55">בממוצע של ${avg.months.length === 1 ? 'החודש האחרון' : avg.months.length + ' החודשים האחרונים'} הוצאתם <b class="num">${money(avg.total)}</b> בחודש. הצענו תקציב ${missing === 1 ? 'לקטגוריה אחת' : 'ל-' + missing + ' קטגוריות'}: הממוצע שלה, פחות 5%. אפשר לשנות כל שורה.</span>
      <button type="button" class="btn" onClick=${() => setSheet({ kind: 'suggest' })}>לראות את ההצעה ולשמור</button>
    </section>`}

    ${(!people || peopleOpen) ? html`<section class="card stack people-card" style="gap:8px">
      <b style="font-size:15px">כמה נפשות בבית?</b>
      <div class="chips" role="group" aria-label="מספר נפשות">
        ${PEOPLE.map((n) => html`<button type="button" class="chip" aria-pressed=${String(people === n)} onClick=${() => choosePeople(n)}>${n === 7 ? '7+' : n}</button>`)}
      </div>
      <span class="muted" style="font-size:14px">כך נראה גם כמה יוצא לנפש, למשל באוכל.</span>
    </section>` : ''}

    <section class="stack" style="gap:8px">
      <div class="sec-row"><h2 class="section-h">תקציב חודשי</h2><span class="muted">סה״כ <b class="num">${money(total)}</b>${people ? html` · <button type="button" class="btn-text" onClick=${() => setPeopleOpen(true)}>${people} נפשות</button>` : ''}</span></div>
      ${tops.length === 0 && html`<div class="card muted" style="font-size:14px">אחרי שתעלו פירוט, נציע כאן תקציב לכל קטגוריה לפי מה שאתם מוציאים.</div>`}
      <div class="list">
        ${tops.map((c) => {
          const isOpen = editing === c.id;
          const over = c.budget > 0 && c.spent > c.budget;
          const pct = c.budget > 0 ? Math.min(100, Math.round((c.spent / c.budget) * 100)) : 0;
          const sub = [c.avg > 0 ? 'ממוצע ' + money(c.avg) : '', perPerson(c.budget || c.avg)].filter(Boolean).join(' · ');
          return html`<div class="budget-row" key=${c.id}>
            <button type="button" class="row" aria-expanded=${String(isOpen)} onClick=${() => setEditing(isOpen ? null : c.id)}>
              <span class="row-main" style="gap:6px">
                <span style="display:flex;justify-content:space-between;gap:8px;font-size:15px;color:var(--text)"><b>${c.icon ? c.icon + ' ' : ''}${c.name}</b>
                  <span class="num" style="font-size:14px">${money(c.spent)} / ${c.budget ? html`<b>${money(c.budget)}</b>` : html`<b class="accent">להגדיר</b>`}</span></span>
                ${c.budget > 0 && html`<span class="bar pace-bar"><span style=${'width:' + pct + '%;background:' + (over ? 'var(--danger)' : catColor(c.id))}></span><i class="pace-tick" style=${'inset-inline-start:' + Math.round(pace.pace * 100) + '%'} aria-hidden="true"></i></span>`}
                ${sub && html`<span class="faint" style="font-size:13px">${sub}</span>`}
              </span>
            </button>
            ${isOpen && html`<${BudgetEdit} cat=${c} onDone=${() => setEditing(null)} />`}
          </div>`;
        })}
      </div>
    </section>

    <section class="stack" style="gap:8px">
      <div class="sec-row"><h2 class="section-h">יעדים</h2><button type="button" class="chip chip-add" onClick=${() => setSheet({ kind: 'goal' })}><${Icon} name="plus" size=${16} stroke=${2.4} />יעד חדש</button></div>
      ${data.goals.length === 0 && html`<div class="card muted" style="font-size:14px;line-height:1.55">עוד אין יעדים. קרן חירום, חופשה, רכב או חג: הגדירו כמה צריך ועד מתי, ונראה כמה להפריש כל חודש.</div>`}
      ${data.goals.map((g) => {
        const target = Number(g.target_amount) || 0;
        const saved = Number(g.saved_amount) || 0;
        const pct = target ? Math.min(100, Math.round((saved / target) * 100)) : 0;
        const d = g.target_date ? parseDate(g.target_date) : null;
        const isOpen = goalOpen === g.id;
        const monthly = monthlyFor({ target, saved, date: g.target_date, today });
        return html`<div class="card stack goal" style="gap:8px" key=${g.id}>
          <button type="button" class="goal-head" aria-expanded=${String(isOpen)} onClick=${() => setGoalOpen(isOpen ? null : g.id)}>
            <span aria-hidden="true">${g.icon || '🎯'}</span>
            <span class="row-main"><b>${g.name}</b><span>${money(saved)} מתוך ${money(target)}${d ? ' · עד ' + MONTH_NAMES[d.m] + ' ' + d.y : ''}</span></span>
            <b class="num">${pct}%</b>
          </button>
          <span class="bar"><span style=${'width:' + pct + '%;background:var(--accent)'}></span></span>
          ${monthly > 0 && pct < 100 && html`<span class="goal-monthly">כדי להגיע בזמן: ${money(monthly)} בחודש</span>`}
          ${isOpen && html`<${GoalEdit} goal=${g} onDone=${() => setGoalOpen(null)} onTrip=${onTrip} />`}
        </div>`;
      })}
    </section>
    ${sheet && sheet.kind === 'suggest' && html`<${SuggestSheet} rows=${tops.filter((c) => !c.budget && c.avg > 0)} months=${avg.months.length} onClose=${() => setSheet(null)} />`}
    ${sheet && sheet.kind === 'goal' && html`<${GoalSheet} totalAvg=${avg.total} left=${left} onClose=${() => setSheet(null)} />`}
  </div>`;
}

function BudgetEdit({ cat, onDone }) {
  const [value, setValue] = useState(cat.budget ? String(cat.budget) : String(suggestBudget(cat.avg) || ''));
  const [busy, setBusy] = useState(false);
  const save = async (amount) => {
    if (busy) return;
    setBusy(true);
    try { await setBudget(cat.id, amount); showToast(amount ? 'התקציב של ' + cat.name + ': ' + money(amount) : 'התקציב של ' + cat.name + ' הוסר'); onDone(); }
    catch (_e) { showToast('העדכון נכשל. נסו שוב.'); }
    setBusy(false);
  };
  const submit = (e) => { e.preventDefault(); const n = toNumber(value); if (n !== null && n >= 0) save(Math.round(n)); };
  const chips = cat.avg > 0 ? [{ label: 'הממוצע', amount: suggestBudget(cat.avg, 0) }, { label: 'הממוצע פחות 10%', amount: suggestBudget(cat.avg, 0.1) }] : [];
  return html`<form class="budget-edit2 rise" onSubmit=${submit}>
    <span style="display:flex;gap:8px">
      <input class="input num" inputmode="numeric" aria-label=${'תקציב חודשי ל' + cat.name} value=${value} onInput=${(e) => setValue(e.target.value)} style="flex:1;width:auto;min-width:0" />
      <button type="submit" class="btn" style="width:auto;padding:0 20px" disabled=${busy}>לשמור</button>
    </span>
    ${chips.length > 0 && html`<span class="chips">${chips.map((c) => html`<button type="button" class="chip" onClick=${() => setValue(String(c.amount))}>${c.label} ${money(c.amount)}</button>`)}</span>`}
    ${cat.budget > 0 && html`<button type="button" class="btn-text" style="align-self:flex-start;color:var(--danger)" onClick=${() => save(0)}>להסיר את התקציב</button>`}
  </form>`;
}

function GoalEdit({ goal, onDone, onTrip }) {
  const [add, setAdd] = useState('');
  const save = async (e) => {
    e.preventDefault();
    const n = toNumber(add);
    if (!n) return;
    try {
      await saveGoal({ id: goal.id, saved_amount: (Number(goal.saved_amount) || 0) + n });
      setAdd('');
      showToast('נוספו ' + money(n) + ' ל' + goal.name);
    } catch (_err) { showToast('העדכון נכשל. נסו שוב.'); }
  };
  const remove = async () => {
    try { await deleteGoal(goal.id); onDone(); showToast(goal.name + ' נמחק'); } catch (_err) { showToast('המחיקה נכשלה. נסו שוב.'); }
  };
  return html`<form class="stack rise" style="gap:8px" onSubmit=${save}>
    ${goal.icon === '✈️' && onTrip && html`<button type="button" class="btn btn-ghost" onClick=${() => onTrip(goal.id)}>לפתוח בתכנון הטיול · לדבר עם היועץ</button>`}
    ${Array.isArray(goal.plan_items) && goal.plan_items.length > 0 && html`<div class="facts">${goal.plan_items.map((p) => html`<div><span>${p.name}</span><b class="num">${money(p.amount)}</b></div>`)}</div>`}
    <span style="display:flex;gap:8px">
      <input class="input num" inputmode="decimal" aria-label=${'כמה הפרשתם ל' + goal.name} placeholder="כמה הפרשתם?" value=${add} onInput=${(e) => setAdd(e.target.value)} style="flex:1" />
      <button type="submit" class="btn" disabled=${!add}>להוסיף</button>
    </span>
    <button type="button" class="btn-text" style="align-self:flex-start;color:var(--danger)" onClick=${remove}>למחוק</button>
  </form>`;
}
