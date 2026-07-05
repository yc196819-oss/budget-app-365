const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDb, updateDb } = require('../server-db');

const router = express.Router();

router.get('/', (req, res) => {
  const db = readDb();
  res.json(db.savings);
});

router.post('/', (req, res) => {
  const { goalName, targetAmount } = req.body;

  if (!goalName || !targetAmount) {
    return res.status(400).json({ error: 'שם יעד וסכום יעד הם שדות חובה' });
  }

  const parsedAmount = parseFloat(targetAmount);
  if (parsedAmount <= 0) {
    return res.status(400).json({ error: 'סכום יעד חייב להיות חיובי' });
  }

  const newSavings = {
    id: uuidv4(),
    goalName,
    targetAmount: parsedAmount,
    currentAmount: 0
  };

  const db = updateDb((currentDb) => {
    currentDb.savings.push(newSavings);
    return currentDb;
  });

  res.status(201).json(newSavings);
});

module.exports = router;