import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { needsImportNotice, looseTxs } from '../../domain/guide.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { SortSheet } from '../money/SortSheet.js';

const KEY = 'notice:import-fix';

// Once, to whoever imported a statement before the fix: what happened, that
// it is fixed, and the one thing to do about it.
export function ImportNotice({ data, onImport }) {
  const [gone, setGone] = useState(() => readLocal(KEY, '') === '1');
  const [sorting, setSorting] = useState(false);
  if (!needsImportNotice(data.txs, gone)) return null;
  const close = () => { writeLocal(KEY, '1'); setGone(true); };
  const loose = looseTxs(data.txs).length;
  return html`<div class="card stack import-notice" role="status" style="border-inline-start:4px solid var(--accent)">
    <b>🙏 סליחה, ותודה על הסבלנות</b>
    <span class="muted" style="font-size:14px;line-height:1.6">בימים האחרונים חלק מהפירוטים שהועלו נקראו רק בחלקם, ותנועות לא סווגו. זה תוקן. ${loose ? (loose === 1 ? 'יש לכם תנועה אחת בלי קטגוריה.' : 'יש לכם ' + loose + ' תנועות בלי קטגוריה, והיועץ יכול להציע לכולן בלחיצה.') : 'אם הפירוט שהעליתם נראה חסר, אפשר להעלות אותו שוב: מה שכבר קיים יזוהה ולא ייכנס פעמיים.'}</span>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${loose ? html`<button type="button" class="btn" style="width:auto" onClick=${() => setSorting(true)}>לסווג עכשיו</button>` : ''}
      <button type="button" class=${loose ? 'btn btn-ghost' : 'btn'} style="width:auto" onClick=${() => { close(); onImport(); }}>להעלות שוב</button>
      <button type="button" class="btn-text" onClick=${close}>הבנתי</button>
    </div>
    ${sorting && html`<${SortSheet} data=${data} onClose=${() => { setSorting(false); close(); }} />`}
  </div>`;
}
