import { html } from '../../lib/html.js';
import { Icon } from '../../components/Icon.js';
import { useEffect, useState } from 'preact/hooks';
import { money } from '../../domain/format.js';
import { toCsv, txRows, TX_COLUMNS, exportName, binLine, daysLeft } from '../../domain/exporting.js';
import { exportAll, binItems, restore, download } from '../../data/account.js';
import { listImports, removeImport, renameImport } from '../../data/household.js';
import { showToast } from '../../lib/toast.js';

// "Our data": take all of it with you, and bring back what was deleted in
// the last 30 days (by either of you).
export function DataView({ hid, userId, onBack }) {
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState('');

  const [files, setFiles] = useState(null);
  const [sure, setSure] = useState(null);
  const [naming, setNaming] = useState(null);
  const [draft, setDraft] = useState('');
  const refresh = () => binItems(hid).then(setItems).catch(() => { setFailed(true); setItems([]); });
  const refreshFiles = () => listImports().then(setFiles).catch(() => setFiles([]));
  useEffect(() => { refresh(); refreshFiles(); }, [hid]);
  const dm = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().slice(0, 2).join('.') : '');
  const fileTitle = (f) => f.title || f.file_name || 'פירוט שהועלה ב-' + dm(f.created_at);
  const startNaming = (f) => { setNaming(f.id); setDraft(f.title || f.file_name || ''); setSure(null); };
  const saveName = async (e, f) => {
    e.preventDefault();
    setBusy('n' + f.id);
    try {
      const title = await renameImport(f.id, draft === f.file_name ? '' : draft);
      setFiles((l) => l.map((x) => (x.id === f.id ? { ...x, title } : x)));
      setNaming(null);
      showToast('השם נשמר');
    } catch (_e) { showToast('השם לא נשמר. נסו שוב.'); }
    setBusy('');
  };
  const removeFile = async (f) => {
    if (sure !== f.id) { setSure(f.id); return; }
    setBusy('f' + f.id);
    try {
      await removeImport(f.id);
      setFiles((l) => l.filter((x) => x.id !== f.id));
      setSure(null);
      refresh();
      showToast('הקובץ נמחק עם ' + f.rows + ' התנועות שלו. אפשר להחזיר מ"נמחקו לאחרונה".');
    } catch (_e) { showToast('המחיקה לא הצליחה. נסו שוב.'); }
    setBusy('');
  };

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
      <b>ייצוא כל המידע</b>
      <span class="muted" style="font-size:13px;line-height:1.6">שני קבצים: כל מה שנשמר במשק הבית (JSON), והתנועות בגיליון שנפתח באקסל. שלכם, לשמור או להעביר.</span>
      <button type="button" class="btn" disabled=${!!busy} onClick=${take}>${busy === 'export' ? 'מכין…' : 'להוריד את כל המידע'}</button>
    </div>
    <div class="card stack import-files" role="region" aria-label="קבצים שהועלו">
      <b>קבצים שהועלו</b>
      <span class="muted" style="font-size:13px">העליתם קובץ לא נכון? מוחקים אותו וכל התנועות שנכנסו ממנו יוצאות מהמערכת. נותן לקובץ שם משלכם, כדי שיהיה קל למצוא אותו.</span>
      ${files === null && html`<span class="muted">טוען…</span>`}
      ${files && files.length === 0 && html`<span class="muted">עוד לא הועלו קבצים.</span>`}
      ${files && files.map((f) => html`<div class="file-row" key=${f.id} style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="flex:1;display:flex;flex-direction:column;min-width:0">
            <b style="font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fileTitle(f)}</b>
            ${f.title && f.file_name && html`<span class="faint file-original" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">הקובץ המקורי: <bdi dir="ltr">${f.file_name}</bdi></span>`}
            <span class="faint" style="font-size:12px"><span class="num">${f.rows}</span> תנועות${f.date_from ? html` · <span class="num">${dm(f.date_from)}–${dm(f.date_to)}</span>` : ''} · הועלה ${dm(f.created_at)}</span>
          </span>
          <button type="button" class="btn btn-ghost" style="width:auto;padding:6px 10px" disabled=${!!busy} onClick=${() => startNaming(f)} aria-label=${'לתת שם לקובץ ' + fileTitle(f)}><${Icon} name="edit" size=${18} /></button>
          <button type="button" class="btn btn-ghost" style=${'width:auto;padding:6px 12px;' + (sure === f.id ? 'color:var(--danger);border-color:var(--danger)' : '')} disabled=${!!busy} onClick=${() => removeFile(f)} aria-label=${'למחוק את הקובץ ' + fileTitle(f)}>${busy === 'f' + f.id ? '…' : sure === f.id ? 'בטוח? למחוק ' + f.rows : 'למחוק'}</button>
        </div>
        ${naming === f.id && html`<form class="file-name-form" style="display:flex;gap:8px" onSubmit=${(e) => saveName(e, f)}>
          <input class="input" style="flex:1" maxlength="80" aria-label="שם לקובץ" placeholder="למשל: ויזה אוקטובר" value=${draft} onInput=${(e) => setDraft(e.target.value)} />
          <button type="submit" class="btn" style="width:auto;padding:6px 14px" disabled=${!!busy}>${busy === 'n' + f.id ? '…' : 'לשמור'}</button>
          <button type="button" class="btn-text" onClick=${() => setNaming(null)}>ביטול</button>
        </form>`}
      </div>`)}
    </div>
    <div class="card stack recycle-bin" role="region" aria-label="סל המחזור">
      <b>נמחקו לאחרונה</b>
      <span class="muted" style="font-size:13px">כל מה שנמחק נשמר כאן 30 יום, ואפשר להחזיר בלחיצה.</span>
      ${items === null && html`<span class="muted">טוען…</span>`}
      ${failed && html`<span class="muted">לא הצלחנו לטעון את סל המחזור.</span>`}
      ${items && !failed && items.length === 0 && html`<span class="muted">אין כאן כלום. </span>`}
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
