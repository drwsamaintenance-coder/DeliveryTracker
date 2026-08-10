const { bucket } = require('../db/init');

// ---------------------------------------------------------------------------
// Persistent file storage (Cloud Storage) — replaces writing to local disk.
// See the comment in db/init.js for why this exists: Render's filesystem is
// ephemeral, so anything saved with multer's old diskStorage was lost on the
// next container restart. Every upload (system logo, XLSX report logo,
// delivery item photos) should go through uploadBuffer() below instead.
// ---------------------------------------------------------------------------

// Uploads a Buffer (e.g. from multer's memoryStorage, req.file.buffer) to a
// path in the bucket, makes it publicly readable, and returns its permanent
// public URL to store in Firestore.
async function uploadBuffer(buffer, destPath, contentType) {
  const file = bucket.file(destPath);
  try {
    await file.save(buffer, {
      metadata: { contentType, cacheControl: 'public, max-age=31536000' },
      resumable: false
    });
    await file.makePublic();
  } catch (e) {
    // The single most common cause here: Cloud Storage hasn't been enabled
    // for this Firebase project yet (Firebase Console > Build > Storage >
    // Get started), or FIREBASE_STORAGE_BUCKET doesn't match the project's
    // actual bucket name. Surface a clear message instead of a raw GCS error.
    const err = new Error(
      `Could not upload to Cloud Storage bucket "${bucket.name}". Make sure Cloud Storage ` +
      `is enabled for this Firebase project (Console > Build > Storage), and that the bucket ` +
      `name matches (see FIREBASE_STORAGE_BUCKET in README). Original error: ${e.message}`
    );
    err.cause = e;
    throw err;
  }
  return `https://storage.googleapis.com/${bucket.name}/${destPath}`;
}

// Downloads a file's bytes back as a Buffer, given either:
//   - a full https:// Cloud Storage URL previously returned by uploadBuffer(), or
//   - a bucket-relative path (e.g. "uploads/logo-123.png")
// Used where a Buffer is needed directly (e.g. embedding a logo into an XLSX
// file) rather than an <img src="..."> URL.
async function downloadBuffer(urlOrPath) {
  const destPath = urlOrPath.startsWith('http')
    ? decodeURIComponent(urlOrPath.split(`/${bucket.name}/`)[1] || '')
    : urlOrPath;
  if (!destPath) throw new Error(`Could not parse a storage path from "${urlOrPath}".`);
  const [buffer] = await bucket.file(destPath).download();
  return buffer;
}

module.exports = { uploadBuffer, downloadBuffer };
