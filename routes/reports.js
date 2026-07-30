const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { requireAuth } = require('./utils');
const { getAllTransactions } = require('./dataAccess');
const { buildDeliveryReportSheet } = require('./xlsxTemplate');

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Generates a one-sheet "Delivery Report" for a given month, styled after the
// association's letterhead template: header banner + logo, grand total card,
// per-supplier delivery tables, and a right-hand analytics/overview panel.
// (See xlsxTemplate.js for the shared layout — every other branded .xlsx
// export in the app, e.g. the Catalog's filtered download, uses the same one.)
//
// Note on limitations: the free tooling available here (ExcelJS) can style cells,
// merge them, and embed the logo image, but it cannot generate a native Excel
// "gauge" chart widget — that requires Excel's own chart engine, which isn't
// something a library can write standalone. The Grand Total is shown as a large
// styled figure instead of a gauge graphic.
router.get('/monthly', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year) || now.getFullYear();
    const month = parseInt(req.query.month) || (now.getMonth() + 1);
    const monthStr = String(month).padStart(2, '0');
    const prefix = `${year}-${monthStr}`;
    const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`.toUpperCase();

    const all = await getAllTransactions();
    const monthTxns = all
      .filter(t => !t.removed && (t.date || '').startsWith(prefix))
      // Always sorted by Transaction Date first, then Transaction Number as the
      // tie-breaker for same-day transactions — never by supplier.
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.transaction_number || '').localeCompare(b.transaction_number || ''));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'DRWSA Maintenance';
    await buildDeliveryReportSheet(wb, {
      sheetName: 'Delivery Report',
      fileNameLabel: `DELIVERY_REPORT_${MONTH_NAMES[month - 1].toUpperCase()}_${year}.xlsx`,
      bigTitleParts: [
        { text: 'NEW DELIVERY FOR THE MONTH OF ' },
        { text: monthLabel, highlight: true }
      ],
      subHeadingText: `Report Scope: Calendar Month — ${monthLabel} (${monthTxns.length} transaction${monthTxns.length === 1 ? '' : 's'})`,
      transactions: monthTxns
      // No supplierScope passed — the monthly report always covers every
      // supplier for the month, so the panel auto-detects (falls back to
      // the standard "Spend by Supplier" breakdown unless the month happens
      // to contain only one supplier's deliveries).
    });

    res.setHeader('Content-Disposition', `attachment; filename="DELIVERY_REPORT_${MONTH_NAMES[month - 1].toUpperCase()}_${year}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to generate the monthly report.' });
  }
});

module.exports = router;
