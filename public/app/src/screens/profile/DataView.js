import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { money } from '../../domain/format.js';
import { toCsv, txRows, TX_COLUMNS, exportName, binLine, daysLeft } from '../../domain/exporting.js';
import { exportAll, binItems, restore, download } from '../../data/account.js';
import { showToast } from '../../lib/toast.js';

// "Our data": take all of it with you, and bring back what was deleted in
// the last 30 days (by either of you).
export function DataView({ hid, userId, onBack }) {
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState('');

  const refresh = () => binItems(hid).then(setItems).catch(() => { setFailed(true); setItems([]); });
  useEffect(() => { refresh(); }, [hid]);

  const take = async () => {
    setBusy('export');
    try {
      const all = await exportAll(hid, userId);
      download(exportName('all'), JSON.stringify(all, null, 2), 'application/json');
      download(exportName('transactions'), toCsv(txRows(all.tables.transactions, all.tables.categories), TX_COLUMNS), 'text/csv;charset=utf-8');
      showToast(all.failed.length ? 'ירדו שני קבצים. חלק מהנתונים לא נקראו, נסו שוב.' : 'ירדו שני קבצים: כל המידע, והתנועות לאקסל');
    } catch (_e) { showToast('הייצוא לא הצליח. נסו שוב.'); }
    setBusy('');
  };
  const bringBack = async (item) => {
    setBusy('r' + item.id);
    try {
      await restore(item.id, hid, userId);
      setItems((list) => list.filter((x) => x.id !== item.id));
      showToast('חזר למקום');
    } catch (_e) { showToast('לא הצלחנו להחזיר. ייתכן שכבר הוחזר.'); }
    setBusy('');
  };

  return html`<div class="stack">
    <button type="button" class="btn-text" style="align-self:flex-start" onClick=${onBack}>→ חזרה</button>
    <div class="card stack">
      <b>📦 ייצוא כל המידע</b>
      <span class="muted" style="font-size:13px;line-height:1.6">שני קבצים: כל מה שנשמר במשק הבית (JSON), והתנועות בגיליון שנפתח באקסל. שלכם, לשמור או להעביר.</span>
      <button type="button" class="btn" disabled=${!!busy} onClick=${take}>${busy === 'export' ? 'מכין…' : 'להוריד את כל המידע'}</button>
    </div>
    <div class="card stack recycle-bin" role="region" aria-label="סל המחזור">
      <b>🗑️ נמחקו לאחרונה</b>
      <span class="muted" style="font-size:13px">כל מה שנמחק נשמר כאן 30 יום, ואפשר להחזיר בלחיצה.</span>
      ${items === null && html`<span class="muted">טוען…</span>`}
      ${failed && html`<span class="muted">לא הצלחנו לטעון את סל המחזור.</span>`}
      ${items && !failed && items.length === 0 && html`<span class="muted">אין כאן כלום. 🎉</span>`}
      ${items && items.map((it) => {
        const l = binLine(it);
        return html`<div class="bin-row" key=${it.id} style="display:flex;align-items:center;gap:10px">
          <span aria-hidden="true">${l.icon}</span>
          <span style="flex:1;display:flex;flex-direction:column;min-width:0">
            <b style="font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.title}${l.amount !== null ? html` · <span class="num">${money(l.amount)}</span>` : ''}</b>
            <span class="faint" style="font-size:12px">${l.kind} · עוד ${daysLeft(it.removed_at)} ימים</span>
          </span>
          <button type="button" class="btn btn-ghost" style="width:auto;padding:6px 12px" disabled=${!!busy} onClick=${() => bringBack(it)} aria-label=${'להחזיר: ' + l.title}>${busy === 'r' + it.id ? '…' : 'להחזיר'}</button>
        </div>`;
      })}
    </div>
  </div>`;
}
