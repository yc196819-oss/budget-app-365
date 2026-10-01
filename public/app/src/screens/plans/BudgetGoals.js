import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { categoryRows, parseDate, MONTH_NAMES } from '../../domain/money.js';
import { money } from '../../domain/format.js';
import { catColor } from '../../domain/colors.js';
import { setBudget, saveGoal, deleteGoal } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

// Monthly budget per category (tap a row to change it) and goals.
export function BudgetGoals({ data }) {
  const [editing, setEditing] = useState(null);
  const [goalOpen, setGoalOpen] = useState(null);
  const today = new Date();
  const mo = { y: today.getFullYear(), m: today.getMonth() };
  const spent = new Map(categoryRows(data.txs, data.categories, data.budgets, [mo]).map((r) => [r.id, r.spent]));
  const budgetOf = new Map(data.budgets.map((b) => [b.category_id, Number(b.monthly_amount) || 0]));
  const tops = data.categories.filter((c) => !c.parent_id && c.kind !== 'income')
    .map((c) => ({ ...c, spent: spent.get(c.id) || 0, budget: budgetOf.get(c.id) || 0 }))
    .sort((a, b) => b.budget - a.budget || b.spent - a.spent);
  const total = tops.reduce((s, c) => s + c.budget, 0);

  const change = async (c, delta) => {
    try { await setBudget(c.id, Math.max(0, c.budget + delta)); } catch (_err) { showToast('העדכון נכשל. נסו שוב.'); }
  };

  return html`<div class="stack">
    <section class="stack" style="gap:8px">
      <div class="sec-row"><h2 class="section-h">תקציב חודשי</h2><span class="muted">סה״כ <b class="num">${money(total)}</b></span></div>
      <div class="list">
        ${tops.map((c) => {
          const isOpen = editing === c.id;
          const over = c.budget > 0 && c.spent > c.budget;
          const pct = c.budget > 0 ? Math.min(100, Math.round((c.spent / c.budget) * 100)) : 0;
          return html`<div class="budget-row" key=${c.id}>
            <button type="button" class="row" aria-expanded=${String(isOpen)} onClick=${() => setEditing(isOpen ? null : c.id)}>
              <span class="row-main" style="gap:6px">
                <span style="display:flex;justify-content:space-between;gap:8px;font-size:15px;color:var(--text)"><b>${c.icon ? c.icon + ' ' : ''}${c.name}</b>
                  <span class="num" style="font-size:13px">${money(c.spent)} / <b>${c.budget ? money(c.budget) : '—'}</b></span></span>
                ${c.budget > 0 && html`<span class="bar"><span style=${'width:' + pct + '%;background:' + (over ? 'var(--danger)' : catColor(c.id))}></span></span>`}
              </span>
            </button>
            ${isOpen && html`<div class="budget-edit rise">
              <span>תקציב לחודש</span>
              <span class="stepper">
                <button type="button" aria-label="להוריד ב-100" disabled=${c.budget <= 0} onClick=${() => change(c, -100)}>−</button>
                <b class="num">${money(c.budget)}</b>
                <button type="button" aria-label="להעלות ב-100" onClick=${() => change(c, 100)}>+</button>
              </span>
            </div>`}
          </div>`;
        })}
      </div>
    </section>
    <section class="stack" style="gap:8px">
      <h2 class="section-h">יעדים ותוכניות</h2>
      ${data.goals.length === 0 && html`<div class="card muted" style="font-size:14px">עוד אין יעדים. חגים והוצאות גדולות שתתכננו יופיעו כאן.</div>`}
      ${data.goals.map((g) => {
        const target = Number(g.target_amount) || 0;
        const saved = Number(g.saved_amount) || 0;
        const pct = target ? Math.min(100, Math.round((saved / target) * 100)) : 0;
        const d = g.target_date ? parseDate(g.target_date) : null;
        const isOpen = goalOpen === g.id;
        return html`<div class="card stack goal" style="gap:8px" key=${g.id}>
          <button type="button" class="goal-head" aria-expanded=${String(isOpen)} onClick=${() => setGoalOpen(isOpen ? null : g.id)}>
            <span aria-hidden="true">${g.icon || '🎯'}</span>
            <span class="row-main"><b>${g.name}</b><span>${money(saved)} מתוך ${money(target)}${d ? ' · ' + MONTH_NAMES[d.m] + ' ' + d.y : ''}</span></span>
            <b class="num">${pct}%</b>
          </button>
          <span class="bar"><span style=${'width:' + pct + '%;background:var(--accent)'}></span></span>
          ${isOpen && html`<${GoalEdit} goal=${g} onDone=${() => setGoalOpen(null)} />`}
        </div>`;
      })}
    </section>
  </div>`;
}

function GoalEdit({ goal, onDone }) {
  const [add, setAdd] = useState('');
  const save = async (e) => {
    e.preventDefault();
    const n = Number(String(add).replace(/[,₪\s]/g, ''));
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
    ${Array.isArray(goal.plan_items) && goal.plan_items.length > 0 && html`<div class="facts">${goal.plan_items.map((p) => html`<div><span>${p.name}</span><b class="num">${money(p.amount)}</b></div>`)}</div>`}
    <span style="display:flex;gap:8px">
      <input class="input num" inputmode="decimal" aria-label=${'כמה הפרשתם ל' + goal.name} placeholder="כמה הפרשתם?" value=${add} onInput=${(e) => setAdd(e.target.value)} style="flex:1" />
      <button type="submit" class="btn" disabled=${!add}>להוסיף</button>
    </span>
    <button type="button" class="btn-text" style="align-self:flex-start;color:var(--danger)" onClick=${remove}>למחוק</button>
  </form>`;
}
