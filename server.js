require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// חיבור למסד הנתונים בענן 🌐
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('=== ✅ השרת מחובר בהצלחה ל-MongoDB Atlas! הנתונים שמורים בענן ==='))
  .catch(err => console.error('❌ שגיאה בחיבור ל-DB:', err));

// הגדרת המבנה של הנתונים (Schemas)
const TransactionSchema = new mongoose.Schema({
  type: { type: String, required: true },
  description: String,
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  date: { type: String, required: true },
  paymentMethod: String
});

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  type: { type: String, required: true }
});

const BudgetSchema = new mongoose.Schema({
  categoryName: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  period: { type: String, default: 'monthly' }
});

const Transaction = mongoose.model('Transaction', TransactionSchema);
const Category = mongoose.model('Category', CategorySchema);
const Budget = mongoose.model('Budget', BudgetSchema);

// API לתנועות
app.get('/api/transactions', async (req, res) => {
  try {
    const txs = await Transaction.find();
    res.json(txs.map(t => ({ ...t._doc, id: t._id })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const newTx = new Transaction(req.body);
    await newTx.save();
    res.status(201).json({ ...newTx._doc, id: newTx._id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.put('/api/transactions/:id', async (req, res) => {
  try {
    const updated = await Transaction.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ ...updated._doc, id: updated._id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// API לקטגוריות
app.get('/api/categories', async (req, res) => {
  try {
    const cats = await Category.find();
    res.json(cats.map(c => ({ id: c._id, name: c.name, type: c.type })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/categories', async (req, res) => {
  try {
    const newCat = new Category(req.body);
    await newCat.save();
    res.status(201).json({ id: newCat._id, name: newCat.name, type: newCat.type });
  } catch (err) { res.status(400).json({ error: "קטגוריה כבר קיימת" }); }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// API לתקציבים
app.get('/api/budgets', async (req, res) => {
  try {
    const budgets = await Budget.find();
    const budgetMap = {};
    budgets.forEach(b => { budgetMap[b.categoryName] = { amount: b.amount, period: b.period }; });
    res.json(budgetMap);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/budgets', async (req, res) => {
  const { categoryName, amount, period } = req.body;
  try {
    const budget = await Budget.findOneAndUpdate({ categoryName }, { amount, period }, { upsert: true, new: true });
    res.json(budget);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/budgets/:categoryName', async (req, res) => {
  try {
    await Budget.findOneAndDelete({ categoryName: req.params.categoryName });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 השרת רץ באוויר על פורט ${PORT}!`));