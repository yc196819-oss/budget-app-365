import { api } from '../lib/api.js';
import { readXlsx } from '../lib/xlsx.js';
import { pdfText } from '../lib/pdf.js';
import { fileKind, decodeText, isBinaryXls, htmlTables, base64 } from '../lib/files.js';
import { aiEnabled } from '../lib/settings.js';
import { splitText, inParts } from '../domain/pdftext.js';
import { reportError } from '../lib/telemetry.js';
import { parseCsv, rowsToTransactions, fromAi, importPrompt, categorizePrompt, categorizeText, waitingMerchants, applyAiCategories, prepare, categorizeFromHistory } from '../domain/statement.js';

// Reads a statement file into import items, ready for review.
// Tables (Excel, CSV) are read here, on the device; only the names of
// merchants this household has never categorized go to the AI. PDFs and
// photos have no table to read, so their text or image goes to the AI.

const MAX_IMAGE_BYTES = 1400000; // the server accepts a 2MB request
// A statement's text goes in parts the AI reads whole (the server takes up
// to 12,000 characters a request), two at a time.
const PART = 10000;
const MERCHANTS_PER_CALL = 80;

export class ImportError extends Error {}

async function aiImport(body) {
  if (!aiEnabled()) throw new ImportError('היועץ (AI) כבוי בפרופיל, ולכן אפשר לקרוא כרגע רק קובצי אקסל ו-CSV. הפעילו אותו כדי לקרוא PDF או צילום.');
  const res = await api('/api/ai/import', { method: 'POST', body });
  return Array.isArray(res.transactions) ? res.transactions : [];
}

async function readTable(file, kind) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === 'xlsx') {
    try {
      return (await readXlsx(bytes.buffer)).flatMap((s) => s.rows);
    } catch (_err) {
      throw new ImportError('לא הצלחנו לפתוח את קובץ האקסל. נסו להוריד אותו שוב, או להעלות PDF.');
    }
  }
  if (kind === 'xls' && isBinaryXls(bytes)) {
    throw new ImportError('זה קובץ אקסל בפורמט ישן (xls). פתחו אותו ושמרו בשם כ-xlsx, או העלו את ה-PDF של הפירוט.');
  }
  const text = decodeText(bytes);
  return /^\s*</.test(text) ? htmlTables(text) : parseCsv(text);
}

// Every part of the text, read by the AI; a part that fails fails the file
// (half a statement saved as if whole would be worse than an error).
async function aiTextImport(text, categories, today) {
  const parts = splitText(text, PART);
  const lists = await inParts(parts, 2, (part) => aiImport({ prompt: importPrompt(categories, today), text: part }));
  return fromAi(lists.flat(), categories);
}

// steps: 'read' -> 'find' -> 'sort' -> 'dupes'
export async function readStatement(file, { categories, history, today = new Date(), onStep = () => {} }) {
  const kind = fileKind(file);
  if (!kind) throw new ImportError('סוג הקובץ לא נתמך. אפשר אקסל, CSV, PDF או צילום של הפירוט.');
  onStep('read');
  let items = [];
  let via = 'table';
  if (kind === 'xlsx' || kind === 'xls' || kind === 'csv' || kind === 'text') {
    const rows = await readTable(file, kind);
    onStep('find');
    items = rowsToTransactions(rows);
    if (!items.length) {
      // Not a table we recognize: let the AI read the text.
      const text = rows.map((r) => r.join(' | ')).join('\n');
      if (!text.trim()) throw new ImportError('הקובץ ריק או לא קריא.');
      via = 'ai';
      items = await aiTextImport(text, categories, today);
    }
  } else if (kind === 'pdf') {
    const text = await pdfText(await file.arrayBuffer());
    if (!text.trim()) throw new ImportError('לא מצאנו טקסט ב-PDF הזה (אולי זו סריקה). נסו צילום מסך או קובץ אקסל.');
    onStep('find');
    via = 'ai';
    items = await aiTextImport(text, categories, today);
  } else {
    if (file.size > MAX_IMAGE_BYTES) throw new ImportError('התמונה גדולה מדי. צלמו מסך של הפירוט או הקטינו את התמונה.');
    onStep('find');
    via = 'ai';
    const mimeType = file.type === 'image/jpg' ? 'image/jpeg' : file.type || 'image/png';
    const fileData = base64(new Uint8Array(await file.arrayBuffer()));
    items = fromAi(await aiImport({ prompt: importPrompt(categories, today), text: '', fileData, mimeType }), categories);
  }
  if (!items.length) throw new ImportError('לא מצאנו תנועות בקובץ. בדקו שזה הפירוט עצמו ולא סיכום.');

  onStep('sort');
  // The household's own past choices come first, then the AI for the rest.
  items = categorizeFromHistory(items, history);
  const sent = waitingMerchants(items);
  if (sent.length && aiEnabled()) {
    const groups = [];
    for (let i = 0; i < sent.length; i += MERCHANTS_PER_CALL) groups.push(sent.slice(i, i + MERCHANTS_PER_CALL));
    await inParts(groups, 2, async (group) => {
      try {
        const answers = await aiImport({ prompt: categorizePrompt(categories), text: categorizeText(group) });
        items = applyAiCategories(items, group, answers, categories);
      } catch (err) {
        // No AI right now: those lines wait for the user.
        reportError(err, 'import:categorize');
      }
    });
  }
  onStep('dupes');
  return { items: prepare(items, history), via };
}
