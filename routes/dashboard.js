const express = require('express');
const router = express.Router();
const { requireAuth, groupTopNWithOthers } = require('./utils');
const { getAllTransactions } = require('./dataAccess');

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const all = (await getAllTransactions()).filter(t => !t.removed);
    const totalTransactions = all.length;
    const totalSuppliers = new Set(all.map(t => t.supplier_name)).size;
    const totalAmount = all.reduce((s, t) => s + (t.total_amount || 0), 0);
    res.json({ totalTransactions, totalSuppliers, totalAmount });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load the dashboard summary.' });
  }
});

// Calendar entries for a given month/year -> supplier deliveries per day
// Includes removed transactions (marked via the `removed` flag on each entry)
// so a removed delivery still shows on its date and can be opened for audit —
// it's excluded from totals/analytics elsewhere, but never hidden from the calendar.
router.get('/calendar', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1); // 1-12
    const monthStr = String(month).padStart(2, '0');
    const prefix = `${year}-${monthStr}`;

    const all = await getAllTransactions();
    const rows = all
      .filter(t => (t.date || '').startsWith(prefix))
      .map(t => ({ id: t.id, transaction_number: t.transaction_number, date: t.date, supplier_name: t.supplier_name, removed: !!t.removed }))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    res.json({ year, month, entries: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load the calendar.' });
  }
});

// Breakdown of transactions by supplier (for pie chart) — top 10 suppliers by
// amount, with everything past that collapsed into a single "Others" slice so
// the pie stays readable even with dozens of suppliers.
router.get('/breakdown', requireAuth, async (req, res) => {
  try {
    const all = (await getAllTransactions()).filter(t => !t.removed);
    const bySupplier = {};
    all.forEach(t => {
      if (!bySupplier[t.supplier_name]) bySupplier[t.supplier_name] = { supplier_name: t.supplier_name, count: 0, amount: 0 };
      bySupplier[t.supplier_name].count += 1;
      bySupplier[t.supplier_name].amount += t.total_amount;
    });
    const rows = Object.values(bySupplier).sort((a, b) => b.amount - a.amount);
    res.json(groupTopNWithOthers(rows, 10));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load the breakdown.' });
  }
});

module.exports = router;
