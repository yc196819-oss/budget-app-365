import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { money } from '../../domain/format.js';
import { baseline } from '../../domain/forecast.js';
import { CATS, LEVELS, tripSummary, planBudget, savingPlan, pastRates, adjustFromEstimate, planFromEstimate, savingCapacity, readyMonth, emptyPrefs, applyChanges, personalize, tripPlanOf, tripPlanRecord } from '../../domain/trips.js';
import { estimate } from '../../data/trips.js';
import { getRate } from '../../data/fx.js';
import { saveGoal, deleteGoal } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';
import { CAT_LIST, categoryNamer, folderTrip, monthLabel } from './common.js';
import { TripChat, PrefChips } from './TripChat.js';

const isoMonth = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const SEASON = { high: 'עונה גבוהה (יקר)', shoulder: 'עונת ביניים', low: 'עונה שקטה (זול)' };

// Plan the next trip: where, when, how long, how many. The advisor checks
// the destination (flights, lodging, cost of living next to the last trip,
// cheaper months), the local currency is converted at today's rate, and the
// plan says how much to put aside each month, or when the money is ready at
// what the household can save. The chat fits it to the family (no lodging,
// meals paid for, money already put aside). Saved as a goal with a date, and
// with the whole plan (goals.trip_plan), so a saved trip opens here again,
// conversation included, to keep planning.
export function PlanTripSheet({ data, row, goal = null, onClose }) {
  const today = new Date();
  const base = row ? tripSummary(folderTrip(row, data.txs), row.people, new Set(row.excluded_ids || []), categoryNamer(data.categories)) : null;
  const [init] = useState(() => (goal ? tripPlanOf(goal) : null));
  const [dest, setDest] = useState(init ? init.dest : '');
  const [month, setMonth] = useState(() => (init && init.month) || isoMonth(new Date(today.getFullYear(), today.getMonth() + 5, 1)));
  const [days, setDays] = useState(init ? init.days : base ? base.days : 6);
  const [people, setPeople] = useState(init ? init.people : row ? row.people : 2);
  const [level, setLevel] = useState(init ? init.level : 'same');
  const [est, setEst] = useState(init ? init.est : null);
  const [msgs, setMsgs] = useState(init ? init.msgs : []);
  const [confirmDel, setConfirmDel] = useState(false);
  const [rate, setRate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState(() => (init ? init.prefs : emptyPrefs()));

  const n = { days, people, level };
  const adjust = est && base ? adjustFromEstimate(est) : {};
  const plan = base ? planBudget(base, { ...n, adjust }) : est ? planFromEstimate(est, n, rate || 0) : null;
  const fit = plan ? personalize(plan, prefs) : null;
  const sv = fit ? savingPlan(fit.toSave, month + '-01', today) : null;
  const capacity = savingCapacity(baseline(data.txs, today));
  const ready = fit && fit.toSave > 0 ? readyMonth(fit.toSave, capacity, today) : null;
  const ahead = Array.from({ length: 18 }, (_, i) => isoMonth(new Date(today.getFullYear(), today.getMonth() + i + 1, 1)));
  const months = ahead.includes(month) ? ahead : [month, ...ahead].sort();

  const check = async (where = dest, when = month) => {
    if (!where.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const e = await estimate({ destination: where.trim(), month: when, days, travelers: people, past: base ? { country: row.country, ...pastRates(base) } : null });
      setEst(e);
      setRate(null);
      if (e.currency && e.currency !== 'ILS') getRate(e.currency, today.toISOString().slice(0, 10)).then((r) => setRate(r.rate)).catch(() => {});
    } catch (err) {
      setError(err.message || 'היועץ לא זמין כרגע. נסו שוב.');
    } finally { setBusy(false); }
  };
  // The chat's changes: the trip itself (days, people, month, where) and the prefs.
  const onChanges = (ch) => {
    if (ch.days) setDays(ch.days);
    if (ch.travelers) setPeople(ch.travelers);
    if (ch.month && ahead.includes(ch.month)) setMonth(ch.month);
    setPrefs((p) => applyChanges(p, ch));
    if (ch.destination && ch.destination !== dest.trim()) { setDest(ch.destination); check(ch.destination, ch.month && ahead.includes(ch.month) ? ch.month : month); }
  };
  const chatContext = {
    destination: est?.destination || dest.trim(), month, days, travelers: people, past: row ? row.name : '',
    lines: fit ? fit.lines : {}, prefs,
    estimate: est ? { flight: est.flight_per_person.typical, lodging: est.lodging_per_night.typical, currency: est.currency, daily_local: est.daily_per_person_local } : null
  };
  // The rate comes again when a saved plan opens with an estimate in a foreign currency.
  useEffect(() => {
    if (init && init.est && init.est.currency && init.est.currency !== 'ILS') getRate(init.est.currency, today.toISOString().slice(0, 10)).then((r) => setRate(r.rate)).catch(() => {});
  }, []);
  const record = () => ({
    ...(goal ? { id: goal.id } : { saved_amount: 0 }),
        ...(goal ? { id: goal.id } : { saved_amount: 0 }),
    trip_plan: tripPlanRecord({ dest: est?.destination || dest.trim(), month, days, people, level, base_id: row ? row.id : null, est, prefs, msgs }),
    name: ('חופשה ב' + (est?.destination || dest.trim() || 'חו״ל')).slice(0, 60), target_amount: fit.toSave,
    target_date: month + '-01', icon: '✈️',
    plan_items: CAT_LIST.filter(([k]) => fit.lines[k] - fit.paid[k] > 0).map(([k, c]) => ({ name: c.label, amount: fit.lines[k] - fit.paid[k] })),
    notes: [`${days} ימים, ${people} נוסעים${est ? ' · הערכת היועץ' : ''}`, fit.covered ? 'ממומן: ' + money(fit.covered) : '', fit.funding ? 'כבר יש: ' + money(fit.funding) : '', ...prefs.notes].filter(Boolean).join(' · ').slice(0, 500)
  });
  // A saved plan keeps up with the conversation: each answer of the advisor
  // (and what it changed) is saved right away, so nothing is lost on close.
  const said = useRef(init ? init.msgs.length : 0);
  useEffect(() => {
    if (!goal || !fit || msgs.length <= said.current || msgs.at(-1).role !== 'ai') return;
    said.current = msgs.length;
    saveGoal(record()).catch(() => showToast('השינויים לא נשמרו. לחצו "לשמור שינויים".'));
  }, [msgs.length]);
  const save = async () => {
    if (!fit || saving) return;
    setSaving(true);
    try {
      await saveGoal(record());
      onClose();
      showToast(goal ? 'התוכנית עודכנה' : 'הטיול נשמר ביעדים ונכנס לתחזית');
    } catch (_err) { setSaving(false); showToast('השמירה נכשלה. נסו שוב.'); }
  };

  const pct = (k) => {
    if (!est || !base) return '';
    if (k === 'flights' && adjust.flightsPerPerson) return html`<span class="adj">${money(adjust.flightsPerPerson)} לאדם</span>`;
    if (k === 'lodging' && adjust.lodgingPerNight) return html`<span class="adj">${money(adjust.lodgingPerNight)} ללילה</span>`;
    return Number.isFinite(adjust.pct?.[k]) ? html`<span class="adj">${adjust.pct[k] > 0 ? '+' : ''}${adjust.pct[k]}%</span>` : '';
  };
  const remove = async () => {
    try { await deleteGoal(goal.id); onClose(); showToast(goal.name + ' נמחק'); } catch (_err) { showToast('המחיקה נכשלה. נסו שוב.'); }
  };
  const chat = html`<${TripChat} context=${chatContext} onChanges=${onChanges} msgs=${msgs} setMsgs=${setMsgs} />`;
  return html`<${Sheet} title=${goal ? goal.name : 'לתכנן טיול'} onClose=${onClose} full=${true}>
    <div class="card stack" style="gap:12px">
      <label class="field"><span>לאן?</span>
        <span class="add-input"><input class="input" value=${dest} onInput=${(e) => setDest(e.target.value)} placeholder="למשל: יוון, ניו יורק, תאילנד" onKeyDown=${(e) => { if (e.key === 'Enter') check(); }} />
          <button type="button" class="btn" style="flex:none" disabled=${!dest.trim() || busy} onClick=${() => check()}>${busy ? 'בודק…' : '✨ לבדוק'}</button></span></label>
      <label class="field"><span>מתי</span><select class="input" value=${month} onChange=${(e) => setMonth(e.target.value)}>${months.map((m) => html`<option value=${m}>${monthLabel(m)}</option>`)}</select></label>
      <div class="sec-row"><span class="muted">כמה ימים</span><span class="stepper"><button type="button" aria-label="פחות ימים" disabled=${days <= 2} onClick=${() => setDays(days - 1)}>−</button><b class="num">${days}</b><button type="button" aria-label="יותר ימים" onClick=${() => setDays(Math.min(60, days + 1))}>+</button></span></div>
      <div class="sec-row"><span class="muted">כמה נוסעים</span><span class="stepper"><button type="button" aria-label="פחות נוסעים" disabled=${people <= 1} onClick=${() => setPeople(people - 1)}>−</button><b class="num">${people}</b><button type="button" aria-label="יותר נוסעים" onClick=${() => setPeople(Math.min(20, people + 1))}>+</button></span></div>
      ${base && !est && html`<div class="field"><span>היעד לעומת ${row.country || 'הטיול הקודם'}</span>
        <div class="seg" role="group" aria-label="רמת מחירים">${Object.entries(LEVELS).map(([k, l]) => html`<button type="button" aria-pressed=${String(level === k)} onClick=${() => setLevel(k)}>${l.label}</button>`)}</div></div>`}
      ${error && html`<p class="error" role="alert">${error}</p>`}
    </div>

    ${est && html`<div class="card stack trip-est" style="gap:8px">
      <b>✨ ${est.destination || dest}${est.country && est.country !== est.destination ? ', ' + est.country : ''}</b>
      <span>✈️ טיסה הלוך-חזור: <b class="num">${money(est.flight_per_person.low)}–${money(est.flight_per_person.high)}</b> לאדם (בדרך כלל ${money(est.flight_per_person.typical)})</span>
      <span>🏨 לינה: <b class="num">${money(est.lodging_per_night.low)}–${money(est.lodging_per_night.high)}</b> ללילה לזוג</span>
      ${est.daily_per_person_local > 0 && est.currency && html`<span>💱 הוצאה יומית לאדם: כ-<b class="num">${est.daily_per_person_local.toLocaleString('en-US')} ${est.currency}</b>${rate ? html` ≈ <b class="num">${money(est.daily_per_person_local * rate)}</b> (שער היום ${rate.toFixed(3)})` : ''}</span>`}
      ${est.season && html`<span>📅 ${monthLabel(month)}: ${SEASON[est.season]}</span>`}
      ${est.cheaper_months.length > 0 && html`<div class="stack" style="gap:6px"><span class="muted" style="font-size:14px">זול יותר ב: ${est.cheaper_note}</span>
        <div class="chips">${est.cheaper_months.map((m) => html`<button type="button" class="chip" aria-pressed=${String(month === m)} onClick=${() => setMonth(m)}>${monthLabel(m)}</button>`)}</div></div>`}
      ${est.tips.length > 0 && html`<ul class="trip-tips">${est.tips.map((t) => html`<li>${t}</li>`)}</ul>`}
      <span class="faint" style="font-size:12px">הערכה של היועץ לפי ידע כללי, לא מחירים חיים. כדאי לבדוק טיסות לפני שמזמינים.</span>
    </div>`}

    ${fit ? html`<div class="card stack" style="gap:8px">
      <span class="muted">תקציב מוצע${dest.trim() ? ' ל' + (est?.destination || dest.trim()) : ''}: ${days} ימים, ${people} נוסעים</span>
      <b class="trip-total num">${money(fit.total)}</b>
      ${base && html`<span class="faint" style="font-size:13px">לפי ${row.name}: ${money(base.perPersonDay)} לאדם ליום${est ? '. האחוזים: לעומת ' + (row.country || 'הטיול הקודם') : ''}</span>`}
      ${CAT_LIST.filter(([k]) => plan.lines[k] > 0 || fit.lines[k] > 0).map(([k, c]) => {
        const off = prefs.skip.includes(k);
        const tag = off ? html`<span class="adj">לא צריך</span>` : fit.paid[k] > 0 ? html`<span class="adj paid">${fit.paid[k] >= fit.lines[k] ? 'ממומן' : 'ממומן ' + money(fit.paid[k])}</span>` : Number.isFinite(prefs.fixed[k]) ? html`<span class="adj">מחיר ידוע</span>` : Number.isFinite(prefs.pct[k]) ? html`<span class="adj">${prefs.pct[k] > 0 ? '+' : ''}${prefs.pct[k]}%</span>` : pct(k);
        return html`<div class=${'sec-row trip-line' + (off || (fit.paid[k] > 0 && fit.paid[k] >= fit.lines[k]) ? ' off' : '')} key=${k}><span>${c.icon} ${c.label}${tag}</span><b class="num amt">${money(off ? plan.lines[k] : fit.lines[k])}</b></div>`;
      })}
      ${(fit.covered > 0 || fit.funding > 0) && html`<div class="trip-fit">
        ${fit.covered > 0 && html`<div class="sec-row"><span>ממומן ע״י אחרים</span><b class="num">−${money(fit.covered)}</b></div>`}
        ${fit.funding > 0 && html`<div class="sec-row"><span>כבר יש בצד</span><b class="num">−${money(fit.funding)}</b></div>`}
        <div class="sec-row"><b>נשאר לחסוך</b><b class="num">${money(fit.toSave)}</b></div>
      </div>`}
      <${PrefChips} prefs=${prefs} onClear=${(k) => setPrefs((p) => (k === 'funding' ? applyChanges(p, { funding: 0 }) : applyChanges(p, { clear: [k] })))} onForget=${(n) => setPrefs((p) => applyChanges(p, { notes_remove: [n] }))} />
    </div>
    ${chat}
    <div class="card stack trip-save" style="gap:6px">
      <span class="muted">כדי שהכסף יהיה מוכן ב${monthLabel(month)}</span>
      <b class="trip-monthly num">${fit.toSave > 0 ? money(sv.monthly) + ' בחודש' : 'הכל מכוסה 🎉'}</b>
      <span class="faint" style="font-size:13px">${sv.months} חודשים. טיסה ולינה משולמות בדרך כלל 2–4 חודשים לפני.</span>
      ${ready && html`<span style="font-size:14px">בקצב שמתאים לכם, <b class="num">${money(capacity)}</b> בחודש (חצי ממה שנשאר בחודש רגיל), הכסף מוכן ב<b>${monthLabel(ready)}</b>.
        ${ready !== month && html` <button type="button" class="btn-text" onClick=${() => setMonth(months.includes(ready) ? ready : month)}>לתכנן ל${monthLabel(ready)}</button>`}</span>`}
      <button type="button" class="btn" disabled=${saving} onClick=${save}>${saving ? 'שומר…' : goal ? 'לשמור שינויים' : 'לשמור ביעדים'}</button>
    </div>` : html`<div class="card muted" style="font-size:14px">כתבו לאן, ולחצו "✨ לבדוק". היועץ יעריך טיסות, לינה ויוקר מחיה ויציע תקציב.</div>
    ${chat}`}
    ${goal && html`<div class="trip-del">${confirmDel
      ? html`<span>למחוק את התוכנית?</span><button type="button" class="btn-text danger" onClick=${remove}>כן, למחוק</button><button type="button" class="btn-text" onClick=${() => setConfirmDel(false)}>ביטול</button>`
      : html`<button type="button" class="btn-text danger" onClick=${() => setConfirmDel(true)}>למחוק את התוכנית</button>`}</div>`}
  <//>`;
}
