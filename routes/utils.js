const { db, FieldValue, ready } = require('../db/init');

async function requireAuth(req, res, next) {
  try {
    await ready;
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
    const snap = await db.collection('users').doc(req.session.userId).get();
    if (!snap.exists) return res.status(401).json({ error: 'Not logged in.' });
    const u = snap.data();
    req.user = {
      id: snap.id, name: u.name, position: u.position, email: u.email,
      phone: u.phone, address: u.address, avatar_path: u.avatar_path,
      role: u.role, username: u.username
    };
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not verify your session.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admin accounts can do this.' });
  }
  next();
}

// Transaction numbers used to come from `ORDER BY id DESC LIMIT 1` on an
// auto-increment column — Firestore has neither auto-increment IDs nor a
// reliable "last inserted" ordering, so this keeps its own counter document
// and increments it atomically inside a Firestore transaction (two people
// submitting a report at the same instant can never get the same number).
async function nextTransactionNumber() {
  const counterRef = db.collection('meta').doc('counters');
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? (snap.data().transactionSeq || 0) : 0;
    const n = current + 1;
    tx.set(counterRef, { transactionSeq: n }, { merge: true });
    return n;
  });
  return 'DRWSA' + String(next).padStart(2, '0');
}

async function logActivity(userId, action, transactionNumber) {
  await db.collection('activity_log').add({
    user_id: userId, action, transaction_number: transactionNumber,
    timestamp: new Date().toISOString()
  });
}

async function pushNotification(userName, message, transactionNumber, transactionId) {
  await db.collection('notifications').add({
    user_name: userName, message, transaction_number: transactionNumber,
    transaction_id: transactionId || null, created_at: new Date().toISOString()
  });
}

// The app's default display format for dates is mm/dd/yyyy. Dates are stored
// as yyyy-mm-dd strings, so this converts for display in tables, exports, and reports.
function formatDateMDY(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value;
  const [, y, mo, d] = m;
  return `${mo}/${d}/${y}`;
}

// Collapses a supplier breakdown (already sorted by the ranking metric, descending)
// down to the top N entries plus a single "Others" bucket summing the rest —
// used by both the Dashboard breakdown pie and the Analytics breakdown.
function groupTopNWithOthers(rows, n = 10) {
  if (rows.length <= n) return rows;
  const top = rows.slice(0, n);
  const rest = rows.slice(n);
  const others = {
    supplier_name: 'Others',
    count: rest.reduce((s, r) => s + (r.count || 0), 0),
    amount: rest.reduce((s, r) => s + (r.amount || 0), 0)
  };
  return [...top, others];
}

module.exports = { requireAuth, requireAdmin, nextTransactionNumber, logActivity, pushNotification, formatDateMDY, groupTopNWithOthers };
