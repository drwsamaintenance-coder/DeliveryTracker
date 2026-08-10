const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { db } = require('../db/init');
const { requireAuth, requireAdmin, nextTransactionNumber, logActivity, pushNotification, formatDateMDY } = require('./utils');
const { buildDeliveryReportSheet } = require('./xlsxTemplate');

const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname))
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPEG/PNG photos are allowed.'), ok);
  }
});

// ---------------------------------------------------------------------------
// Firestore data model note: each transaction is ONE document in the
// `transactions` collection, with its line items embedded as an `items`
// array field (rather than a separate table/collection) — they're always
// read and written together, so this avoids extra round-trips.
//
// Firestore can't do SQL-style JOINs, GROUP BY, or substring (LIKE) search,
// so — as documented in db/init.js and the earlier chat summary — most
// endpoints below fetch the full `transactions` collection once and do the
// filtering/sorting/grouping in plain JavaScript. That's the right call for
// a small association's delivery records (hundreds–low thousands of rows,
// not millions) and it means nobody ever has to create a Firestore
// "composite index" by hand to keep this app working.
// ---------------------------------------------------------------------------

async function getVerificationPassword() {
  const snap = await db.collection('settings').doc('verification_password').get();
  return snap.exists && snap.data().value ? snap.data().value : 'drwsa2026';
}

function toTransactionJSON(doc, creatorName, removerName) {
  const t = doc.data();
  return {
    id: doc.id,
    transaction_number: t.transaction_number,
    date: t.date,
    supplier_name: t.supplier_name,
    ctrl_numbers: t.ctrl_numbers,
    total_amount: t.total_amount,
    remarks: t.remarks,
    received_by: t.received_by,
    created_by: t.created_by,
    created_at: t.created_at,
    updated_at: t.updated_at,
    removed: !!t.removed,
    removed_reason: t.removed_reason || null,
    removed_by: t.removed_by || null,
    removed_at: t.removed_at || null,
    items: t.items || [],
    created_by_name: creatorName || null,
    removed_by_name: removerName || null
  };
}

async function fullTransaction(id) {
  const doc = await db.collection('transactions').doc(id).get();
  if (!doc.exists) return null;
  const t = doc.data();
  const creator = t.created_by ? await db.collection('users').doc(t.created_by).get() : null;
  const remover = t.removed_by ? await db.collection('users').doc(t.removed_by).get() : null;
  return toTransactionJSON(doc, creator && creator.exists ? creator.data().name : null, remover && remover.exists ? remover.data().name : null);
}

// Every transaction document, as plain {id, ...fields} objects — the shared
// starting point for listing, search, exports, and analytics below.
async function getAllTransactions() {
  const snap = await db.collection('transactions').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data(), items: d.data().items || [] }));
}

// Find an existing transaction that shares the supplier AND at least one CTRL number
// (used to auto-merge new/edited rows into an already-saved transaction instead of duplicating it)
async function findMergeCandidate(supplierName, ctrlSet, excludeId) {
  if (!ctrlSet.length) return null;
  const all = await getAllTransactions();
  const lowerCtrlSet = ctrlSet.map(c => c.toLowerCase());
  for (const c of all) {
    if (c.removed) continue;
    if (excludeId && c.id === excludeId) continue;
    if ((c.supplier_name || '').toLowerCase() !== (supplierName || '').toLowerCase()) continue;
    const existingCtrls = (c.ctrl_numbers || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (lowerCtrlSet.some(cn => existingCtrls.includes(cn))) return c;
  }
  return null;
}

// ---------- Autosuggest / autofill data, built from transaction history ----------
router.get('/suggestions', requireAuth, async (req, res) => {
  try {
    const all = await getAllTransactions();
    // Most-recently-created first, so "the last unit/price used for this item"
    // and "the last date/supplier/received-by used for this CTRL number" match
    // what the old `ORDER BY t.id DESC` gave us.
    all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    const suppliers = [...new Set(all.map(t => t.supplier_name))].sort();
    const ctrlNumbersSet = new Set();
    const itemsSet = new Set();
    const remarksSet = new Set();
    const receivedSet = new Set();
    const itemDefaults = {};
    const ctrlDefaults = {};

    all.forEach(t => {
      if (t.remarks) remarksSet.add(t.remarks);
      if (t.received_by) receivedSet.add(t.received_by);
      (t.ctrl_numbers || '').split(',').map(s => s.trim()).filter(Boolean).forEach(cn => {
        ctrlNumbersSet.add(cn);
        const key = cn.toLowerCase();
        if (!ctrlDefaults[key]) {
          ctrlDefaults[key] = { date: t.date, supplier_name: t.supplier_name, received_by: t.received_by, remarks: t.remarks };
        }
      });
      (t.items || []).forEach(it => {
        itemsSet.add(it.item_name);
        const key = it.item_name.trim().toLowerCase();
        if (!itemDefaults[key]) itemDefaults[key] = { unit: it.unit, price: it.price_per_unit };
      });
    });

    const recentDates = [...new Set(all.map(t => t.date))].sort().reverse().slice(0, 15);

    res.json({
      suppliers,
      ctrlNumbers: [...ctrlNumbersSet],
      items: [...itemsSet].sort(),
      remarks: [...remarksSet],
      receivedBy: [...receivedSet],
      recentDates,
      itemDefaults,
      ctrlDefaults
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load suggestions.' });
  }
});

// ---------------------------------------------------------------------------
// Double-submit protection for report creation.
//
// The report page already disables its Submit button on the first click (see
// public/report.html), which is the main fix for "double-clicking submits it
// twice". These two extra layers exist as defense-in-depth for the case that
// motivated this: a laggy connection where the button-disable JS is slow to
// run, a stray double network request gets through, or a second submit lands
// before the first one has finished writing to the database:
//
// 1. `submissionQueue` serializes every POST here into one at a time, in a
//    single Node process. Without this, two near-simultaneous requests for
//    the same supplier + CTRL number could both read "no existing match" from
//    Firestore before either had written its new transaction, and both would
//    create separate transactions instead of the second one merging into the
//    first. Serializing means the second request's merge-lookup always sees
//    the first request's already-committed write.
// 2. `recentSubmissions` recognizes an exact repeat of the same submission
//    (same idempotency key, sent once per Submit click from the browser) and
//    returns the original result instead of saving it again.
// ---------------------------------------------------------------------------
let submissionQueue = Promise.resolve();
function runSerialized(fn) {
  const result = submissionQueue.then(fn, fn);
  // Swallow rejections here so one failed submission doesn't jam the queue for
  // everyone after it — the caller still gets the real error via `result`.
  submissionQueue = result.then(() => {}, () => {});
  return result;
}

const recentSubmissions = new Map(); // idempotency_key -> { at, transactions }
const IDEMPOTENCY_TTL_MS = 2 * 60 * 1000; // 2 minutes is plenty for a duplicate double-click/retry
function rememberSubmission(key, transactions) {
  if (!key) return;
  recentSubmissions.set(key, { at: Date.now(), transactions });
  // Opportunistic cleanup so this map never grows unbounded.
  for (const [k, v] of recentSubmissions) {
    if (Date.now() - v.at > IDEMPOTENCY_TTL_MS) recentSubmissions.delete(k);
  }
}

// Create transaction(s) from a report submission (array of rows)
// Rows sharing the same supplier are grouped into one transaction number.
// If the supplier + a CTRL number already matches a transaction on file, the rows are
// merged into that existing transaction instead of creating a duplicate.
// NOTE: the report page sends each row's photo under its own field name
// (photo_0, photo_1, ...) rather than a single repeated 'photos' field, so
// this must accept any field name (upload.any()) — upload.array('photos')
// silently rejected the request with "Unexpected field" whenever a photo
// was attached, which is what caused "Request failed" on submit.
router.post('/', requireAuth, upload.any(), async (req, res) => {
  let rows;
  try {
    rows = JSON.parse(req.body.rows || '[]');
  } catch (e) {
    return res.status(400).json({ error: 'Invalid rows payload.' });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'At least one item row is required.' });
  }

  const idempotencyKey = req.body.idempotency_key || null;
  const cached = idempotencyKey ? recentSubmissions.get(idempotencyKey) : null;
  if (cached && Date.now() - cached.at < IDEMPOTENCY_TTL_MS) {
    // Exact same submit attempt as one we already saved — hand back the same
    // result instead of creating duplicate transactions.
    return res.status(201).json({ transactions: cached.transactions });
  }

  try {
    return await runSerialized(() => handleTransactionSubmit(req, res, rows, idempotencyKey));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to save transaction(s).' });
  }
});

async function handleTransactionSubmit(req, res, rows, idempotencyKey) {
  try {
    const filesByIndex = {};
    (req.files || []).forEach(f => {
      const m = f.fieldname.match(/photo_(\d+)/);
      if (m) filesByIndex[m[1]] = '/uploads/' + f.filename;
    });

    const groups = {};
    rows.forEach((row, idx) => {
      // The report page's bulk-entry UI sends one client_block id per transaction
      // block. Group on that when present so two blocks for the same supplier in
      // one submission stay as separate transactions; only fall back to grouping
      // by supplier name for older callers that don't send a block id.
      const key = row.client_block || (row.supplier_name || '').trim().toLowerCase();
      if (!groups[key]) groups[key] = { supplier_name: row.supplier_name, date: row.date, rows: [] };
      groups[key].rows.push({ ...row, _photo: filesByIndex[idx] || row.photo_path || null });
    });

    const resultTransactions = [];
    const nowIso = new Date().toISOString();

    for (const key of Object.keys(groups)) {
      const g = groups[key];
      const ctrlSet = [...new Set(g.rows.map(r => (r.ctrl_number || '').trim()).filter(Boolean))];
      const groupTotal = g.rows.reduce((sum, r) => sum + (parseFloat(r.total_amount) || (parseFloat(r.quantity) * parseFloat(r.price))), 0);
      const remarksSet = [...new Set(g.rows.map(r => r.remarks).filter(Boolean))];
      const receivedSet = [...new Set(g.rows.map(r => r.received_by).filter(Boolean))];
      const newItems = g.rows.map(r => ({
        ctrl_number: r.ctrl_number || null,
        item_name: r.item_name,
        quantity: parseFloat(r.quantity) || 0,
        unit: r.unit || null,
        price_per_unit: parseFloat(r.price) || 0,
        total_amount: parseFloat(r.total_amount) || ((parseFloat(r.quantity) || 0) * (parseFloat(r.price) || 0)),
        photo_path: r._photo
      }));

      const merge = await findMergeCandidate(g.supplier_name, ctrlSet, null);
      let transactionId, transactionNumber, isNew;

      if (merge) {
        transactionId = merge.id;
        transactionNumber = merge.transaction_number;
        isNew = false;
        const mergedCtrls = [...new Set([...(merge.ctrl_numbers || '').split(',').map(s => s.trim()).filter(Boolean), ...ctrlSet])];
        const mergedRemarks = [...new Set([merge.remarks, ...remarksSet].filter(Boolean))];
        const mergedReceived = [...new Set([merge.received_by, ...receivedSet].filter(Boolean))];
        await db.collection('transactions').doc(transactionId).update({
          ctrl_numbers: mergedCtrls.join(', '),
          total_amount: merge.total_amount + groupTotal,
          remarks: mergedRemarks.join('; '),
          received_by: mergedReceived.join(', '),
          items: [...(merge.items || []), ...newItems],
          updated_at: nowIso
        });
      } else {
        transactionNumber = await nextTransactionNumber();
        const doc = {
          transaction_number: transactionNumber,
          date: g.date || g.rows[0].date,
          supplier_name: g.supplier_name,
          ctrl_numbers: ctrlSet.join(', '),
          total_amount: groupTotal,
          remarks: remarksSet.join('; '),
          received_by: receivedSet.join(', ') || req.user.name,
          created_by: req.user.id,
          created_at: nowIso,
          updated_at: nowIso,
          removed: false,
          removed_reason: null,
          removed_by: null,
          removed_at: null,
          items: newItems
        };
        const ref = await db.collection('transactions').add(doc);
        transactionId = ref.id;
        isNew = true;
      }

      await logActivity(req.user.id, isNew ? 'submitted' : 'merged', transactionNumber);
      await pushNotification(req.user.name,
        isNew ? `${req.user.name} added transaction ${transactionNumber}` : `${req.user.name} added items to existing transaction ${transactionNumber}`,
        transactionNumber, transactionId);
      resultTransactions.push(await fullTransaction(transactionId));
    }

    rememberSubmission(idempotencyKey, resultTransactions);
    res.status(201).json({ transactions: resultTransactions });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save transaction(s).' });
  }
}

// Applies the Catalog page's filters (search box, transaction number, ctrl
// number, supplier, date range) to an already-fetched array of transactions.
// Firestore can't do substring (LIKE) search server-side, so this is done
// here in JS against the full in-memory list — see the note at the top of
// this file for why that's the right tradeoff for this app's data size.
function applyFilters(all, { q, search, transactionNumber, ctrl, supplier, from, to }) {
  const lc = (v) => String(v || '').toLowerCase();
  return all.filter(t => {
    if (q) {
      const needle = lc(q);
      const matches = lc(t.supplier_name).includes(needle) ||
        lc(t.ctrl_numbers).includes(needle) ||
        lc(t.transaction_number).includes(needle) ||
        (t.items || []).some(it => lc(it.item_name).includes(needle));
      if (!matches) return false;
    }
    if (search && !(t.items || []).some(it => lc(it.item_name).includes(lc(search)))) return false;
    if (transactionNumber && !lc(t.transaction_number).includes(lc(transactionNumber))) return false;
    if (ctrl && !lc(t.ctrl_numbers).includes(lc(ctrl))) return false;
    if (supplier && !lc(t.supplier_name).includes(lc(supplier))) return false;
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    return true;
  });
}

// List / search / filter with pagination (20 per page)
// `q` is the single combined search box: matches supplier, ctrl number, item, or transaction number
router.get('/', requireAuth, async (req, res) => {
  try {
    const { page } = req.query;
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const pageSize = 20;

    const all = await getAllTransactions();
    const filtered = applyFilters(all, req.query);
    // Newest-created first, matching the old `ORDER BY t.id DESC`.
    filtered.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    const total = filtered.length;
    const start = (pageNum - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize).map(t => {
      const { items, ...rest } = t; // the flat catalog list doesn't need line items
      return rest;
    });

    res.json({
      page: pageNum, pageSize, total,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
      data: pageRows
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load transactions.' });
  }
});

// Builds a human-readable "Report Scope" line from the Catalog page's active
// filters, so every filtered export states in plain words how it was
// generated (e.g. "Filtered by Supplier: Melecio Trading | Date Range:
// 04/01/2026 – 07/24/2026") instead of leaving the reader to guess.
function buildScopeText({ q, from, to, resultCount, supplierScope }) {
  const parts = [];
  if (supplierScope) parts.push(`Supplier: ${supplierScope}`);
  else if (q) parts.push(`Search: "${q}"`);
  if (from || to) {
    parts.push(`Date Range: ${from ? formatDateMDY(from) : 'START'} – ${to ? formatDateMDY(to) : 'PRESENT'}`);
  }
  const scope = parts.length ? `Filtered by ${parts.join(' | ')}` : 'All Transactions (no filters applied)';
  return `Report Scope: ${scope} — ${resultCount} transaction${resultCount === 1 ? '' : 's'}`;
}

router.get('/export/xlsx', requireAuth, async (req, res) => {
  try {
    const { q, from, to, supplier } = req.query;
    const all = await getAllTransactions();
    const transactions = applyFilters(all.filter(t => !t.removed), req.query);
    // Always sorted by Transaction Date first, then Transaction Number as the
    // tie-breaker for same-day transactions — never by supplier.
    transactions.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.transaction_number || '').localeCompare(b.transaction_number || ''));

    // If every result belongs to one supplier (explicit supplier filter, or
    // just happens to be true of this search/date range), scope the report
    // and its analytics panel to that supplier.
    const uniqueSuppliers = [...new Set(transactions.map(t => t.supplier_name))];
    const supplierScope = supplier ? (uniqueSuppliers[0] || supplier) : (uniqueSuppliers.length === 1 ? uniqueSuppliers[0] : null);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'DRWSA Maintenance';
    await buildDeliveryReportSheet(wb, {
      sheetName: 'Transactions',
      fileNameLabel: 'DRWSA_TRANSACTIONS.xlsx',
      bigTitleParts: supplierScope
        ? [{ text: 'DELIVERY REPORT — ' }, { text: supplierScope.toUpperCase(), highlight: true }]
        : [{ text: 'TRANSACTION HISTORY REPORT' }],
      subHeadingText: buildScopeText({ q, from, to, resultCount: transactions.length, supplierScope }),
      transactions,
      supplierScope
    });

    res.setHeader('Content-Disposition', 'attachment; filename="DRWSA_Transactions.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate the transactions export.' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const t = await fullTransaction(req.params.id);
    if (!t) return res.status(404).json({ error: 'Transaction not found.' });
    res.json(t);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load that transaction.' });
  }
});

router.get('/:id/export/xlsx', requireAuth, async (req, res) => {
  try {
    const t = await fullTransaction(req.params.id);
    if (!t) return res.status(404).json({ error: 'Transaction not found.' });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'DRWSA Maintenance';
    await buildDeliveryReportSheet(wb, {
      sheetName: t.transaction_number,
      fileNameLabel: `${t.transaction_number}.xlsx`,
      bigTitleParts: [{ text: 'DELIVERY REPORT — ' }, { text: t.transaction_number, highlight: true }],
      subHeadingText: `Report Scope: Single Transaction ${t.transaction_number} — Supplier: ${t.supplier_name}`,
      transactions: [t],
      supplierScope: t.supplier_name
    });

    res.setHeader('Content-Disposition', `attachment; filename="${t.transaction_number}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate the transaction export.' });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { verificationPassword, date, supplier_name, ctrl_numbers, remarks, received_by, items } = req.body;
    if (verificationPassword !== (await getVerificationPassword())) {
      return res.status(403).json({ error: 'Incorrect verification password.' });
    }
    const existingSnap = await db.collection('transactions').doc(req.params.id).get();
    if (!existingSnap.exists) return res.status(404).json({ error: 'Transaction not found.' });
    const existing = { id: existingSnap.id, ...existingSnap.data() };
    if (existing.removed) return res.status(400).json({ error: 'This transaction has been removed and can no longer be edited.' });

    const nowIso = new Date().toISOString();
    let total = existing.total_amount;
    let newItems = existing.items || [];
    if (Array.isArray(items)) {
      total = 0;
      newItems = items.map(it => {
        const lineTotal = (parseFloat(it.quantity) || 0) * (parseFloat(it.price_per_unit) || 0);
        total += lineTotal;
        return {
          ctrl_number: it.ctrl_number || null, item_name: it.item_name,
          quantity: parseFloat(it.quantity) || 0, unit: it.unit || null,
          price_per_unit: parseFloat(it.price_per_unit) || 0, total_amount: lineTotal,
          photo_path: it.photo_path || null
        };
      });
    }

    const newDate = date || existing.date;
    const newSupplier = supplier_name || existing.supplier_name;
    // Prefer an explicit ctrl_numbers override; otherwise, if items were edited,
    // derive it from the items' own CTRL numbers so an edit to an item's CTRL
    // number (not just the supplier name) can also trigger a merge below.
    let newCtrlNumbers = ctrl_numbers || existing.ctrl_numbers;
    if (!ctrl_numbers && Array.isArray(items)) {
      const derived = [...new Set(items.map(it => (it.ctrl_number || '').trim()).filter(Boolean))];
      if (derived.length) newCtrlNumbers = derived.join(', ');
    }
    const newRemarks = remarks ?? existing.remarks;
    const newReceivedBy = received_by ?? existing.received_by;

    await db.collection('transactions').doc(req.params.id).update({
      date: newDate, supplier_name: newSupplier, ctrl_numbers: newCtrlNumbers,
      remarks: newRemarks, received_by: newReceivedBy, total_amount: total,
      items: newItems, updated_at: nowIso
    });
    await logActivity(req.user.id, 'edited', existing.transaction_number);
    await pushNotification(req.user.name, `${req.user.name} edited transaction ${existing.transaction_number}`, existing.transaction_number, existing.id);

    const ctrlSet = newCtrlNumbers.split(',').map(s => s.trim()).filter(Boolean);
    const merge = await findMergeCandidate(newSupplier, ctrlSet, existing.id);
    let finalId = req.params.id;

    if (merge) {
      const mergedCtrls = [...new Set([...(merge.ctrl_numbers || '').split(',').map(s => s.trim()).filter(Boolean), ...ctrlSet])];
      const mergedRemarks = [...new Set([merge.remarks, newRemarks].filter(Boolean))];
      const mergedReceived = [...new Set([merge.received_by, newReceivedBy].filter(Boolean))];
      await db.collection('transactions').doc(merge.id).update({
        ctrl_numbers: mergedCtrls.join(', '),
        total_amount: merge.total_amount + total,
        remarks: mergedRemarks.join('; '),
        received_by: mergedReceived.join(', '),
        items: [...(merge.items || []), ...newItems],
        updated_at: nowIso
      });
      await db.collection('transactions').doc(req.params.id).delete();
      await logActivity(req.user.id, 'merged', merge.transaction_number);
      await pushNotification(req.user.name, `${req.user.name} merged transaction ${existing.transaction_number} into ${merge.transaction_number}`, merge.transaction_number, merge.id);
      finalId = merge.id;
    }

    res.json(await fullTransaction(finalId));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update transaction.' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { verificationPassword, reason } = req.body;
    if (verificationPassword !== (await getVerificationPassword())) {
      return res.status(403).json({ error: 'Incorrect verification password.' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A reason is required to remove a transaction.' });
    }
    const existingSnap = await db.collection('transactions').doc(req.params.id).get();
    if (!existingSnap.exists) return res.status(404).json({ error: 'Transaction not found.' });
    const existing = existingSnap.data();
    if (existing.removed) return res.status(400).json({ error: 'This transaction has already been removed.' });

    const nowIso = new Date().toISOString();
    await db.collection('transactions').doc(req.params.id).update({
      removed: true, removed_reason: reason.trim(), removed_by: req.user.id, removed_at: nowIso
    });
    await logActivity(req.user.id, 'deleted', existing.transaction_number);
    await pushNotification(req.user.name, `${req.user.name} removed transaction ${existing.transaction_number} (${reason.trim()})`, existing.transaction_number, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to remove transaction.' });
  }
});

// ---------------------------------------------------------------------------
// Admin-only, irreversible "fresh start": permanently deletes every
// transaction/report on file and resets the transaction-number counter back
// to 0 (so the next report starts again at DRWSA01). Gated behind three
// separate checks since there is no undo:
//   1. requireAdmin — only an admin account can call this at all
//   2. the same shared verification password used for editing/removing a
//      single transaction (Settings > Verification Password)
//   3. the caller must send the literal confirmation phrase "DELETE ALL
//      DATA", which the UI only sends after the admin types it out and
//      clicks through a native confirm() dialog — makes an accidental or
//      scripted call essentially impossible.
// ---------------------------------------------------------------------------
router.post('/clear-all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { verificationPassword, confirmPhrase } = req.body;
    if (verificationPassword !== (await getVerificationPassword())) {
      return res.status(403).json({ error: 'Incorrect verification password.' });
    }
    if (confirmPhrase !== 'DELETE ALL DATA') {
      return res.status(400).json({ error: 'Confirmation phrase did not match. Nothing was deleted.' });
    }

    const snap = await db.collection('transactions').get();
    const docs = snap.docs;

    // Firestore batches cap out at 500 writes, so chunk the deletes.
    const CHUNK = 450;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = db.batch();
      docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    // Reset the transaction-number counter so the next report starts fresh at DRWSA01.
    await db.collection('meta').doc('counters').set({ transactionSeq: 0 }, { merge: true });

    await logActivity(req.user.id, 'cleared_all_data', `${docs.length} transaction(s)`);
    await pushNotification(req.user.name, `${req.user.name} deleted ALL transaction data (${docs.length} transactions) for a fresh start.`, null, null);

    res.json({ ok: true, deletedCount: docs.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to clear transaction data.' });
  }
});

module.exports = router;
