const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Firebase replaces the old local SQLite file entirely — the server needs a
// service account key to talk to your Firestore project. Two ways to supply it:
//
//   1. Local/office deployment (Start DRWSA.vbs): drop the downloaded key as
//      serviceAccountKey.json right here in the project's root folder.
//   2. Cloud deployment (Render, Railway, etc.): paste the ENTIRE contents of
//      that key file into an environment variable named
//      FIREBASE_SERVICE_ACCOUNT_JSON in your host's dashboard — nothing
//      sensitive ever needs to be committed to GitHub this way.
//
// Generate the key from Firebase Console > Project Settings > Service
// accounts > Generate new private key.
const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    console.error('\n[DRWSA] FIREBASE_SERVICE_ACCOUNT_JSON is set but is not valid JSON.');
    console.error('Make sure you pasted the ENTIRE contents of the downloaded key file.\n');
    process.exit(1);
  }
} else if (fs.existsSync(keyPath)) {
  serviceAccount = require(keyPath);
} else {
  console.error('\n[DRWSA] Missing Firebase credentials.');
  console.error('This app uses Firebase/Firestore instead of a local database file. Either:');
  console.error('  - save your key as serviceAccountKey.json in the project root, or');
  console.error('  - set the FIREBASE_SERVICE_ACCOUNT_JSON environment variable');
  console.error('    (paste the full contents of the key file as its value).');
  console.error('Download the key from Firebase Console > Project Settings > Service');
  console.error('accounts > Generate new private key. See README.md for full steps.\n');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const FieldValue = admin.firestore.FieldValue;

// ---------------------------------------------------------------------------
// One-time seeding: settings defaults + demo admin accounts, exactly matching
// what the old SQLite version seeded on first run. Firestore has no schema/
// migrations to run — collections are created implicitly the first time a
// document is written to them — so this only needs to seed starting data.
// ---------------------------------------------------------------------------
async function seedIfEmpty() {
  const settingsCol = db.collection('settings');

  const verifSnap = await settingsCol.doc('verification_password').get();
  if (!verifSnap.exists) {
    await settingsCol.doc('verification_password').set({ value: 'drwsa2026' });
  }

  const logoSnap = await settingsCol.doc('logo_path').get();
  if (!logoSnap.exists) {
    await settingsCol.doc('logo_path').set({ value: '/uploads/logo-official.png' });
  } else if (!logoSnap.data().value) {
    // Backfill projects that had this seeded empty before the official logo shipped —
    // but never touch it if an admin already uploaded a real logo.
    await settingsCol.doc('logo_path').set({ value: '/uploads/logo-official.png' });
  }

  const counterSnap = await db.collection('meta').doc('counters').get();
  if (!counterSnap.exists) {
    await db.collection('meta').doc('counters').set({ transactionSeq: 0 });
  }

  const usersSnap = await db.collection('users').limit(1).get();
  if (usersSnap.empty) {
    // Both seed accounts are admins, so there are always 2 admin accounts able
    // to create further accounts (admin or staff) from the User page.
    await db.collection('users').add({
      name: 'Juan C. Magaling', position: 'Manager', phone: '0967 757 6776',
      email: 'JuanCMagaling@gmail.com', address: 'Biringan City',
      username: 'juan', password: 'password123', role: 'admin',
      avatar_path: null, created_at: new Date().toISOString()
    });
    await db.collection('users').add({
      name: 'Jess Manlupa', position: 'Staff', phone: '0917 000 1111',
      email: 'jess.manlupa@gmail.com', address: 'Lipa City',
      username: 'jess', password: 'password123', role: 'admin',
      avatar_path: null, created_at: new Date().toISOString()
    });
  }
}

// Every route file awaits this once (it resolves instantly after the first
// call — see routes/utils.js `ready()` helper) so nothing queries Firestore
// before the one-time seed above has had a chance to run.
const ready = seedIfEmpty().catch(err => {
  console.error('[DRWSA] Failed to seed Firestore on startup:', err.message);
  process.exit(1);
});

module.exports = { db, admin, FieldValue, ready };
