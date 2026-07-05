const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const routesPath = path.join(root, 'server', 'routes');
const dataPath = path.join(root, 'server', 'data');

console.log('🔧 תיקייה: routes...');
const routesStat = fs.lstatSync(routesPath);
console.log(`routes is directory: ${routesStat.isDirectory()}`);

console.log('\n🔧 תיקייה: data...');
const dataStat = fs.lstatSync(dataPath);
console.log(`data is directory: ${dataStat.isDirectory()}`);

// אם routes או data הם קבצים, נמחק אותם ונוצר תיקיות
if (!routesStat.isDirectory()) {
  console.log('routes הוא קובץ - מוחקים ויוצרים תיקייה');
  fs.unlinkSync(routesPath);
  fs.mkdirSync(routesPath, { recursive: true });
}

if (!dataStat.isDirectory()) {
  console.log('data הוא קובץ - מוחקים ויוצרים תיקייה');
  fs.unlinkSync(dataPath);
  fs.mkdirSync(dataPath, { recursive: true });
}

// יוצרים קבצי routes מחדש
const routes = [
  {
    name: 'server-routes-transactions.js',
    code: `const express = require('express');
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

module.exports = router;`
  },
  {
    name: 'server-routes-categories.js',
    code: `const express = require('express');
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

module.exports = router;`
  },
  {
    name: 'server-routes-budgets.js',
    code: `const express = require('express');
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

module.exports = router;`
  },
  {
    name: 'server-routes-debts.js',
    code: `const express = require('express');
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

module.exports = router;`
  },
  {
    name: 'server-routes-savings.js',
    code: `const express = require('express');
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

module.exports = router;`
  }
];

routes.forEach(route => {
  const filePath = path.join(routesPath, route.name);
  fs.writeFileSync(filePath, route.code, 'utf8');
  console.log(`✓ נוצר: ${route.name}`);
});

console.log('\n✅ סיימנו!');
