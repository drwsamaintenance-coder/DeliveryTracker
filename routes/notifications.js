const express = require('express');
const router = express.Router();
const { db } = require('../db/init');
const { requireAuth } = require('./utils');

router.get('/', requireAuth, async (req, res) => {
  try {
    const snap = await db.collection('notifications').orderBy('created_at', 'desc').limit(50).get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load notifications.' });
  }
});

module.exports = router;
