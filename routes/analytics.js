const express = require('express');
const router = express.Router();
const path = require('path');
const ExcelJS = require('exceljs');
const { db } = require('../db/init');
const { requireAuth, formatDateMDY, groupTopNWithOthers } = require('./utils');
const { getAllTransactions, filterTransactions } = require('./dataAccess');
const {
  applyLetterhead, styleTableHeaderRow, fillCell, setVal, applyOuterBorder,
  NAVY, LIGHTBLUE, GREY, ZEBRA, WHITE, TOTAL_BLUE, GOLD, FONT_NAME, peso, getXlsxLogoPath
} = require('./xlsxTemplate');
const { renderChart } = require('./chartRenderer');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

async function getFiltered(from, to, supplier) {
  const all = await getAllTransactions();
  return filterTransactions(all, { from, to, supplier });
}

function buildBreakdown(transactions) {
  const bySupplier = {};
  transactions.forEach(t => {
    if (!bySupplier[t.supplier_name]) bySupplier[t.supplier_name] = { supplier_name: t.supplier_name, amount: 0, count: 0 };
    bySupplier[t.supplier_name].amount += t.total_amount;
    bySupplier[t.supplier_name].count += 1;
  });
  return bySupplier;
}

// type = amount | count
router.get('/', requireAuth, async (req, res) => {
  try {
    const { from, to, type, supplier } = req.query;
    const transactions = await getFiltered(from, to, supplier);
    const bySupplier = buildBreakdown(transactions);
    let breakdown = Object.values(bySupplier);
    breakdown.sort((a, b) => (type === 'count' ? b.count - a.count : b.amount - a.amount));
    // Top 5 named suppliers only — anything past that rolls up into "Others" so
    // the chart/table stays readable regardless of how many suppliers exist.
    breakdown = groupTopNWithOthers(breakdown, 5);

    res.json({
      from, to,
      filterType: type === 'count' ? 'Number of Transactions' : 'Total Amount Paid to Supplier',
      totalAmount: transactions.reduce((s, t) => s + t.total_amount, 0),
      totalTransactions: transactions.length,
      breakdown
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load analytics.' });
  }
});

// Every supplier that has ever had a transaction, all-time (not affected by the date filter above)
router.get('/suppliers', requireAuth, async (req, res) => {
  try {
    const all = (await getAllTransactions()).filter(t => !t.removed);
    const bySupplier = {};
    all.forEach(t => {
      if (!bySupplier[t.supplier_name]) bySupplier[t.supplier_name] = { supplier_name: t.supplier_name, count: 0, amount: 0, first_date: t.date, last_date: t.date };
      const s = bySupplier[t.supplier_name];
      s.count += 1;
      s.amount += t.total_amount;
      if (t.date < s.first_date) s.first_date = t.date;
      if (t.date > s.last_date) s.last_date = t.date;
    });
    const rows = Object.values(bySupplier).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load suppliers.' });
  }
});

// Download the full all-time supplier list (same data as the "All Suppliers"
// table on the Analytics page) as an XLSX file, with alternating row colors
// so a long supplier list stays easy to scan.
router.get('/suppliers/export/xlsx', requireAuth, async (req, res) => {
  try {
    const all = (await getAllTransactions()).filter(t => !t.removed);
    const bySupplier = {};
    all.forEach(t => {
      if (!bySupplier[t.supplier_name]) bySupplier[t.supplier_name] = { supplier_name: t.supplier_name, count: 0, amount: 0, first_date: t.date, last_date: t.date };
      const s = bySupplier[t.supplier_name];
      s.count += 1;
      s.amount += t.total_amount;
      if (t.date < s.first_date) s.first_date = t.date;
      if (t.date > s.last_date) s.last_date = t.date;
    });
    const rows = Object.values(bySupplier).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'DRWSA Maintenance';
    const ws = wb.addWorksheet('Suppliers', { views: [{ showGridLines: false }] });
    ws.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 16 }];

    const logoPath = await getXlsxLogoPath();
    let row = applyLetterhead(wb, ws, {
      fileNameLabel: 'DRWSA_Suppliers.xlsx',
      bigTitleParts: [{ text: 'ALL SUPPLIERS' }],
      subHeadingText: `Report Scope: All-Time — ${rows.length} supplier${rows.length === 1 ? '' : 's'} on file`,
      lastCol: 'E',
      logoPath
    });

    const headers = ['Supplier', 'Total Transactions', 'Total Amount Paid', 'First Delivery', 'Last Delivery'];
    headers.forEach((h, i) => { ws.getCell(row, i + 1).value = h; });
    styleTableHeaderRow(ws, row, headers.length);
    row++;

    rows.forEach((r, i) => {
      const zebra = i % 2 === 1 ? ZEBRA : WHITE;
      setVal(ws.getCell(row, 1), r.supplier_name);
      setVal(ws.getCell(row, 2), r.count, { align: 'center' });
      setVal(ws.getCell(row, 3), r.amount, { numFmt: '"₱"#,##0.00', align: 'center' });
      setVal(ws.getCell(row, 4), formatDateMDY(r.first_date), { align: 'center' });
      setVal(ws.getCell(row, 5), formatDateMDY(r.last_date), { align: 'center' });
      for (let c = 1; c <= 5; c++) {
        ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
      }
      row++;
    });
    applyOuterBorder(ws, row - rows.length, row - 1, 1, 5);

    // Auto-fit so long supplier names never get cut off.
    const maxLen = {};
    ws.eachRow(r => {
      r.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.isMerged) return;
        const text = String(cell.text != null ? cell.text : (cell.value != null ? cell.value : ''));
        if (!text) return;
        maxLen[colNumber] = Math.max(maxLen[colNumber] || 0, text.length);
      });
    });
    Object.keys(maxLen).forEach(colNumStr => {
      const n = Number(colNumStr);
      const computed = Math.min(Math.max(Math.ceil(maxLen[colNumStr]) + 3, 10), 45);
      ws.getColumn(n).width = Math.max(ws.getColumn(n).width || 0, computed);
    });

    res.setHeader('Content-Disposition', 'attachment; filename="DRWSA_Suppliers.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate the suppliers export.' });
  }
});

// Monthly totals within the date range — used for the line chart, since a line
// implies a trend along a continuous axis (time) rather than a comparison across
// unrelated categories like suppliers (that's what the bar/column/pie charts are for).
router.get('/timeseries', requireAuth, async (req, res) => {
  try {
    const { from, to, supplier } = req.query;
    const transactions = await getFiltered(from, to, supplier);
    const byMonth = {};
    transactions.forEach(t => {
      const month = (t.date || '').slice(0, 7); // YYYY-MM
      if (!month) return;
      if (!byMonth[month]) byMonth[month] = { month, amount: 0, count: 0 };
      byMonth[month].amount += t.total_amount;
      byMonth[month].count += 1;
    });
    const series = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
    res.json({ series });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load the time series.' });
  }
});

// ---- Executive Supplier Spend & Procurement Analytics Report ----
// A letterhead-styled XLSX matching the association's executive-summary
// template: header banner, gold report-title bar, scope subheading, 4 KPI
// cards, a "Spend by Supplier (Top Performers)" table (top 5 + Others) next
// to an embedded chart image, and a Monthly Spend & Delivered Volume Trend
// table. Available in three chart flavors (pie / bar / column) via ?chartType=.
router.get('/export/xlsx', requireAuth, async (req, res) => {
  try {
    const { from, to, type, chartType, supplier } = req.query;
    const transactions = await getFiltered(from, to, supplier);
    if (!transactions.length) {
      return res.status(400).json({ error: 'No transactions in this range to chart.' });
    }
    const bySupplier = buildBreakdown(transactions);
    let breakdown = Object.values(bySupplier).sort((a, b) => b.amount - a.amount);
    breakdown = groupTopNWithOthers(breakdown, 5);

    const grandTotal = transactions.reduce((s, t) => s + t.total_amount, 0);
    const totalTransactions = transactions.length;
    const totalSuppliers = Object.keys(bySupplier).length;
    const activeSuppliers = totalSuppliers; // all suppliers in-scope are, by definition, active within this scope

    // ---- Monthly Spend & Delivered Volume Trend (within the filtered scope) ----
    // Quantities come straight from each transaction's own embedded `items`
    // array — no extra query needed now that items live on the document itself.
    const byMonth = {};
    transactions.forEach(t => {
      const month = (t.date || '').slice(0, 7);
      if (!month) return;
      if (!byMonth[month]) byMonth[month] = { month, amount: 0, qty: 0 };
      byMonth[month].amount += t.total_amount;
      byMonth[month].qty += (t.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
    });
    const monthKeys = Object.keys(byMonth).sort();
    const nowKey = new Date().toISOString().slice(0, 7);
    const monthlyTrend = monthKeys.map(key => {
      const [y, m] = key.split('-');
      const qty = byMonth[key].qty;
      return {
        label: `${MONTH_NAMES[Number(m) - 1]} ${y}${key === nowKey ? ' (To Date)' : ''}`,
        qty,
        amount: byMonth[key].amount,
        avgCostPerItem: qty > 0 ? byMonth[key].amount / qty : 0
      };
    });
    const trendTotalQty = monthlyTrend.reduce((s, m) => s + m.qty, 0);
    const trendTotalAmount = monthlyTrend.reduce((s, m) => s + m.amount, 0);

    // ---- Build the chart image ----
    const chartData = breakdown.map(b => ({ label: b.supplier_name, value: b.amount }));
    const chartTitle = chartType === 'pie' || !chartType ? 'Supplier Spend Breakdown (%)' : 'Total Spend by Supplier';
    const chartBuffer = renderChart(chartType || 'pie', chartData, { title: chartTitle });

    // ---- Workbook ----
    const wb = new ExcelJS.Workbook();
    wb.creator = 'DRWSA Maintenance';
    const ws = wb.addWorksheet('Executive Report', { views: [{ showGridLines: false }] });
    ws.columns = [
      { width: 26 }, { width: 14 }, { width: 15 }, { width: 12 }, { width: 3 },
      { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }
    ];
    const LAST_COL = 12; // L

    // Header banner — column 1 is reserved for the logo (not covered by the
    // text merge below), enlarged and left-aligned text sits right beside it,
    // so the two read as one connected letterhead block.
    [1, 2, 3].forEach(r => { ws.getRow(r).height = 26; });
    [1, 2, 3].forEach(r => fillCell(ws.getCell(r, 1), NAVY, {}));
    ws.mergeCells(2, 1, 3, LAST_COL);
    const headerCell = ws.getCell(2, 1);
    headerCell.value = 'DARASA RURAL WATERWORKS & SANITATION ASSOCIATION, INC.\n'
      + 'Pres. Laurel Highway, 907 Brgy. Darasa - Tanauan City  |  Tel. / (043) 778-7219  |  Email: darasaruralwaterworksa@yahoo.com';
    fillCell(headerCell, NAVY, { align: 'left', wrap: true, color: WHITE });
    headerCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
    headerCell.font = { name: FONT_NAME, bold: true, size: 14, color: { argb: WHITE } };
    ws.mergeCells(1, 1, 1, LAST_COL);
    fillCell(ws.getCell(1, 1), NAVY, {});

    // Association logo (same configurable header logo used by every other
    // generated XLSX — see the About Us page's "XLSX Report Logo" uploader),
    // enlarged and anchored in the reserved left column of the header banner.
    const logoPath = await getXlsxLogoPath();
    if (logoPath) {
      try {
        const ext = path.extname(logoPath).replace('.', '').toLowerCase();
        const imgId = wb.addImage({ filename: logoPath, extension: ext === 'jpg' ? 'jpeg' : ext });
        ws.addImage(imgId, { tl: { col: 0.05, row: 0.06 }, ext: { width: 90, height: 90 } });
      } catch (e) { /* logo embed is best-effort; report still generates without it */ }
    }

    // Gold report-title bar
    ws.mergeCells(4, 1, 4, LAST_COL);
    const titleCell = ws.getCell(4, 1);
    titleCell.value = 'EXECUTIVE SUPPLIER SPEND & PROCUREMENT ANALYTICS REPORT';
    fillCell(titleCell, NAVY, { align: 'center', bold: true, color: GOLD, size: 12 });
    ws.getRow(4).height = 18;

    // Scope subheading
    const scopeLabel = (from || to)
      ? `${from ? formatDateMDY(from) : 'START'} – ${to ? formatDateMDY(to) : 'PRESENT'}`
      : 'All-Time';
    const supplierNote = supplier ? ` | Supplier: ${supplier}` : '';
    ws.mergeCells(5, 1, 5, LAST_COL);
    const scopeCell = ws.getCell(5, 1);
    scopeCell.value = `Reporting Scope: ${scopeLabel}${supplierNote}  |  Report Status: Official Executive Summary`;
    fillCell(scopeCell, LIGHTBLUE, { align: 'center', wrap: true });
    scopeCell.font = { name: FONT_NAME, italic: true, size: 10, color: { argb: 'FF555555' } };
    ws.getRow(5).height = 16;

    ws.getRow(6).height = 8; // spacer

    // KPI cards row (4 cards, 3 columns each)
    const cards = [
      ['GRAND TOTAL SPEND', peso(grandTotal)],
      ['TOTAL TRANSACTIONS', totalTransactions],
      ['TOTAL SUPPLIERS', totalSuppliers],
      ['ACTIVE SUPPLIERS', activeSuppliers]
    ];
    const cardSpans = [[1, 3], [4, 6], [7, 9], [10, 12]];
    cards.forEach(([label, value], i) => {
      const [c1, c2] = cardSpans[i];
      ws.mergeCells(7, c1, 7, c2);
      const lc = ws.getCell(7, c1);
      lc.value = label;
      fillCell(lc, GREY, { align: 'center', size: 9, bold: true });
      ws.mergeCells(8, c1, 9, c2);
      const vc = ws.getCell(8, c1);
      vc.value = value;
      fillCell(vc, LIGHTBLUE, { align: 'center', bold: true, color: NAVY, size: 18 });
    });
    applyOuterBorder(ws, 7, 9, 1, LAST_COL);
    ws.getRow(10).height = 8; // spacer

    // ---- Left: Spend by Supplier (Top Performers) table ----
    let row = 11;
    ws.mergeCells(row, 1, row, 4);
    fillCell(ws.getCell(row, 1), NAVY, { bold: true, color: WHITE, align: 'center' });
    ws.getCell(row, 1).value = 'SPEND BY SUPPLIER (TOP PERFORMERS)';
    const tableTitleRow = row;
    row++;

    const tableHeaders = ['SUPPLIER NAME', 'TRANSACTIONS', 'TOTAL SPEND (₱)', 'SHARE (%)'];
    tableHeaders.forEach((h, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = h;
      fillCell(c, NAVY, { bold: true, color: WHITE, align: 'center', border: true });
    });
    row++;
    const supplierTableStart = row;

    breakdown.forEach((b, i) => {
      const zebra = i % 2 === 1 ? ZEBRA : WHITE;
      const pct = ((b.amount / (grandTotal || 1)) * 100);
      setVal(ws.getCell(row, 1), b.supplier_name);
      setVal(ws.getCell(row, 2), b.count, { align: 'center' });
      setVal(ws.getCell(row, 3), b.amount, { numFmt: '"₱"#,##0.00', align: 'center' });
      setVal(ws.getCell(row, 4), `${pct.toFixed(2)}%`, { align: 'center' });
      for (let c = 1; c <= 4; c++) {
        ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
      }
      row++;
    });
    // TOTAL row
    fillCell(ws.getCell(row, 1), TOTAL_BLUE, { bold: true, color: WHITE, border: true });
    ws.getCell(row, 1).value = 'TOTAL';
    fillCell(ws.getCell(row, 2), TOTAL_BLUE, { bold: true, color: WHITE, align: 'center', border: true });
    ws.getCell(row, 2).value = totalTransactions;
    fillCell(ws.getCell(row, 3), TOTAL_BLUE, { bold: true, color: WHITE, align: 'center', border: true });
    ws.getCell(row, 3).value = grandTotal;
    ws.getCell(row, 3).numFmt = '"₱"#,##0.00';
    fillCell(ws.getCell(row, 4), TOTAL_BLUE, { bold: true, color: WHITE, align: 'center', border: true });
    ws.getCell(row, 4).value = '100.00%';
    applyOuterBorder(ws, supplierTableStart, row, 1, 4);
    const tableBottomRow = row;
    row += 2;

    // ---- Right: chart image, anchored beside the supplier table ----
    const imgId = wb.addImage({ buffer: chartBuffer, extension: 'png' });
    // Native pixel size of the rendered chart (see chartRenderer.js) — displayed
    // at that size so nothing inside the image (labels, legend, %) is stretched
    // or cropped.
    ws.addImage(imgId, {
      tl: { col: 5.2, row: tableTitleRow - 1 + 0.1 },
      ext: { width: 460, height: 268 }
    });

    // ---- Monthly Spend & Delivered Volume Trend (full width) ----
    row = Math.max(row, tableTitleRow + 14); // clear the chart image's vertical space first
    ws.mergeCells(row, 1, row, 4);
    fillCell(ws.getCell(row, 1), NAVY, { bold: true, color: WHITE, align: 'center' });
    ws.getCell(row, 1).value = 'MONTHLY SPEND & DELIVERED VOLUME TREND';
    row++;

    const trendHeaders = ['REPORTING MONTH', 'DELIVERED QTY', 'TOTAL SPEND (₱)', 'AVG COST/ITEM'];
    trendHeaders.forEach((h, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = h;
      fillCell(c, NAVY, { bold: true, color: WHITE, align: 'center', border: true });
    });
    row++;
    const trendStart = row;

    monthlyTrend.forEach((m, i) => {
      const zebra = i % 2 === 1 ? ZEBRA : WHITE;
      setVal(ws.getCell(row, 1), m.label);
      setVal(ws.getCell(row, 2), `${m.qty.toLocaleString()} PCS`, { align: 'center' });
      setVal(ws.getCell(row, 3), m.amount, { numFmt: '"₱"#,##0.00', align: 'center' });
      setVal(ws.getCell(row, 4), m.avgCostPerItem, { numFmt: '"₱"#,##0.00', align: 'center' });
      for (let c = 1; c <= 4; c++) {
        ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
      }
      row++;
    });
    // TOTAL / AVERAGE row
    const avgCostOverall = trendTotalQty > 0 ? trendTotalAmount / trendTotalQty : 0;
    fillCell(ws.getCell(row, 1), TOTAL_BLUE, { bold: true, color: WHITE, border: true });
    ws.getCell(row, 1).value = 'TOTAL / AVERAGE';
    fillCell(ws.getCell(row, 2), TOTAL_BLUE, { bold: true, color: WHITE, align: 'center', border: true });
    ws.getCell(row, 2).value = `${trendTotalQty.toLocaleString()} PCS`;
    fillCell(ws.getCell(row, 3), TOTAL_BLUE, { bold: true, color: WHITE, align: 'center', border: true });
    ws.getCell(row, 3).value = trendTotalAmount;
    ws.getCell(row, 3).numFmt = '"₱"#,##0.00';
    fillCell(ws.getCell(row, 4), TOTAL_BLUE, { bold: true, color: WHITE, align: 'center', border: true });
    ws.getCell(row, 4).value = avgCostOverall;
    ws.getCell(row, 4).numFmt = '"₱"#,##0.00';
    applyOuterBorder(ws, trendStart, row, 1, 4);

    // ---- Auto-fit: measure actual formatted text so nothing (long supplier
    // names, formatted currency, etc.) gets cut off. ----
    const maxLen = {};
    ws.eachRow(r => {
      r.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.isMerged) return;
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
      if (n === 5) return; // spacer column — stays narrow on purpose
      const computed = Math.min(Math.max(Math.ceil(maxLen[colNumStr]) + 3, 10), 45);
      ws.getColumn(n).width = Math.max(ws.getColumn(n).width || 0, computed);
    });

    res.setHeader('Content-Disposition', 'attachment; filename="DRWSA_Executive_Analytics_Report.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate the analytics report.' });
  }
});

module.exports = router;
