import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { defaultHolidayItems, holidayGoalName, lastHolidayExtra } from '../../domain/calendar.js';
import { money } from '../../domain/format.js';
import { saveGoal } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

// Plan what the holiday will cost. Saved as a goal with the holiday's date,
// so the forecast counts it (instead of last year's estimate).
export function HolidaySheet({ data, holiday, onClose }) {
  const name = holidayGoalName(holiday);
  const existing = data.goals.find((g) => g.name === name);
  const [items, setItems] = useState(() => {
    const defaults = defaultHolidayItems(holiday.key);
    if (!existing || !Array.isArray(existing.plan_items)) return defaults;
    const saved = existing.plan_items.map((p, i) => ({ id: 's' + i, name: p.name, amount: Number(p.amount) || 0, on: true }));
    return [...saved, ...defaults.filter((d) => !saved.some((s) => s.name === d.name)).map((d) => ({ ...d, on: false }))];
  });
  const [busy, setBusy] = useState(false);
  const extra = lastHolidayExtra(holiday.key, holiday.date, data.txs);
  const total = items.filter((i) => i.on).reduce((s, i) => s + i.amount, 0);
  const update = (id, patch) => setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const save = async () => {
    setBusy(true);
    try {
      await saveGoal({
        ...(existing ? { id: existing.id } : { icon: '🎉' }),
        name,
        target_amount: total,
        target_date: holiday.date,
        plan_items: items.filter((i) => i.on).map((i) => ({ name: i.name, amount: i.amount }))
      });
      onClose();
      showToast('תוכנית ' + holiday.name + ' נשמרה ונכנסה לתחזית');
    } catch (_err) {
      setBusy(false);
      showToast('השמירה נכשלה. נסו שוב.');
    }
  };

  return html`<${Sheet} title=${'לתכנן את ' + holiday.name} onClose=${onClose}>
    ${extra ? html`<span class="muted" style="font-size:14px">בפעם הקודמת: כ-${money(extra)} מעל חודש רגיל</span>` : null}
    <div class="list">
      ${items.map((i) => html`<div class=${'row hol-row' + (i.on ? '' : ' off')} key=${i.id}>
        <input type="checkbox" class="import-check" checked=${i.on} onChange=${() => update(i.id, { on: !i.on })} aria-label=${i.name} />
        <span class="row-main"><b>${i.name}</b></span>
        <span class="stepper">
          <button type="button" aria-label=${'להוריד 50 מ' + i.name} disabled=${!i.on || i.amount <= 0} onClick=${() => update(i.id, { amount: Math.max(0, i.amount - 50) })}>−</button>
          <b class="num">${money(i.amount)}</b>
          <button type="button" aria-label=${'להוסיף 50 ל' + i.name} disabled=${!i.on} onClick=${() => update(i.id, { amount: i.amount + 50 })}>+</button>
        </span>
      </div>`)}
    </div>
    <div class="facts"><div><span>סה״כ לחג</span><b class="num">${money(total)}</b></div></div>
    <button type="button" class="btn" disabled=${busy} onClick=${save}>${busy ? 'שומר…' : existing ? 'לעדכן את התוכנית' : 'לשמור את התוכנית'}</button>
  <//>`;
}
