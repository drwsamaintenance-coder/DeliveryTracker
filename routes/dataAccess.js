// Shared Firestore read helpers used by transactions.js, analytics.js,
// dashboard.js, and reports.js. Centralized here so every route reads
// transactions the same way instead of five slightly different copies.
const { db } = require('../db/init');

// Every transaction document, as plain {id, ...fields, items:[...]} objects.
// Firestore can't do SQL-style filtering/joins/GROUP BY, so callers filter,
// sort, and aggregate this array in JS — see the note in transactions.js for
// why that's the right tradeoff for this app's data size.
async function getAllTransactions() {
  const snap = await db.collection('transactions').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data(), items: d.data().items || [] }));
}

// Applies from/to/supplier filters (used by Analytics, Dashboard, and Reports)
// to an already-fetched transaction array, always excluding removed ones and
// always returning them sorted by date then transaction number (ascending).
function filterTransactions(all, { from, to, supplier } = {}) {
  const lcSupplier = supplier ? supplier.toLowerCase() : null;
  const rows = all.filter(t => {
    if (t.removed) return false;
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    if (lcSupplier && (t.supplier_name || '').toLowerCase() !== lcSupplier) return false;
    return true;
  });
  rows.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.transaction_number || '').localeCompare(b.transaction_number || ''));
  return rows;
}

module.exports = { getAllTransactions, filterTransactions };
