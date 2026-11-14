import { html } from '../../lib/html.js';
import { money } from '../../domain/format.js';
import { Icon } from '../../components/Icon.js';
import { CountUp } from '../../components/CountUp.js';

// "Left to spend this month", with a bar for the budget used and a mark for
// how far into the month we are.
// A payment still to come, in words: its category, or what it was called.
const comingText = (plan, catName) => plan.recurring.slice(0, 3).map((r) => (catName(r.category_id) || r.description) + ' כ-' + money(r.amount)).join(', ') + (plan.recurring.length > 3 ? ' ועוד' : '');

export function Hero({ plan, onOpen, catName = () => '', onImport = null }) {
  const over = plan.hasBudget && plan.remaining < 0;
  const forecast = plan.canForecast
    ? (plan.projectedEnd < 0 ? 'בקצב הזה החודש ייגמר במינוס של כ-' + money(-plan.projectedEnd) : 'בקצב הזה תסיימו את החודש עם כ-' + money(plan.projectedEnd))
    : null;
  return html`<button type="button" class="hero rise hero-btn" onClick=${onOpen} aria-label="פירוט: ${plan.hasBudget ? 'נשאר להוציא החודש' : 'הוצאתם החודש'}">
    <span class="hero-top"><span>${plan.hasBudget ? (over ? 'חרגתם מהתקציב החודש' : 'נשאר להוציא החודש') : 'הוצאתם החודש'}</span><span class="hero-more">פירוט<${Icon} name="back" size=${14} stroke=${2.6} /></span></span>
    <span class="display num hero-num"><${CountUp} value=${plan.hasBudget ? plan.remaining : plan.spent} format=${(n) => (n < 0 ? '−' : '') + money(n)} /></span>
    ${plan.hasBudget && html`<span class="hero-track" aria-hidden="true">
      <span class="hero-fill" style=${'width:' + plan.spentPct + '%'}></span>
      <span class="hero-today" style=${'inset-inline-start:' + plan.dayPct + '%'} title="היום בחודש"></span>
    </span>`}
    <span class="hero-foot">
      <span>${plan.hasBudget ? 'הוצאתם ' + money(plan.spent) + ' מתוך ' + money(plan.budget) : plan.avgVariable > 0 ? 'בחודש רגיל: כ-' + money(plan.avgVariable) + ' בהוצאות משתנות' : 'עוד אין תקציב חודשי'}</span>
      <span>${plan.daysLeft === 1 ? 'היום האחרון בחודש' : 'עוד ' + plan.daysLeft + ' ימים'}</span>
    </span>
    ${forecast && html`<span class=${'hero-forecast' + (plan.projectedEnd < 0 ? ' bad' : '')}>${forecast}</span>`}
    ${plan.smart && plan.hasBudget && plan.recurring.length > 0 && html`<span class="hero-coming">כבר הורדנו מה שעוד צפוי לרדת החודש: ${comingText(plan, catName)}</span>`}
  </button>
  ${plan.smart && plan.looksPartial && html`<div class="card hero-partial" role="status">
    <span>נראה שעוד לא נכנסו כל ההוצאות של החודש${plan.lastLine ? ' (השורה האחרונה מ-' + Number(plan.lastLine.slice(8, 10)) + '.' + Number(plan.lastLine.slice(5, 7)) + ')' : ''}, אז "נשאר להוציא" עלול להיות גבוה מדי.</span>
    ${onImport && html`<button type="button" class="btn btn-ghost" onClick=${onImport}>להעלות דף חשבון או אשראי</button>`}
  </div>`}`;
}
