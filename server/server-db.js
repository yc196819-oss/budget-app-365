const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

const defaultDb = {
  transactions: [],
  categories: [
    { id: 'cat_salary', name: 'משכורת', type: 'income' },
    { id: 'cat_housing', name: 'דיור', type: 'fixed' },
    { id: 'cat_car', name: 'רכב', type: 'fixed' },
    { id: 'cat_studies', name: 'לימודים', type: 'fixed' },
    { id: 'cat_home', name: 'קניות לבית', type: 'variable' },
    { id: 'cat_fun', name: 'בילויים', type: 'variable' },
    { id: 'cat_health', name: 'בריאות', type: 'variable' },
    { id: 'cat_other', name: 'אחר', type: 'variable' }
  ],
  budgets: {},
  debts: [],
  savings: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDbFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), 'utf8');
  }
}

function normalizeDbShape(raw) {
  const db = clone(defaultDb);
  if (!raw || typeof raw !== 'object') return db;
  if (Array.isArray(raw.transactions)) db.transactions = raw.transactions;
  if (Array.isArray(raw.categories)) db.categories = raw.categories;
  if (raw.budgets && typeof raw.budgets === 'object') db.budgets = raw.budgets;
  if (Array.isArray(raw.debts)) db.debts = raw.debts;
  if (Array.isArray(raw.savings)) db.savings = raw.savings;
  return db;
}

function readDb() {
  ensureDbFile();
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const normalized = normalizeDbShape(raw);
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      writeDb(normalized);
    }
    return normalized;
  } catch (error) {
    writeDb(defaultDb);
    return clone(defaultDb);
  }
}

function writeDb(data) {
  ensureDbFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function updateDb(cb) {
  const db = readDb();
  const nextDb = cb(db);
  writeDb(nextDb);
  return nextDb;
}

module.exports = { readDb, writeDb, updateDb };
