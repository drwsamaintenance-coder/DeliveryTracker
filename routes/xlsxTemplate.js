const fs = require('fs');
const path = require('path');
const { db } = require('../db/init');
const { formatDateMDY, groupTopNWithOthers } = require('./utils');
const { getAllTransactions } = require('./dataAccess');

const UPLOADS_DIR = path.join(__dirname, '../public/uploads');
// The logo that appears in the header of every generated XLSX file (delivery
// reports, catalog exports, supplier list, executive analytics report) — kept
// deliberately separate from the *system* logo (settings.js / logo_path,
// shown on the login page and sidebar). Admins can change this one from the
// "XLSX Report Logo" control on the About Us page; until they do, it falls
// back to the association's official seal bundled with the app.
const DEFAULT_XLSX_LOGO_PATH = path.join(UPLOADS_DIR, 'xlsx-logo-official.png');

// Resolves the currently-configured XLSX header logo to an absolute file path
// on disk, ready to hand to ExcelJS's addImage(). Every report-building
// function below calls this once per export so a logo change takes effect on
// the very next download, with no code changes needed elsewhere.
async function getXlsxLogoPath() {
  try {
    const snap = await db.collection('settings').doc('xlsx_logo_path').get();
    if (snap.exists) {
      const { value: url, data } = snap.data();
      if (url) {
        const rel = url.replace(/^\/?uploads\//, '');
        const abs = path.join(UPLOADS_DIR, rel);
        // Ephemeral hosts (e.g. Render) wipe local disk on every
        // redeploy/restart, so the file this Firestore doc points to may no
        // longer physically exist even though the doc itself is fine. If we
        // still have the base64 bytes on the doc, rebuild the file on the
        // spot before handing the path to ExcelJS.
        if (!fs.existsSync(abs) && data) {
          try { fs.writeFileSync(abs, Buffer.from(data, 'base64')); } catch (e) { /* fall through */ }
        }
        if (fs.existsSync(abs)) return abs;
      }
    }
  } catch (e) { /* fall through to the bundled default */ }
  return fs.existsSync(DEFAULT_XLSX_LOGO_PATH) ? DEFAULT_XLSX_LOGO_PATH : null;
}

const NAVY = 'FF1C3B6E';
const LIGHTBLUE = 'FFDCEBF7';
const GREY = 'FFF4F4F6';
const ZEBRA = 'FFEDEFF2';
const WHITE = 'FFFFFFFF';
const TOTAL_BLUE = 'FF2F6FED';
const GOLD = 'FFC08A2E';
const FONT_NAME = 'Times New Roman';

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFB9BEC7' } },
  left: { style: 'thin', color: { argb: 'FFB9BEC7' } },
  bottom: { style: 'thin', color: { argb: 'FFB9BEC7' } },
  right: { style: 'thin', color: { argb: 'FFB9BEC7' } }
};

function peso(n) {
  return `₱ ${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Every filled cell goes through here so the whole workbook shares one font family.
function fillCell(cell, color, opts = {}) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  cell.alignment = { vertical: 'middle', horizontal: opts.align || 'left', wrapText: !!opts.wrap };
  cell.font = { name: FONT_NAME, bold: !!opts.bold, color: { argb: opts.color || 'FF1c1c1e' }, size: opts.size };
  if (opts.border) cell.border = THIN_BORDER;
}

// For plain (unfilled) data cells — still needs the shared font applied explicitly,
// since ExcelJS has no workbook-wide default font setter.
function setVal(cell, value, opts = {}) {
  cell.value = value;
  cell.font = { name: FONT_NAME, bold: !!opts.bold, color: { argb: opts.color || 'FF1c1c1e' }, size: opts.size };
  cell.alignment = { horizontal: opts.align || 'left', vertical: 'middle' };
  if (opts.numFmt) cell.numFmt = opts.numFmt;
  if (opts.border !== false) cell.border = THIN_BORDER;
}

// Draws a border around the OUTSIDE of a rectangular range only (no interior
// gridlines) — used to frame the Spend-by-Supplier / Monthly-Trend side panel
// blocks without boxing every individual cell.
function applyOuterBorder(ws, startRow, endRow, startCol, endCol) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = ws.getCell(r, c);
      const border = { ...(cell.border || {}) };
      const side = { style: 'medium', color: { argb: NAVY } };
      if (r === startRow) border.top = side;
      if (r === endRow) border.bottom = side;
      if (c === startCol) border.left = side;
      if (c === endCol) border.right = side;
      cell.border = border;
    }
  }
}

// Adds the association's letterhead (logo + name/address, file-name bar, big
// title) to the top of a worksheet. Column A holds the logo — sized larger
// (≈2.0in x 2.0in, ≈192 x 192px @96dpi) so it reads clearly even printed —
// and the company-name text (B:lastCol) is left-aligned right up against it,
// so logo and text form one connected letterhead block instead of the logo
// sitting isolated on the far left with the text centered away from it.
function applyLetterhead(wb, ws, { fileNameLabel, bigTitleParts, subHeadingText, lastCol = 'H', logoPath }) {
  const ROW_H = 38; // pt per header row; 4 rows ≈ 152pt (~203px), enough to hold the 192px-tall logo
  [1, 2, 3, 4].forEach(r => { ws.getRow(r).height = ROW_H; });
  ['A1', 'A2', 'A3', 'A4'].forEach(addr => fillCell(ws.getCell(addr), NAVY, {}));

  ws.mergeCells(`B1:${lastCol}4`);
  const headerCell = ws.getCell('B1');
  headerCell.value = 'DARASA RURAL WATERWORKS & SANITATION ASSOCIATION, INC.\n'
    + 'Pres. Laurel Highway, 907 Brgy. Darasa - Tanauan City\n'
    + 'Tel. / (043) 778-7219 / 0922-3490292\n'
    + 'Email address: darasaruralwaterworksa@yahoo.com';
  fillCell(headerCell, NAVY, { align: 'left', wrap: true, color: WHITE });
  headerCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
  headerCell.font = { name: FONT_NAME, bold: true, size: 13, color: { argb: WHITE } };

  // `logoPath` is the caller-resolved XLSX header logo (see getXlsxLogoPath()
  // above) — falls back to the bundled default if a caller doesn't pass one.
  const resolvedLogoPath = logoPath || DEFAULT_XLSX_LOGO_PATH;
  if (resolvedLogoPath && fs.existsSync(resolvedLogoPath)) {
    try {
      const ext = path.extname(resolvedLogoPath).replace('.', '').toLowerCase();
      const imgId = wb.addImage({ filename: resolvedLogoPath, extension: ext === 'jpg' ? 'jpeg' : ext });
      // ≈192 x 192px — column A is widened to just fit it (with a small
      // margin) so its right edge sits flush against the header text in
      // column B, reading as one letterhead unit rather than two separate
      // elements.
      ws.addImage(imgId, { tl: { col: 0.05, row: 0.06 }, ext: { width: 192, height: 192 } });
    } catch (e) { /* logo embed is best-effort; report still generates without it */ }
  }
  ws.getColumn(1).width = Math.max(ws.getColumn(1).width || 0, 28);

  ws.mergeCells(`A5:${lastCol}5`);
  const titleBar = ws.getCell('A5');
  titleBar.value = fileNameLabel;
  fillCell(titleBar, LIGHTBLUE, { align: 'center', bold: true, color: NAVY, size: 10 });
  ws.getRow(5).height = 16;

  ws.mergeCells(`A6:${lastCol}7`);
  const bigTitle = ws.getCell('A6');
  bigTitle.value = {
    richText: (bigTitleParts || [{ text: fileNameLabel }]).map(p => ({
      font: { name: FONT_NAME, size: 18, bold: true, color: { argb: p.highlight ? GOLD : NAVY } },
      text: p.text
    }))
  };
  bigTitle.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(6).height = 22; ws.getRow(7).height = 22;

  // Sub-heading: states in plain words what scope/filters produced this report
  // (e.g. "Filtered by Supplier: Melecio Trading" or "All Transactions"), so
  // the reader always knows exactly how the numbers below were generated.
  ws.mergeCells(`A8:${lastCol}8`);
  const subCell = ws.getCell('A8');
  subCell.value = subHeadingText || '';
  fillCell(subCell, GREY, { align: 'center' });
  subCell.font = { name: FONT_NAME, italic: true, bold: true, size: 10, color: { argb: 'FF555555' } };
  ws.getRow(8).height = 15;

  return 10; // first free row for the caller's own content
}

function styleTableHeaderRow(ws, row, colCount) {
  for (let c = 1; c <= colCount; c++) {
    fillCell(ws.getCell(row, c), NAVY, { bold: true, color: WHITE, align: 'center', border: true });
  }
}

// All-time overview stats (independent of whatever's filtered into the item
// table below) — Total Transactions / Total Delivery Cost / Total Suppliers,
// plus the last-4-months trend. Shared by every report so the KPI panel always
// reads the same regardless of what's being exported.
async function computeOverviewStats() {
  const now = new Date();
  const all = (await getAllTransactions()).filter(t => !t.removed);
  const totalTransactions = all.length;
  const totalSuppliers = new Set(all.map(t => t.supplier_name)).size;
  const totalDeliveryCost = all.reduce((s, t) => s + (t.total_amount || 0), 0);

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const trend = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    const prefix = `${y}-${String(m).padStart(2, '0')}`;
    const monthTxns = all.filter(t => (t.date || '').startsWith(prefix));
    const qty = monthTxns.reduce((s, t) => s + (t.items || []).reduce((s2, it) => s2 + (it.quantity || 0), 0), 0);
    const amount = monthTxns.reduce((s, t) => s + (t.total_amount || 0), 0);
    trend.push({ label: `${MONTH_NAMES[m - 1]} ${y}`, qty, amount });
  }
  return { totalTransactions, totalSuppliers, totalDeliveryCost, trend };
}

// All-time spend-by-supplier breakdown, top 5 + Others.
async function computeSupplierBreakdown() {
  const all = (await getAllTransactions()).filter(t => !t.removed);
  const bySupplier = {};
  all.forEach(t => {
    bySupplier[t.supplier_name] = (bySupplier[t.supplier_name] || 0) + (t.total_amount || 0);
  });
  const rows = Object.entries(bySupplier)
    .map(([supplier_name, amount]) => ({ supplier_name, amount }))
    .sort((a, b) => b.amount - a.amount);
  const top5 = rows.slice(0, 5);
  const othersAmount = rows.slice(5).reduce((s, r) => s + r.amount, 0);
  const overallTotal = rows.reduce((s, r) => s + r.amount, 0) || 1;
  return { top5, othersAmount, overallTotal };
}

// All-time material breakdown for ONE supplier, top 5 + Others by amount spent —
// used in place of the supplier breakdown whenever a report is scoped to a
// single supplier (so the panel shows what was actually bought from them,
// which is more useful than "100% Supplier X" repeated on its own).
async function computeMaterialBreakdown(supplierName) {
  const all = (await getAllTransactions()).filter(t => !t.removed && t.supplier_name === supplierName);
  const byMaterial = {};
  all.forEach(t => {
    (t.items || []).forEach(it => {
      byMaterial[it.item_name] = (byMaterial[it.item_name] || 0) + (it.total_amount || 0);
    });
  });
  const rows = Object.entries(byMaterial)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
  const top5 = rows.slice(0, 5);
  const othersAmount = rows.slice(5).reduce((s, r) => s + r.amount, 0);
  const overallTotal = rows.reduce((s, r) => s + r.amount, 0) || 1;
  return { top5, othersAmount, overallTotal };
}

const MONTH_NAMES_SHORT = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------------------
// SCOPED analytics-panel helpers — unlike computeOverviewStats() /
// computeSupplierBreakdown() / computeMaterialBreakdown() above (which always
// re-query every transaction on file, ignoring whatever filter produced this
// report), these compute strictly from the `transactions` array the caller is
// actually exporting. That way, when someone filters the Catalog/Monthly
// report down to one supplier, a date range, or a search, the right-hand
// "Analytics & Statistic Overview" and "Spend by Supplier (Top 5)" panels
// reflect only the transactions and suppliers in that filtered scope — not
// the whole association's history.
// ---------------------------------------------------------------------------

// Totals + a monthly trend, computed only from the transactions in scope.
function computeScopedOverviewStats(transactions) {
  const totalTransactions = transactions.length;
  const totalSuppliers = new Set(transactions.map(t => t.supplier_name)).size;
  const totalDeliveryCost = transactions.reduce((s, t) => s + (t.total_amount || 0), 0);

  const byMonth = {};
  transactions.forEach(t => {
    const month = (t.date || '').slice(0, 7); // YYYY-MM
    if (!month) return;
    if (!byMonth[month]) byMonth[month] = { qty: 0, amount: 0 };
    byMonth[month].qty += (t.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
    byMonth[month].amount += t.total_amount || 0;
  });
  // Show up to the most recent 4 months that actually have data in this scope
  // (rather than always "the last 4 calendar months from today", which would
  // be meaningless for a report scoped to a past date range).
  const monthKeys = Object.keys(byMonth).sort();
  const shown = monthKeys.slice(-4);
  const trend = shown.map(key => {
    const [y, m] = key.split('-');
    return { label: `${MONTH_NAMES_SHORT[Number(m) - 1]} ${y}`, qty: byMonth[key].qty, amount: byMonth[key].amount };
  });

  return { totalTransactions, totalSuppliers, totalDeliveryCost, trend };
}

// Spend-by-supplier breakdown (top 5 + Others), computed only from the
// transactions in scope.
function computeScopedSupplierBreakdown(transactions) {
  const bySupplier = {};
  transactions.forEach(t => {
    bySupplier[t.supplier_name] = (bySupplier[t.supplier_name] || 0) + (t.total_amount || 0);
  });
  const rows = Object.entries(bySupplier)
    .map(([supplier_name, amount]) => ({ supplier_name, amount }))
    .sort((a, b) => b.amount - a.amount);
  const top5 = rows.slice(0, 5);
  const othersAmount = rows.slice(5).reduce((s, r) => s + r.amount, 0);
  const overallTotal = rows.reduce((s, r) => s + r.amount, 0) || 1;
  return { top5, othersAmount, overallTotal };
}

// Material breakdown for ONE supplier (top 5 + Others), computed only from
// the transactions in scope (e.g. already narrowed to a date range).
function computeScopedMaterialBreakdown(transactions, supplierName) {
  const byMaterial = {};
  transactions.filter(t => t.supplier_name === supplierName).forEach(t => {
    (t.items || []).forEach(it => {
      byMaterial[it.item_name] = (byMaterial[it.item_name] || 0) + (it.total_amount || 0);
    });
  });
  const rows = Object.entries(byMaterial)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
  const top5 = rows.slice(0, 5);
  const othersAmount = rows.slice(5).reduce((s, r) => s + r.amount, 0);
  const overallTotal = rows.reduce((s, r) => s + r.amount, 0) || 1;
  return { top5, othersAmount, overallTotal };
}

// Builds the shared DRWSA "Delivery Report" worksheet: letterhead, sub-heading
// scope line, grand total card, per-supplier delivery blocks grouped from
// `transactions` (each already carrying its own `.items`), and a right-hand
// analytics panel. Used by the Monthly Report, the Catalog's filtered XLSX
// export, and the single-transaction export, so they all share one template.
//
// If every transaction being exported belongs to the same supplier (either
// because the caller passed `supplierScope` explicitly, or it's simply true
// of the data), the right-hand "SPEND BY SUPPLIER" panel is swapped for a
// "TOP 5 MATERIALS BY AMOUNT" panel for that supplier instead.
//
// Layout note: the item table only ever uses columns A-H, and the analytics
// panel only ever uses columns J-L — they must never share a column, or
// ExcelJS throws "Cannot merge already merged cells" once the item table
// grows past the panel's row range.
async function buildDeliveryReportSheet(wb, { sheetName, fileNameLabel, bigTitleParts, subHeadingText, transactions, supplierScope }) {
  const ws = wb.addWorksheet(sheetName || 'Delivery Report', { views: [{ showGridLines: false }] });
  ws.columns = [
    { width: 25 }, { width: 16 }, { width: 18 }, { width: 26 }, { width: 8 },
    { width: 8 }, { width: 13 }, { width: 13 }, { width: 4 }, { width: 15 }, { width: 15 }, { width: 15 }
  ];

  const logoPath = await getXlsxLogoPath();
  let row = applyLetterhead(wb, ws, { fileNameLabel, bigTitleParts, subHeadingText, lastCol: 'H', logoPath });

  // --- Grand Total card ---
  ws.mergeCells('J1:L1');
  fillCell(ws.getCell('J1'), NAVY, { bold: true, color: WHITE, align: 'center' });
  ws.getCell('J1').value = 'GRAND TOTAL';
  ws.mergeCells('J2:L4');
  const grandTotal = transactions.reduce((s, t) => s + t.total_amount, 0);
  const gtValue = ws.getCell('J2');
  gtValue.value = peso(grandTotal);
  fillCell(gtValue, TOTAL_BLUE, { align: 'center', bold: true, color: WHITE, size: 15 });

  // Auto-detect a single-supplier scope from the data itself if not given explicitly.
  if (!supplierScope) {
    const uniqueSuppliers = [...new Set(transactions.map(t => t.supplier_name))];
    if (uniqueSuppliers.length === 1) supplierScope = uniqueSuppliers[0];
  }

  // ---- Per-supplier delivery blocks ----
  const bySupplier = {};
  transactions.forEach(t => {
    if (!bySupplier[t.supplier_name]) bySupplier[t.supplier_name] = [];
    bySupplier[t.supplier_name].push(t);
  });

  Object.keys(bySupplier).forEach(supplierName => {
    ws.mergeCells(`A${row}:H${row}`);
    const supCell = ws.getCell(`A${row}`);
    supCell.value = `SUPPLIER NAME: ${supplierName}`;
    fillCell(supCell, LIGHTBLUE, { bold: true, color: NAVY });
    row++;

    const headers = ['DATE', 'CTRL/INVOICE/OR #', 'TRANSACTION NUMBER', 'ITEM', 'UNIT', 'QTY', 'AMOUNT', 'TOTAL'];
    headers.forEach((h, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = h;
      fillCell(c, NAVY, { bold: true, color: WHITE, align: 'center', border: true });
    });
    row++;

    let supplierTotal = 0;
    let itemIndex = 0;
    bySupplier[supplierName].forEach(t => {
      (t.items || []).forEach((it, idxInTxn) => {
        // Date and Transaction Number are transaction-level (one value for the
        // whole transaction), so repeating them on every item row would be
        // redundant — only the first row of each transaction shows them.
        // CTRL/Invoice/OR # is stored per ITEM though: a merged transaction can
        // legitimately hold items with different CTRL numbers (e.g. two report
        // blocks for the same supplier combined into one transaction number),
        // so each item shows its own real CTRL number rather than only the
        // first item's, which would silently hide the other items' numbers.
        const isFirstOfTxn = idxInTxn === 0;
        const zebra = itemIndex % 2 === 1 ? ZEBRA : WHITE;

        setVal(ws.getCell(row, 1), isFirstOfTxn ? formatDateMDY(t.date) : '', { align: 'center' });
        setVal(ws.getCell(row, 2), it.ctrl_number || (isFirstOfTxn ? t.ctrl_numbers : ''), { align: 'center' });
        setVal(ws.getCell(row, 3), isFirstOfTxn ? t.transaction_number : '', { align: 'center' });
        setVal(ws.getCell(row, 4), it.item_name);
        setVal(ws.getCell(row, 5), it.unit || '', { align: 'center' });
        setVal(ws.getCell(row, 6), it.quantity, { align: 'center' });
        setVal(ws.getCell(row, 7), it.price_per_unit, { numFmt: '"₱"#,##0.00', align: 'center' });
        setVal(ws.getCell(row, 8), it.total_amount, { numFmt: '"₱"#,##0.00', align: 'center' });

        for (let c = 1; c <= 8; c++) {
          ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
        }

        supplierTotal += it.total_amount;
        itemIndex++;
        row++;
      });
    });

    ws.mergeCells(`A${row}:G${row}`);
    const totLabel = ws.getCell(`A${row}`);
    totLabel.value = 'Total';
    fillCell(totLabel, TOTAL_BLUE, { bold: true, color: WHITE, align: 'right', border: true });
    const totVal = ws.getCell(`H${row}`);
    totVal.value = supplierTotal;
    totVal.numFmt = '"₱"#,##0.00';
    fillCell(totVal, TOTAL_BLUE, { bold: true, color: WHITE, align: 'center', border: true });
    row += 2;
  });

  if (!Object.keys(bySupplier).length) {
    setVal(ws.getCell(`A${row}`), 'No deliveries to show for this selection.', { color: 'FF888888', border: false });
    ws.getCell(`A${row}`).font.italic = true;
    row += 2;
  }

  // ---- Right-hand Analytics & Statistic Overview panel ----
  // Scoped to exactly the `transactions` this report is exporting (see the
  // computeScoped* helpers above) — so a filtered Catalog export or a single
  // supplier's report shows totals for that scope only, not the whole
  // association's all-time history.
  const overview = computeScopedOverviewStats(transactions);
  let sideRow = 6;
  ws.mergeCells(`J${sideRow}:L${sideRow}`);
  fillCell(ws.getCell(`J${sideRow}`), NAVY, { bold: true, color: WHITE, align: 'center' });
  ws.getCell(`J${sideRow}`).value = 'ANALYTICS & STATISTIC OVERVIEW';
  sideRow++;

  const kpis = [
    ['TOTAL TRANSACTIONS', overview.totalTransactions],
    ['TOTAL DELIVERY COST', peso(overview.totalDeliveryCost)],
    ['TOTAL SUPPLIERS', overview.totalSuppliers]
  ];
  kpis.forEach(([label, value]) => {
    ws.mergeCells(`J${sideRow}:L${sideRow}`);
    const lc = ws.getCell(`J${sideRow}`);
    lc.value = label;
    fillCell(lc, GREY, { align: 'center', size: 9, border: true });
    sideRow++;
    ws.mergeCells(`J${sideRow}:L${sideRow}`);
    const vc = ws.getCell(`J${sideRow}`);
    vc.value = value;
    fillCell(vc, GREY, { bold: true, color: NAVY, align: 'center', size: 13, border: true });
    sideRow++;
  });

  // States the actual date span covered by the transactions in this report
  // (not always "the last 3 months from today" — that was only ever true for
  // an unfiltered, all-time export).
  ws.mergeCells(`J${sideRow}:L${sideRow}`);
  const scopeCell = ws.getCell(`J${sideRow}`);
  if (transactions.length) {
    const dates = transactions.map(t => t.date).filter(Boolean).sort();
    const scopeFromLabel = formatDateMDY(dates[0]);
    const scopeToLabel = formatDateMDY(dates[dates.length - 1]);
    scopeCell.value = scopeFromLabel === scopeToLabel ? `Scope: ${scopeFromLabel}` : `Scope: ${scopeFromLabel} - ${scopeToLabel}`;
  } else {
    scopeCell.value = 'Scope: —';
  }
  scopeCell.font = { name: FONT_NAME, italic: true, size: 9, color: { argb: 'FF777777' } };
  scopeCell.alignment = { horizontal: 'center' };
  sideRow += 2;

  // ---- "Spend by Supplier" (default) or "Top 5 Materials" (single-supplier scope) ----
  // Both computed only from the transactions/suppliers in this report's scope.
  const isMaterialsPanel = !!supplierScope;
  const breakdown = isMaterialsPanel ? computeScopedMaterialBreakdown(transactions, supplierScope) : computeScopedSupplierBreakdown(transactions);
  const panelTitle = isMaterialsPanel ? `TOP 5 MATERIALS BY AMOUNT — ${supplierScope.toUpperCase()}` : 'SPEND BY SUPPLIER (TOP 5)';

  ws.mergeCells(`J${sideRow}:L${sideRow}`);
  fillCell(ws.getCell(`J${sideRow}`), NAVY, { bold: true, color: WHITE, align: 'center', wrap: true });
  ws.getCell(`J${sideRow}`).value = panelTitle;
  sideRow++;

  const panelStart = sideRow;
  let zebraIdx = 0;
  const items = isMaterialsPanel ? breakdown.top5.map(r => ({ label: r.name, amount: r.amount })) : breakdown.top5.map(r => ({ label: r.supplier_name, amount: r.amount }));
  items.forEach(r => {
    const pct = ((r.amount / breakdown.overallTotal) * 100).toFixed(2);
    const zebra = zebraIdx % 2 === 1 ? ZEBRA : WHITE;
    const lc = ws.getCell(`J${sideRow}`);
    setVal(lc, r.label, { border: false });
    lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
    ws.mergeCells(`K${sideRow}:L${sideRow}`);
    const vc = ws.getCell(`K${sideRow}`);
    setVal(vc, `${peso(r.amount)} (${pct}%)`, { align: 'right', border: false });
    vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
    zebraIdx++;
    sideRow++;
  });
  if (breakdown.othersAmount > 0) {
    const pct = ((breakdown.othersAmount / breakdown.overallTotal) * 100).toFixed(2);
    const zebra = zebraIdx % 2 === 1 ? ZEBRA : WHITE;
    const lc = ws.getCell(`J${sideRow}`);
    setVal(lc, 'Others', { border: false });
    lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
    ws.mergeCells(`K${sideRow}:L${sideRow}`);
    const vc = ws.getCell(`K${sideRow}`);
    setVal(vc, `${peso(breakdown.othersAmount)} (${pct}%)`, { align: 'right', border: false });
    vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
    zebraIdx++;
    sideRow++;
  }
  // TOTAL row — colored blue per spec.
  fillCell(ws.getCell(`J${sideRow}`), TOTAL_BLUE, { bold: true, color: WHITE, border: true });
  ws.getCell(`J${sideRow}`).value = 'TOTAL';
  ws.mergeCells(`K${sideRow}:L${sideRow}`);
  fillCell(ws.getCell(`K${sideRow}`), TOTAL_BLUE, { bold: true, color: WHITE, align: 'right', border: true });
  ws.getCell(`K${sideRow}`).value = `${peso(breakdown.overallTotal)} (100%)`;
  applyOuterBorder(ws, panelStart, sideRow, 10, 12); // frames the rows only, not the TOTAL bar (already bordered)
  sideRow += 2;

  // ---- Monthly Trend ----
  ws.mergeCells(`J${sideRow}:L${sideRow}`);
  fillCell(ws.getCell(`J${sideRow}`), NAVY, { bold: true, color: WHITE, align: 'center' });
  ws.getCell(`J${sideRow}`).value = 'MONTHLY TREND';
  sideRow++;
  const trendStart = sideRow;
  overview.trend.forEach((m, i) => {
    const zebra = i % 2 === 1 ? ZEBRA : WHITE;
    const c1 = ws.getCell(`J${sideRow}`), c2 = ws.getCell(`K${sideRow}`), c3 = ws.getCell(`L${sideRow}`);
    setVal(c1, m.label, { border: false });
    setVal(c2, `${m.qty} units`, { align: 'center', border: false });
    setVal(c3, peso(m.amount), { align: 'right', border: false });
    [c1, c2, c3].forEach(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } }; });
    sideRow++;
  });
  applyOuterBorder(ws, trendStart, sideRow - 1, 10, 12);
  sideRow += 1;

  // ---- Auto-fit columns based on their actual content. Merged cells (banners,
  // titles, card labels) are skipped since a wide merge's text length isn't a
  // real single-column measurement; column A is skipped too since it's reserved
  // for the logo. Currency cells use their formatted (peso) display length —
  // not the raw numeric value's length — since ExcelJS's numFmt isn't reflected
  // in cell.text, which previously under-sized those columns and let the
  // formatted "₱ 000,000.00" text overlap into the next column. ----
  const maxLen = {};
  ws.eachRow(r => {
    r.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (cell.isMerged || colNumber === 1) return;
      let text;
      if (cell.numFmt && typeof cell.value === 'number') {
        text = peso(cell.value);
      } else {
        text = String(cell.text != null ? cell.text : (cell.value != null ? cell.value : ''));
      }
      if (!text) return;
      const weight = (cell.font && cell.font.bold) ? text.length * 1.15 : text.length;
      maxLen[colNumber] = Math.max(maxLen[colNumber] || 0, weight);
    });
  });
  Object.keys(maxLen).forEach(colNumStr => {
    const n = Number(colNumStr);
    const computed = Math.min(Math.max(Math.ceil(maxLen[colNumStr]) + 3, 8), 45);
    const col = ws.getColumn(n);
    col.width = Math.max(col.width || 0, computed);
  });

  return ws;
}

module.exports = {
  NAVY, LIGHTBLUE, GREY, ZEBRA, WHITE, TOTAL_BLUE, GOLD, FONT_NAME, THIN_BORDER,
  peso, fillCell, setVal, applyOuterBorder, applyLetterhead, styleTableHeaderRow,
  computeOverviewStats, computeSupplierBreakdown, computeMaterialBreakdown,
  computeScopedOverviewStats, computeScopedSupplierBreakdown, computeScopedMaterialBreakdown,
  getXlsxLogoPath, buildDeliveryReportSheet
};
