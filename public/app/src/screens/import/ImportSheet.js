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
import { Steps, Checked } from './Steps.js';
import { Review } from './Review.js';
import { sourcesOf, checkFile, otherSource, missingCards, learnProvider, providerOf, nameOf } from '../../domain/sources.js';
import { Logo } from '../picture/Picture.js';

// Upload a card statement: pick a file, watch it being read, review what
// was found (categories, duplicates), save. Saving can be undone.
// phase: 'pick' | 'work' | 'checked' (what the check found) | 'review' | 'error'
const fileType = (name) => {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv' || ext === 'pdf') return ext;
  return /^(png|jpe?g|webp|heic|gif)$/.test(ext) ? 'image' : 'other';
};

export function ImportSheet({ data, onClose, source: preset = null }) {
  const [phase, setPhase] = useState('pick');
  const [step, setStep] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);
  const sources = sourcesOf({ accounts: data.accounts, cards: data.cards });
  // Which account or card this file is (chosen before, or found in the file).
  const [sourceId, setSourceId] = useState(preset ? preset.id : null);
  const source = sources.find((x) => x.id === sourceId) || null;
  const [cardId, setCardIdRaw] = useState(() => (preset ? (preset.kind === 'card' ? preset.id : null) : data.cards.length === 1 ? data.cards[0].id : null));
  const setCardId = (id) => { setCardIdRaw(id); if (id) setSourceId(id); };
  const pickSource = (x) => { setSourceId(x ? x.id : null); setCardIdRaw(x && x.kind === 'card' ? x.id : null); };
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
  // The company named in the file, and a move to another source in flight.
  const [issuer, setIssuer] = useState(null);
  const [moving, setMoving] = useState(false);
  // The source chips in the review, opened by "לשנות".
  const [change, setChange] = useState(false);
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
      setIssuer(out.issuer || null);
      // No account chosen yet: the one the file points at, when there is one.
      if (!sourceId) {
        const fours = new Set(out.items.map((t) => t.card4).filter(Boolean));
        const cardsOnly = sources.filter((x) => x.kind === 'card');
        const banks = sources.filter((x) => x.kind === 'bank');
        const byFour = cardsOnly.find((c) => c.last4 && fours.has(String(c.last4)));
        const guess = out.fromCard ? byFour || (cardsOnly.length === 1 ? cardsOnly[0] : null) : banks.length === 1 ? banks[0] : null;
        if (guess) pickSource(guess);
      }
      setDropCharges(true);
      // A file for a chosen account or card: first what the check found.
      // All fine: a moment to see it, then on to the lines by itself.
      setPhase(sourceId || preset ? 'checked' : 'review');
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

  // The file is another company's: it moves there, without uploading again
  // (added to the list first when the company is not in it yet). The lines
  // stay on screen to check and save under the right one.
  const other = phase === 'checked' ? otherSource({ source, items, issuer, sources }) : null;
  const miss = phase === 'checked' ? missingCards({ source, items, sources }) : null;
  const checks = source && (phase === 'checked' || phase === 'review') ? checkFile({ source, items, fromCard, sources }) : [];
  const bad = checks.some((c) => c.ok === false);
  const fine = phase === 'checked' && !other && !miss && !bad;
  useEffect(() => {
    if (!fine) return undefined;
    const id = run.current;
    const t = setTimeout(() => { if (run.current === id) setPhase('review'); }, 1400);
    return () => clearTimeout(t);
  }, [fine]);
  const move = async () => {
    if (!other || moving) return;
    setMoving(true);
    try {
      let to = other.to;
      if (!to) {
        const p = providerOf(other.provider);
        const row = await (p.kind === 'card' ? saveRow('credit_cards', { name: p.name, provider: p.key, billing_day: 10 }) : saveRow('bank_accounts', { name: p.name, bank_name: p.name, provider: p.key }));
        to = { kind: p.kind, id: row.id };
      }
      setSourceId(to.id);
      setCardIdRaw(to.kind === 'card' ? to.id : null);
      track('import_moved');
      setPhase('review');
      showToast('הפירוט הועבר ל' + (providerOf(other.provider) || {}).name + '. בודקים ושומרים.');
    } catch (_e) { showToast('ההעברה לא הצליחה. נסו שוב.'); }
    setMoving(false);
  };

  const reset = () => { run.current++; setItems([]); setError(''); setChange(false); setPhase('pick'); };

  const save = async () => {
    const isCard = fromCard || !!cardId;
    const rows = toRows(items, { cardId, cards: data.cards, fromCard: isCard });
    // The bank's monthly charge for these same purchases, already saved: out,
    // so the money is not counted twice (back with "בטל", or from the bin).
    const covered = isCard && dropCharges ? coveredCharges(items, data.txs).map((t) => t.id) : [];
    if (!rows.length || saving) return;
    setSaving(true);
    try {
      const added = await addImported(rows, { fileName, kind: String(fileName).split('.').pop().toLowerCase().slice(0, 5), source });
      // Installment payments create (or correct) their deal, so the payments
      // still to come are in the forecast. Never holds up the import.
      const deals = installmentDeals(rows, data.installments);
      for (const d of deals.create) await saveRow('installments', d).catch(() => {});
      for (const u of deals.update) await saveRow('installments', u).catch(() => {});
      saved.current = true;
      // An account or card saved before its company was chosen learns it
      // from the file it was just confirmed with.
      const learned = learnProvider({ source, issuer });
      if (learned && source) await saveRow(source.kind === 'card' ? 'credit_cards' : 'bank_accounts', { id: source.id, provider: learned }).catch(() => {});
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

  return html`<${Sheet} title=${source ? 'העלאת פירוט: ' + nameOf(source) : preset ? 'העלאת פירוט: ' + preset.name : 'העלאת פירוט'} onClose=${() => { run.current++; onClose(); }}>
    ${phase === 'pick' && html`<${PickFile} onFile=${start} />`}
    ${phase === 'work' && html`<${Steps} step=${step} fileName=${fileName} />`}
    ${phase === 'checked' && (other
      ? html`<div class="import-move"><${Checked} tone="bad" title=${other.text} text="לא צריך להעלות שוב: מעבירים אותו בלחיצה, ואז בודקים ושומרים את התנועות שם." checks=${checks.slice(1)}>
          <button type="button" class="btn" disabled=${moving} onClick=${move}>${other.to ? 'להעביר ל' + nameOf(other.to) : 'להוסיף את ' + providerOf(other.provider).name + ' ולהעביר אליו'}</button>
          <button type="button" class="btn btn-ghost" onClick=${() => setPhase('review')}>לא, זה באמת של ${nameOf(source)}</button>
        <//></div>`
      : miss ? html`<${Checked} tone="warn" title=${'נמצא כרטיס אחד מתוך ' + miss.total} text="אפשר להעלות גם את הפירוט של הכרטיס השני, או לסמן שלא היה בו שימוש החודש." checks=${checks}>
          <button type="button" class="btn" onClick=${() => setPhase('review')}>לשמור, ולהעלות את השני אחר כך</button>
          <button type="button" class="btn btn-ghost" onClick=${() => setPhase('review')}>הכרטיס השני לא היה בשימוש</button>
        <//>`
      : bad ? html`<${Checked} tone="bad" title="משהו לא מתאים בקובץ" text="כדאי לבדוק שזה הקובץ הנכון לפני ששומרים." checks=${checks}>
          <button type="button" class="btn" onClick=${() => setPhase('review')}>להמשיך בכל זאת</button>
          <button type="button" class="btn btn-ghost" onClick=${reset}>לבחור קובץ אחר</button>
        <//>`
      : html`<${Checked} tone="ok" title="הכול תקין" text="עוברים לתנועות…" checks=${checks} />`)}
    ${phase === 'error' && html`<div class="card" role="alert" style="display:flex;flex-direction:column;gap:10px">
        <b style="color:var(--danger)">לא הצלחנו לקרוא את ${fileName}</b>
        <span class="muted" style="line-height:1.5">${error}</span>
      </div>
      <button type="button" class="btn" onClick=${reset}>לבחור קובץ אחר</button>`}
    ${phase === 'review' && source && !change && html`<div class="import-okline"><span aria-hidden="true">✓</span><span>פירוט ${nameOf(source)}${(checks.find((c) => c.key) || {}).text ? ' · ' + checks.find((c) => c.key).text : ''}</span><button type="button" class="btn-text" onClick=${() => setChange(true)}>לשנות</button></div>`}
    ${phase === 'review' && sources.length > 0 && (!source || change) && html`<div class="card stack import-source">
      <b>מאיזה חשבון או כרטיס הקובץ?</b>
      <div class="import-source-pick" role="group" aria-label="החשבון או הכרטיס של הקובץ">${sources.map((x) => html`<button type="button" key=${x.id} class=${'import-src' + (sourceId === x.id ? ' on' : '')} aria-pressed=${sourceId === x.id} onClick=${() => pickSource(x)}><${Logo} provider=${x.provider} name=${x.name} size="s" /><small>${x.kind === 'card' ? (x.last4 || x.name) : 'עו״ש'}</small></button>`)}
        <button type="button" class=${'import-src' + (!sourceId ? ' on' : '')} aria-pressed=${!sourceId} onClick=${() => pickSource(null)}><small>אחר / לא בטוח</small></button></div>
      ${source && html`<ul class="import-checks" aria-label="בדיקת הקובץ">${checkFile({ source, items, fromCard, sources }).map((c, i) => html`<li key=${i} class=${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'warn'}><i aria-hidden="true">${c.ok === true ? '✓' : '!'}</i>${c.text}</li>`)}</ul>`}
    </div>`}
    ${phase === 'review' && html`<${Review} items=${items} categories=${data.categories} cards=${sources.length ? [] : data.cards} cardId=${cardId} onCard=${setCardId} onChange=${setItems} onSave=${save} saving=${saving} onAnother=${reset}
      covered=${fromCard || cardId ? coveredCharges(items, data.txs) : []} dropCharges=${dropCharges} onDropCharges=${setDropCharges} />`}
  <//>`;
}
