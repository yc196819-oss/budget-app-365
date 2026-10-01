import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { investmentValue } from '../../domain/assets.js';
import { money } from '../../domain/format.js';
import { saveRow, deleteRow } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

const TYPES = ['מניות/ETF', 'קרן כספית', 'קרן/נייר ישראלי', 'קריפטו', 'נדל״ן', 'פנסיה/השתלמות', 'אחר'];
const toNumber = (v) => { const n = Number(String(v).replace(/[,₪$\s]/g, '')); return Number.isFinite(n) ? n : null; };

// An investment: a symbol and units (live price from the server), or a value
// typed in by hand. Pension and study funds are investments of type
// "פנסיה/השתלמות", as in the current app.
export function InvestmentSheet({ inv, market, pension, onClose }) {
  const [name, setName] = useState(inv ? inv.name : '');
  const [type, setType] = useState(inv ? inv.asset_type || 'אחר' : pension ? 'פנסיה/השתלמות' : 'מניות/ETF');
  const [symbol, setSymbol] = useState(inv ? inv.symbol || '' : '');
  const [units, setUnits] = useState(inv && inv.units ? String(inv.units) : '');
  const [value, setValue] = useState(inv ? String(inv.current_value ?? '') : '');
  const [cost, setCost] = useState(inv && inv.cost ? String(inv.cost) : '');
  const [busy, setBusy] = useState(false);
  const live = type === 'מניות/ETF' || type === 'קריפטו';
  const sym = symbol.trim().toUpperCase();
  const symOk = !sym || /^[A-Z0-9.\-=^]{1,15}$/.test(sym);
  const preview = inv ? investmentValue({ ...inv, symbol: sym, units: toNumber(units) }, market) : null;

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim() || !symOk) return;
    setBusy(true);
    const useSymbol = live && sym && toNumber(units) > 0;
    try {
      await saveRow('investments', {
        ...(inv ? { id: inv.id } : { buy_date: new Date().toISOString().slice(0, 10) }),
        name: name.trim(),
        asset_type: type,
        symbol: useSymbol ? sym : null,
        units: useSymbol ? toNumber(units) : null,
        currency: useSymbol ? (inv && inv.currency) || 'USD' : 'ILS',
        cost: toNumber(cost) || 0,
        ...(useSymbol ? {} : { current_value: toNumber(value) || 0, value_updated_at: new Date().toISOString() })
      });
      onClose();
      showToast(inv ? 'עודכן' : 'נוסף');
    } catch (_err) {
      setBusy(false);
      showToast('השמירה נכשלה. נסו שוב.');
    }
  };
  const remove = async () => {
    try { await deleteRow('investments', inv.id); onClose(); showToast(inv.name + ' נמחק'); } catch (_err) { showToast('המחיקה נכשלה. נסו שוב.'); }
  };

  return html`<${Sheet} title=${inv ? inv.name : pension ? 'קרן חדשה' : 'השקעה חדשה'} onClose=${onClose}>
    <form class="stack" onSubmit=${save}>
      <label class="field"><span>שם</span><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder=${pension ? 'למשל: קרן השתלמות מיטב' : 'למשל: S&P 500'} required /></label>
      <div class="stack" style="gap:6px"><b style="font-size:13px;color:var(--muted)">סוג</b>
        <div class="chips" role="group" aria-label="סוג">${TYPES.map((t) => html`<button type="button" class="chip" aria-pressed=${String(type === t)} onClick=${() => setType(t)}>${t}</button>`)}</div></div>
      ${live && html`<div class="stack" style="gap:10px">
        <label class="field"><span>סימול, למחיר חי (לא חובה)</span><input class="input num" dir="ltr" value=${symbol} onInput=${(e) => setSymbol(e.target.value)} placeholder="SPY, QQQ, BTC-USD" aria-invalid=${String(!symOk)} /></label>
        ${sym && html`<label class="field"><span>כמה יחידות</span><input class="input num" inputmode="decimal" value=${units} onInput=${(e) => setUnits(e.target.value)} /></label>`}
      </div>`}
      ${!(live && sym) && html`<label class="field"><span>שווי עכשיו (₪)</span><input class="input num" inputmode="decimal" value=${value} onInput=${(e) => setValue(e.target.value)} placeholder=${pension ? 'מהדוח השנתי או מהאתר של הקרן' : ''} /></label>`}
      <label class="field"><span>כמה הושקע בסך הכול (₪, לא חובה)</span><input class="input num" inputmode="decimal" value=${cost} onInput=${(e) => setCost(e.target.value)} /></label>
      ${preview && preview.live && html`<span class="muted" style="font-size:13px">לפי המחיר עכשיו: ${money(preview.value)}</span>`}
      <button type="submit" class="btn" disabled=${busy || !name.trim() || !symOk}>${busy ? 'שומר…' : 'שמירה'}</button>
      ${inv && html`<button type="button" class="btn-text" style="color:var(--danger);align-self:flex-start" onClick=${remove}>למחוק</button>`}
    </form>
  <//>`;
}
