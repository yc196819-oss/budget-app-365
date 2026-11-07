import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { findRepairs } from '../../domain/repair.js';
import { MONTH_NAMES } from '../../domain/money.js';
import { money } from '../../domain/format.js';
import { applyRepair, undoRepair, removeImport } from '../../data/household.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { track } from '../../lib/telemetry.js';
import { showToast } from '../../lib/toast.js';
import { Icon } from '../../components/Icon.js';

const skipKey = (hid) => 'repair:skip:' + hid;
const readSkips = (hid) => { try { return new Set(JSON.parse(readLocal(skipKey(hid), '[]'))); } catch (_e) { return new Set(); } };
const dm = (iso) => Number(iso.slice(8, 10)) + '.' + Number(iso.slice(5, 7));
const monthOf = (iso) => MONTH_NAMES[Number(iso.slice(5, 7)) - 1];

// "The advisor found a mistake": checked each time the app opens, one at a
// time, fixed with one tap (and undone with one more).
export function RepairCard({ data }) {
  const [skipped, setSkipped] = useState(() => readSkips(data.hid));
  const [busy, setBusy] = useState(false);
  const issue = findRepairs(data.txs, skipped)[0] || null;
  useEffect(() => { if (issue) track('repair_shown'); }, [issue && issue.key]);
  if (!issue) return null;

  const keep = () => {
    const next = new Set(skipped); next.add(issue.key);
    writeLocal(skipKey(data.hid), JSON.stringify([...next]));
    setSkipped(next);
    track('repair_skip');
  };
  const fix = async () => {
    if (busy) return;
    setBusy(true);
    track('repair_fix');
    try {
      if (issue.kind === 'junk') {
        await removeImport(issue.importId);
        showToast('השורות מהקובץ הוסרו. אפשר לשחזר תוך 30 יום מ"המידע שלנו".');
      } else {
        const undo = await applyRepair({ move: issue.move, moveTo: issue.moveTo, drop: issue.drop });
        showToast('תוקן: ' + issue.count + ' קניות במקום הנכון', { ms: 8000, undo: () => undoRepair(undo).then(() => showToast('התיקון בוטל')).catch(() => showToast('הביטול נכשל. נסו שוב.')) });
      }
    } catch (_e) {
      showToast('התיקון נכשל. נסו שוב.');
    }
    setBusy(false);
  };

  const card = issue.card && data.cards.find((c) => c.id === issue.card);
  const where = card ? 'בפירוט של ' + card.name + (card.last4 ? ' (' + card.last4 + ')' : '') : 'בפירוט שהעליתם';
  return html`<section class="card stack repair-card" role="status" aria-label="היועץ מצא טעות">
    <b class="repair-title"><${Icon} name="bulb" size=${20} />${issue.kind === 'junk' ? 'היועץ מצא קובץ שלא נראה כמו פירוט' : 'היועץ מצא טעות בהעלאה'}</b>
    ${issue.kind === 'junk'
      ? html`<span class="muted repair-text">מקובץ אחד שהעליתם נכנסו ${issue.count} שורות של ${money(1)} כל אחת. הן נראות כמו טקסט מהקובץ ולא כמו קניות, ורק מבלבלות את החשבון.</span>`
      : html`<span class="muted repair-text">${where}, ${issue.count} קניות נרשמו כאילו כולן נעשו ב-${dm(issue.day)}, יום החיוב, ולא ביום שבו קניתם. לכן ${monthOf(issue.day)} נראה יקר מדי.</span>
        <ul class="repair-list">
          ${issue.drop.length > 0 && html`<li><b>${issue.drop.length}</b> מהן כבר נמצאות אצלכם עם התאריך הנכון (${money(issue.dropTotal)}). נוריד את הכפולות.</li>`}
          ${issue.move.length > 0 && html`<li><b>${issue.move.length}</b> נעביר ל-${dm(issue.moveTo)}, ב${monthOf(issue.moveTo)} (${money(issue.moveTotal)}). זו הערכה, כי היום המדויק לא הופיע בקובץ.</li>`}
        </ul>`}
    <div class="repair-actions">
      <button type="button" class="btn" disabled=${busy} onClick=${fix}>${busy ? 'מתקן…' : issue.kind === 'junk' ? 'להוריד את השורות' : 'לתקן בלחיצה'}</button>
      <button type="button" class="btn btn-ghost" disabled=${busy} onClick=${keep}>להשאיר כך</button>
    </div>
    <span class="faint" style="font-size:12px">אפשר לבטל את התיקון מיד אחריו, ומה שיורד נשמר 30 יום בסל המחזור.</span>
  </section>`;
}
