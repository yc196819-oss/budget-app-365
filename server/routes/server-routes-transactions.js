const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDb, updateDb } = require('../server-db');

const router = express.Router();

router.get('/', (req, res) => {
  const db = readDb();
  res.json(db.transactions);
});

router.post('/', (req, res) => {
  const { type, description, category, amount, date, paymentMethod, notes } = req.body;

  if (!description || !category || !date) {
    return res.status(400).json({ error: 'תיאור, קטגוריה ותאריך הם שדות חובה' });
  }

  const parsedAmount = parseFloat(amount);
  if (!parsedAmount || parsedAmount <= 0) {
    return res.status(400).json({ error: 'סכום חייב להיות חיובי' });
  }

  if (!['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: 'סוג תנועה חייב להיות income או expense' });
  }

  const newTransaction = {
    id: uuidv4(),
    type,
    description,
    category,
    amount: parsedAmount,
    date,
    paymentMethod: paymentMethod || 'cash',
    notes: notes || ''
  };

  const db = updateDb((currentDb) => {
    currentDb.transactions.push(newTransaction);
    return currentDb;
  });

  res.status(201).json(newTransaction);
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { type, description, category, amount, date, paymentMethod, notes } = req.body;

  if (type && !['income', 'expense'].includes(type)) {
    return res.status(400).json({ error: 'סוג תנועה חייב להיות income או expense' });
  }

  if (amount !== undefined) {
    const parsedAmount = parseFloat(amount);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'סכום חייב להיות מספר חיובי' });
    }
  }

  const db = updateDb((currentDb) => {
    const tx = currentDb.transactions.find(t => t.id === id);
    if (!tx) {
      throw new Error('תנועה לא נמצאה');
    }

    if (description) tx.description = description;
    if (category) tx.category = category;
    if (amount !== undefined) tx.amount = parseFloat(amount);
    if (date) tx.date = date;
    if (type) tx.type = type;
    if (paymentMethod) tx.paymentMethod = paymentMethod;
    if (notes !== undefined) tx.notes = notes;

    return currentDb;
  });

  const updatedTx = db.transactions.find(t => t.id === id);
  res.json(updatedTx);
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;

  const db = updateDb((currentDb) => {
    currentDb.transactions = currentDb.transactions.filter(t => t.id !== id);
    return currentDb;
  });

  res.json({ message: 'תנועה נמחקה בהצלחה', id });
});

module.exports = router;