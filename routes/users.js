const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { db } = require('../db/init');
const { requireAuth, requireAdmin } = require('./utils');
const { uploadBuffer } = require('./fileStorage');

// memoryStorage — see the comment in transactions.js / fileStorage.js for
// why: local disk (the old diskStorage target) is wiped on every Render
// restart, which was silently deleting avatar photos the same way it was
// deleting logos and delivery photos.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPEG/PNG photos are allowed.'), ok);
  }
});

function toPublicUser(id, u) {
  return { id, name: u.name, position: u.position, email: u.email, phone: u.phone, address: u.address, avatar_path: u.avatar_path, role: u.role, username: u.username, created_at: u.created_at };
}

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// ---------- Admin-only: manage accounts ----------
// Any admin can see the full account list and create new accounts (admin or staff).
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const snap = await db.collection('users').get();
    const users = snap.docs.map(d => toPublicUser(d.id, d.data()));
    users.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
    res.json(users);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load accounts.' });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, username, password, position, role } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
    if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required.' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const finalRole = role === 'admin' ? 'admin' : 'staff';

    const existing = await db.collection('users').where('username', '==', username.trim()).limit(1).get();
    if (!existing.empty) return res.status(400).json({ error: 'That username is already taken.' });

    const doc = {
      name: name.trim(), position: position || '', phone: '', email: '', address: '',
      username: username.trim(), password, role: finalRole, avatar_path: null,
      created_at: new Date().toISOString()
    };
    const ref = await db.collection('users').add(doc);
    res.status(201).json(toPublicUser(ref.id, doc));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'Could not create the account (username or email may already be in use).' });
  }
});

router.put('/me', requireAuth, async (req, res) => {
  try {
    const { name, position, phone, email, address } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });

    if (email && email.trim()) {
      const taken = await db.collection('users').where('email', '==', email.trim()).get();
      if (taken.docs.some(d => d.id !== req.user.id)) {
        return res.status(400).json({ error: 'Could not update profile (email may already be in use).' });
      }
    }

    const updates = { name: name.trim(), position: position || '', phone: phone || '', email: email || '', address: address || '' };
    await db.collection('users').doc(req.user.id).update(updates);
    const snap = await db.collection('users').doc(req.user.id).get();
    res.json(toPublicUser(snap.id, snap.data()));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'Could not update profile (email may already be in use).' });
  }
});

router.put('/me/credentials', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body;
    if (!currentPassword) {
      return res.status(400).json({ error: 'Enter your current password to change your username or password.' });
    }
    const snap = await db.collection('users').doc(req.user.id).get();
    const user = snap.data();
    if (!user || user.password !== currentPassword) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const updates = {};
    if (newUsername && newUsername.trim() && newUsername.trim() !== user.username) {
      const taken = await db.collection('users').where('username', '==', newUsername.trim()).get();
      if (taken.docs.some(d => d.id !== req.user.id)) return res.status(400).json({ error: 'That username is already taken.' });
      updates.username = newUsername.trim();
    }
    if (newPassword) {
      if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
      updates.password = newPassword;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update.' });

    await db.collection('users').doc(req.user.id).update(updates);
    const updated = await db.collection('users').doc(req.user.id).get();
    res.json(toPublicUser(updated.id, updated.data()));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'Could not update your account (username may already be in use).' });
  }
});

router.post('/me/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    const destPath = 'uploads/avatar-' + req.user.id + '-' + Date.now() + path.extname(req.file.originalname);
    const url = await uploadBuffer(req.file.buffer, destPath, req.file.mimetype);
    await db.collection('users').doc(req.user.id).update({ avatar_path: url });
    res.json({ avatar_path: url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Could not save your photo.' });
  }
});

router.get('/me/activity', requireAuth, async (req, res) => {
  try {
    // Simple equality filter only (no orderBy in the query itself) — sorting
    // happens in memory below so this never needs a Firestore composite index.
    const snap = await db.collection('activity_log').where('user_id', '==', req.user.id).get();
    const rows = snap.docs.map(d => d.data());
    rows.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    const submitted = rows.filter(r => r.action === 'submitted').length;
    const edited = rows.filter(r => r.action === 'edited').length;
    const deleted = rows.filter(r => r.action === 'deleted').length;
    const log = rows.slice(0, 50).map(r => ({ action: r.action, transaction_number: r.transaction_number, timestamp: r.timestamp }));
    res.json({ submitted, edited, deleted, log });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load your activity.' });
  }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account while logged in.' });
    }
    const targetSnap = await db.collection('users').doc(targetId).get();
    if (!targetSnap.exists) return res.status(404).json({ error: 'Account not found.' });
    const target = targetSnap.data();
    if (target.role === 'admin') {
      const admins = await db.collection('users').where('role', '==', 'admin').get();
      if (admins.size <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last remaining admin account.' });
      }
    }

    // Transactions this user created stay on file (delivery history shouldn't
    // disappear just because the account is removed) — just drop the link.
    const createdTxns = await db.collection('transactions').where('created_by', '==', targetId).get();
    const activityDocs = await db.collection('activity_log').where('user_id', '==', targetId).get();

    const batch = db.batch();
    createdTxns.docs.forEach(d => batch.update(d.ref, { created_by: null }));
    activityDocs.docs.forEach(d => batch.delete(d.ref));
    batch.delete(db.collection('users').doc(targetId));
    await batch.commit();

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not delete the account.' });
  }
});

module.exports = router;
