const express = require('express');
const router = express.Router();
const { db, ready } = require('../db/init');

router.post('/login', async (req, res) => {
  try {
    await ready;
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const snap = await db.collection('users').where('username', '==', username.trim()).limit(1).get();
    if (snap.empty) return res.status(401).json({ error: 'Invalid username or password.' });
    const doc = snap.docs[0];
    const user = doc.data();
    if (user.password !== password) return res.status(401).json({ error: 'Invalid username or password.' });

    req.session.userId = doc.id;
    res.json({
      id: doc.id, name: user.name, position: user.position,
      email: user.email, phone: user.phone, address: user.address, avatar_path: user.avatar_path,
      role: user.role, username: user.username
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', async (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
    const snap = await db.collection('users').doc(req.session.userId).get();
    if (!snap.exists) return res.status(401).json({ error: 'Not logged in.' });
    const u = snap.data();
    res.json({
      id: snap.id, name: u.name, position: u.position, email: u.email,
      phone: u.phone, address: u.address, avatar_path: u.avatar_path,
      role: u.role, username: u.username
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load your session.' });
  }
});

module.exports = router;
