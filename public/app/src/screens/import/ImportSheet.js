import { html } from '../../lib/html.js';
import { useRef, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { readStatement, ImportError } from '../../data/importer.js';
import { addImported, removeMany } from '../../data/household.js';
import { toRows } from '../../domain/statement.js';
import { showToast } from '../../lib/toast.js';
import { PickFile } from './PickFile.js';
import { Steps } from './Steps.js';
import { Review } from './Review.js';

// Upload a card statement: pick a file, watch it being read, review what
// was found (categories, duplicates), save. Saving can be undone.
// phase: 'pick' | 'work' | 'review' | 'error'
export function ImportSheet({ data, onClose }) {
  const [phase, setPhase] = useState('pick');
  const [step, setStep] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const run = useRef(0);

  const start = async (file) => {
    const id = ++run.current;
    setFileName(file.name);
    setPhase('work');
    setStep('read');
    try {
      const out = await readStatement(file, {
        categories: data.categories,
        history: data.txs,
        onStep: (s) => { if (run.current === id) setStep(s); }
      });
      if (run.current !== id) return;
      setItems(out.items);
      setPhase('review');
    } catch (err) {
      if (run.current !== id) return;
      setError(err instanceof ImportError ? err.message : 'משהו השתבש בקריאת הקובץ (' + (err.message || err) + '). נסו שוב, או קובץ אחר.');
      setPhase('error');
    }
  };

  const reset = () => { run.current++; setItems([]); setError(''); setPhase('pick'); };

  const save = async () => {
    const rows = toRows(items);
    if (!rows.length || saving) return;
    setSaving(true);
    try {
      const added = await addImported(rows);
      onClose();
      const ids = added.map((r) => r.id);
      showToast('נשמרו ' + added.length + ' תנועות מהפירוט', {
        ms: 8000,
        undo: () => removeMany(ids).then(() => showToast('הייבוא בוטל')).catch(() => showToast('הביטול נכשל. אפשר למחוק את התנועות מהרשימה.'))
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
    ${phase === 'review' && html`<${Review} items=${items} categories=${data.categories} onChange=${setItems} onSave=${save} saving=${saving} onAnother=${reset} />`}
  <//>`;
}
