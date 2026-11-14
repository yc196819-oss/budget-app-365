import { html } from '../../lib/html.js';
import { Sheet } from '../../components/Sheet.js';
import { money } from '../../domain/format.js';

// How the hero numbers were computed, so they can be trusted.
export function HeroSheet({ plan, onClose, catName = () => '' }) {
  const end = plan.projectedEnd;
  return html`<${Sheet} title="החודש במספרים" onClose=${onClose}>
    <div class="facts">
      ${plan.hasBudget && html`<div><span>תקציב חודשי</span><b class="num">${money(plan.budget)}</b></div>`}
      <div><span>הוצאתם עד היום</span><b class="num">${money(plan.spent)}</b></div>
      <div><span>מתוכן משתנות</span><b class="num">${money(plan.variableSpent)}</b></div>
      ${plan.fixedExpenseLeft > 0 && html`<div><span>תשלומים קבועים שעוד יגיעו</span><b class="num">${money(plan.fixedExpenseLeft)}</b></div>`}
      ${plan.smart && plan.recurring.map((r) => html`<div key=${r.category_id + r.amount}><span>עוד צפוי: ${catName(r.category_id) || r.description} (בדרך כלל ב-${r.day} לחודש)</span><b class="num">${money(r.amount)}</b></div>`)}
      ${plan.hasBudget && plan.remaining > 0 && html`<div><span>אפשר להוציא ביום, עד סוף החודש</span><b class="num">${money(plan.perDayLeft)}</b></div>`}
      ${plan.avgVariable > 0 && html`<div><span>הוצאות משתנות בחודש רגיל</span><b class="num">${money(plan.avgVariable)}</b></div>`}
    </div>
    ${plan.canForecast && html`<div class="facts">
      <div><span>הכנסות החודש (כולל קבועות שעוד יגיעו)</span><b class="num">${money(plan.projectedIncome)}</b></div>
      <div><span>הוצאות צפויות עד סוף החודש</span><b class="num">${money(plan.projectedExpense)}</b></div>
      <div><span>צפוי בסוף החודש</span><b class="num" style=${'color:' + (end < 0 ? 'var(--danger)' : 'var(--income)')}>${(end < 0 ? '−' : '+') + money(end)}</b></div>
    </div>`}
    <p class="faint" style="font-size:12px;line-height:1.55;margin:0">
      ${plan.smart && 'נשאר להוציא = התקציב, פחות מה שכבר יצא, פחות תשלומים שחוזרים כל חודש ועוד לא הגיעו (סכום דומה באותה קטגוריה בחודשיים מתוך השלושה האחרונים). '}
      התחזית מחברת את מה שכבר יצא, את התשלומים הקבועים מהחודש שעבר שעוד לא הופיעו, ואת קצב ההוצאות המשתנות.
      בתחילת החודש היא נשענת יותר על 3 החודשים האחרונים.
      ${!plan.hasBudget && ' אין עדיין תקציב חודשי, ולכן אין "נשאר להוציא".'}
    </p>
  <//>`;
}
