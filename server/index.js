const express = require('express');
const path = require('path');
const fs = require('fs');

const transactionsRouter = require('./routes/server-routes-transactions');
const categoriesRouter = require('./routes/server-routes-categories');
const budgetsRouter = require('./routes/server-routes-budgets');
const debtsRouter = require('./routes/server-routes-debts');
const savingsRouter = require('./routes/server-routes-savings');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '../public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const AI_BASE_URL = (process.env.AI_BASE_URL || '').trim();

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

app.get('/app-config.js', (req, res) => {
  const safeAiBase = AI_BASE_URL.replace(/'/g, "\\'").replace(/\/$/, '');
  res.type('application/javascript');
  res.send(`window.__APP_CONFIG = { API_BASE: '${safeAiBase}' };`);
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/transactions', transactionsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/debts', debtsRouter);
app.use('/api/savings', savingsRouter);

app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Budget app server listening on http://localhost:${PORT}`);
});
