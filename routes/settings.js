const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../db/init');
const { requireAuth } = require('./utils');

const uploadDir = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const prefix = req.path.includes('xlsx-logo') ? 'xlsx-logo-' : 'logo-';
    cb(null, prefix + Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPEG/PNG logos are allowed.'), ok);
  }
});

// Public: the login page needs this before authenticating
router.get('/', async (req, res) => {
  try {
    const [logoSnap, xlsxLogoSnap] = await Promise.all([
      db.collection('settings').doc('logo_path').get(),
      db.collection('settings').doc('xlsx_logo_path').get()
    ]);
    const value = logoSnap.exists ? logoSnap.data().value : null;
    const xlsxValue = xlsxLogoSnap.exists ? xlsxLogoSnap.data().value : null;
    res.json({
      logoUrl: value || null,
      // Falls back to the bundled default seal until an admin uploads a
      // custom one from the About Us page's "XLSX Report Logo" control.
      xlsxLogoUrl: xlsxValue || '/uploads/xlsx-logo-official.png'
    });
  } catch (e) {
    console.error(e);
    res.json({ logoUrl: null, xlsxLogoUrl: '/uploads/xlsx-logo-official.png' });
  }
});

router.post('/logo', requireAuth, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const url = '/uploads/' + req.file.filename;
    await db.collection('settings').doc('logo_path').set({ value: url }, { merge: true });
    res.json({ logoUrl: url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save the logo.' });
  }
});

// Sets the logo that appears in the header of every generated XLSX report
// (delivery reports, catalog exports, supplier list, executive analytics
// report). Deliberately separate from /settings/logo above, which controls
// the *system* logo shown on the login page and sidebar — the two can be
// different images.
router.post('/xlsx-logo', requireAuth, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const url = '/uploads/' + req.file.filename;
    await db.collection('settings').doc('xlsx_logo_path').set({ value: url }, { merge: true });
    res.json({ xlsxLogoUrl: url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save the XLSX report logo.' });
  }
});

module.exports = router;
