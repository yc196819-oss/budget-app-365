const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDb, updateDb } = require('../server-db');

const router = express.Router();

router.get('/', (req, res) => {
  const db = readDb();
  res.json(db.categories);
});

router.post('/', (req, res) => {
  const { name, type } = req.body;

  if (!name || !['income', 'fixed', 'variable'].includes(type)) {
    return res.status(400).json({ error: 'שם וסוג קטגוריה הם שדות חובה' });
  }

  const db = updateDb((currentDb) => {
    const exists = currentDb.categories.some(c => c.name === name);
    if (exists) {
      throw new Error('קטגוריה בשם זה כבר קיימת');
    }

    const newCategory = {
      id: uuidv4(),
      name,
      type
    };

    currentDb.categories.push(newCategory);
    return currentDb;
  });

  const addedCat = db.categories.find(c => c.name === name);
  res.status(201).json(addedCat);
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;

  const db = updateDb((currentDb) => {
    const category = currentDb.categories.find(c => c.id === id);
    if (!category) {
      throw new Error('קטגוריה לא נמצאה');
    }

    const isUsed = currentDb.transactions.some(t => t.category === category.name);
    if (isUsed) {
      throw new Error('לא ניתן למחוק קטגוריה בה משתמשים בתנועות');
    }

    currentDb.categories = currentDb.categories.filter(c => c.id !== id);
    delete currentDb.budgets[category.name];
    return currentDb;
  });

  res.json({ message: 'קטגוריה נמחקה בהצלחה', id });
});

module.exports = router;