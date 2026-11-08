import { html } from '../../lib/html.js';
import { listRules } from '../../data/rules.js';
import { track, reportError } from '../../lib/telemetry.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { readStatement, ImportError } from '../../data/importer.js';
import { addImported, removeMany, removeImport, saveRow, undoRepair } from '../../data/household.js';
import { toRows, installmentDeals, coveredCharges } from '../../domain/statement.js';
import { showToast } from '../../lib/toast.js';
import { PickFile } from './PickFile.js';
import { Steps } from './Steps.js';
import { Review } from './Review.js';

// Upload a card statement: pick a file, watch it being read, review what
// was found (categories, duplicates), save. Saving can be undone.
// phase: 'pick' | 'work' | 'review' | 'error'
const fileType = (name) => {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || ext === 'pdf') return ext;
  return /^(png|jpe?g|webp|heic|gif)$/.test(ext) ? 'image' : 'other';
};

export function ImportSheet({ data, onClose }) {
  const [phase, setPhase] = useState('pick');
  const [step, setStep] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const [cardId, setCardId] = useState(() => (data.cards.length === 1 ? data.cards[0].id : null));
  const run = useRef(0);
  // The owner's numbers: where people stop in an upload (fixed words only:
  // the step, the kind of file, why it failed; never the file itself).
  const stage = useRef('pick');
  stage.current = phase;
  const saved = useRef(false);
  useEffect(() => {
    track('import_open');
    return () => { if (!saved.current) track('import_abandon_' + stage.current); };
  }, []);
  // A card's own statement (found in the file, or a card chosen for it).
  const [fromCard, setFromCard] = useState(false);
  const [dropCharges, setDropCharges] = useState(true);

  const start = async (file) => {
    const id = ++run.current;
    setFileName(file.name);
    track('import_file_' + fileType(file.name));
    setPhase('work');
    setStep('read');
    try {
      const out = await readStatement(file, {
        categories: data.categories,
        history: data.txs,
        rules: await listRules(data.hid).catch(() => []),
        onStep: (s) => { if (run.current === id) setStep(s); }
      });
      if (run.current !== id) return;
      setItems(out.items);
      setFromCard(!!out.fromCard);
      setDropCharges(true);
      setPhase('review');
    } catch (err) {
      if (run.current !== id) return;
      // Which kind of file failed and why (our message, never its content).
      track('import_fail');
      track('import_fail_' + (err instanceof ImportError ? err.code : 'other'));
      reportError(err, 'import:' + (String(file.name).split('.').pop() || '').toLowerCase().slice(0, 5));
      setError(err instanceof ImportError ? err.message : 'משהו השתבש בקריאת הקובץ (' + (err.message || err) + '). נסו שוב, או קובץ אחר.');
      setPhase('error');
    }
  };

  const reset = () => { run.current++; setItems([]); setError(''); setPhase('pick'); };

  const save = async () => {
    const isCard = fromCard || !!cardId;
    const rows = toRows(items, { cardId, cards: data.cards, fromCard: isCard });
    // The bank's monthly charge for these same purchases, already saved: out,
    // so the money is not counted twice (back with "בטל", or from the bin).
    const covered = isCard && dropCharges ? coveredCharges(items, data.txs).map((t) => t.id) : [];
    if (!rows.length || saving) return;
    setSaving(true);
    try {
      const added = await addImported(rows, { fileName, kind: String(fileName).split('.').pop().toLowerCase().slice(0, 5) });
      // Installment payments create (or correct) their deal, so the payments
      // still to come are in the forecast. Never holds up the import.
      const deals = installmentDeals(rows, data.installments);
      for (const d of deals.create) await saveRow('installments', d).catch(() => {});
      for (const u of deals.update) await saveRow('installments', u).catch(() => {});
      saved.current = true;
      if (covered.length) await removeMany(covered);
      onClose();
      const ids = added.map((r) => r.id);
      const importId = added[0] && added[0].import_id;
      track('import_done');
      showToast('נשמרו ' + added.length + ' תנועות מהפירוט' + (covered.length ? ', והחיוב הכפול מהבנק הוסר' : ''), {
        ms: 8000,
        undo: () => (importId ? removeImport(importId) : removeMany(ids))
          .then(() => (covered.length ? undoRepair({ drop: covered }) : null))
          .then(() => showToast('הייבוא בוטל')).catch(() => showToast('הביטול נכשל. אפשר למחוק את הקובץ מ"קבצים שהועלו" בפרופיל.'))
      });
    } catch (err) {
      setSaving(false);
      const saved = (err.saved || []).length;
      showToast(saved ? 'נשמרו רק ' + saved + ' תנועות. נסו לשמור שוב את השאר.' : 'השמירה נכשלה. נסו שוב.');
      if (saved) {
        // Drop the lines that did get saved so a retry does not double them.
        let left = saved;
        setItems((list) => list.map((t) => (t.include && left-- > 0 ? { ...t, include: false, saved: true } : t)));
      }
    }
  };

  return html`<${Sheet} title="העלאת פירוט כרטיס" onClose=${() => { run.current++; onClose(); }}>
    ${phase === 'pick' && html`<${PickFile} onFile=${start} />`}
    ${phase === 'work' && html`<${Steps} step=${step} fileName=${fileName} />`}
    ${phase === 'error' && html`<div class="card" role="alert" style="display:flex;flex-direction:column;gap:10px">
        <b style="color:var(--danger)">לא הצלחנו לקרוא את ${fileName}</b>
        <span class="muted" style="line-height:1.5">${error}</span>
      </div>
      <button type="button" class="btn" onClick=${reset}>לבחור קובץ אחר</button>`}
    ${phase === 'review' && html`<${Review} items=${items} categories=${data.categories} cards=${data.cards} cardId=${cardId} onCard=${setCardId} onChange=${setItems} onSave=${save} saving=${saving} onAnother=${reset}
      covered=${fromCard || cardId ? coveredCharges(items, data.txs) : []} dropCharges=${dropCharges} onDropCharges=${setDropCharges} />`}
  <//>`;
}
