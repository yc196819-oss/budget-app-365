const express = require('express');
const { readDb, updateDb } = require('../server-db');

const router = express.Router();

router.get('/', (req, res) => {
  const db = readDb();
  res.json(db.budgets);
});

router.post('/', (req, res) => {
  const { categoryName, amount, period } = req.body;

  if (!categoryName || !amount || !['monthly', 'yearly'].includes(period)) {
    return res.status(400).json({ error: 'שם קטגוריה, סכום ותקופה הם שדות חובה' });
  }

  const parsedAmount = parseFloat(amount);
  if (parsedAmount <= 0) {
    return res.status(400).json({ error: 'סכום תקציב חייב להיות חיובי' });
  }

  const db = updateDb((currentDb) => {
    const categoryExists = currentDb.categories.some(c => c.name === categoryName);
    if (!categoryExists) {
      throw new Error('קטגוריה לא קיימת');
    }

    currentDb.budgets[categoryName] = {
      amount: parsedAmount,
      period
    };

    return currentDb;
  });

  res.json({ categoryName, amount: parsedAmount, period });
});

router.delete('/:categoryName', (req, res) => {
  const { categoryName } = req.params;

  const db = updateDb((currentDb) => {
    delete currentDb.budgets[categoryName];
    return currentDb;
  });

  res.json({ message: 'תקציב נמחק בהצלחה', categoryName });
});

module.exports = router;