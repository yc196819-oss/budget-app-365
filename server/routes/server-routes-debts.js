const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDb, updateDb } = require('../server-db');

const router = express.Router();

router.get('/', (req, res) => {
  const db = readDb();
  res.json(db.debts);
});

router.post('/', (req, res) => {
  const { name, amount } = req.body;

  if (!name || !amount) {
    return res.status(400).json({ error: 'שם וסכום חוב הם שדות חובה' });
  }

  const parsedAmount = parseFloat(amount);
  if (parsedAmount <= 0) {
    return res.status(400).json({ error: 'סכום חוב חייב להיות חיובי' });
  }

  const newDebt = {
    id: uuidv4(),
    name,
    amount: parsedAmount
  };

  const db = updateDb((currentDb) => {
    currentDb.debts.push(newDebt);
    return currentDb;
  });

  res.status(201).json(newDebt);
});

module.exports = router;