import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';
import { Icon } from '../../components/Icon.js';

// "Left to spend this month", with a bar for the budget used and a mark for
// how far into the month we are.
export function Hero({ plan, onOpen }) {
  const over = plan.hasBudget && plan.remaining < 0;
  const forecast = plan.canForecast
    ? (plan.projectedEnd < 0 ? 'בקצב הזה החודש ייגמר במינוס של כ-' + money(-plan.projectedEnd) : 'בקצב הזה תסיימו את החודש עם כ-' + money(plan.projectedEnd))
    : null;
  return html`<button type="button" class="hero rise hero-btn" onClick=${onOpen} aria-label="פירוט: ${plan.hasBudget ? 'נשאר להוציא החודש' : 'הוצאתם החודש'}">
    <span class="hero-top"><span>${plan.hasBudget ? (over ? 'חרגתם מהתקציב החודש' : 'נשאר להוציא החודש') : 'הוצאתם החודש'}</span><span class="hero-more">פירוט<${Icon} name="back" size=${14} stroke=${2.6} /></span></span>
    <span class="display num hero-num">${plan.hasBudget ? (over ? '−' : '') + money(plan.remaining) : money(plan.spent)}</span>
    ${plan.hasBudget && html`<span class="hero-track" aria-hidden="true">
      <span class="hero-fill" style=${'width:' + plan.spentPct + '%'}></span>
      <span class="hero-today" style=${'inset-inline-start:' + plan.dayPct + '%'} title="היום בחודש"></span>
    </span>`}
    <span class="hero-foot">
      <span>${plan.hasBudget ? 'הוצאתם ' + money(plan.spent) + ' מתוך ' + money(plan.budget) : plan.avgVariable > 0 ? 'בחודש רגיל: כ-' + money(plan.avgVariable) + ' בהוצאות משתנות' : 'עוד אין תקציב חודשי'}</span>
      <span>${plan.daysLeft === 1 ? 'היום האחרון בחודש' : 'עוד ' + plan.daysLeft + ' ימים'}</span>
    </span>
    ${forecast && html`<span class=${'hero-forecast' + (plan.projectedEnd < 0 ? ' bad' : '')}>${forecast}</span>`}
  </button>`;
}
