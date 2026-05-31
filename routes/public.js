const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const db = require('../db/init');
const { detectListed, detectStorage } = require('../lib/routing');
const email = require('../lib/email');
const sheets = require('../lib/sheetsLogger');

const router = express.Router();

// Multer storage — save to public/uploads, keep original extension
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${base}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 12 }
});

// --- Helpers ---------------------------------------------------------------

function normalizePayload(body) {
  // Multer may give scalar or array; normalize checkbox groups to arrays.
  const out = { ...body };
  // Known multi-select fields
  for (const key of ['property_types', 'focus']) {
    if (out[key] !== undefined && !Array.isArray(out[key])) {
      out[key] = [out[key]];
    }
  }
  return out;
}

function insertSubmission({ type, payload, listed, storageFlag }) {
  const id = crypto.randomUUID();
  const initialStatus = (type === 'seller' && listed) ? 'broker_review' : 'new';

  db.prepare(`
    INSERT INTO submissions (id, type, status, payload, listed_flag, storage_flag)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    type,
    initialStatus,
    JSON.stringify(payload),
    listed ? 1 : 0,
    storageFlag ? 1 : 0
  );

  return db.prepare(`SELECT * FROM submissions WHERE id = ?`).get(id);
}

function insertUploads(submissionId, files) {
  if (!files || files.length === 0) return;
  const stmt = db.prepare(`
    INSERT INTO uploads (id, submission_id, filename, path, mimetype, size)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const f of files) {
    stmt.run(
      crypto.randomUUID(),
      submissionId,
      f.originalname,
      path.posix.join('/uploads', f.filename),
      f.mimetype,
      f.size
    );
  }
}

async function fireEmail(submission) {
  try {
    await email.notifyNewSubmission(submission);
  } catch (err) {
    console.error('[public] notifyNewSubmission failed:', err.message);
  }
}

// --- Landing ---------------------------------------------------------------

router.get('/', (_req, res) => {
  res.render('layout', { page: 'index', title: 'Gorilla Realty — Intake' });
});

// --- Buyer -----------------------------------------------------------------

router.get('/buyer', (_req, res) => {
  res.render('layout', { page: 'buyer', title: 'Buyer Introduction — Gorilla Realty' });
});

router.post('/buyer', express.urlencoded({ extended: true }), (req, res) => {
  const payload = normalizePayload(req.body);
  const submission = insertSubmission({
    type: 'buyer',
    payload,
    listed: false,
    storageFlag: false
  });
  fireEmail(submission);
  // Fire-and-forget — Sheets write must never block the response
  // Pass parsed payload object (submission.payload in DB is a JSON string)
  sheets.logBuyer({ ...submission, payload }).catch(err =>
    console.error('[public] sheets.logBuyer error:', err.message)
  );
  res.render('layout', { page: 'thanks', title: 'Thanks — Gorilla Realty', reference: submission.id });
});

// --- Seller ----------------------------------------------------------------

router.get('/seller', (_req, res) => {
  res.render('layout', { page: 'seller', title: 'Submit a Deal — Gorilla Realty' });
});

router.post('/seller', upload.array('uploads', 12), (req, res) => {
  const payload = normalizePayload(req.body);
  const listed = detectListed(payload);
  const storageFlag = detectStorage(payload);

  const submission = insertSubmission({
    type: 'seller',
    payload,
    listed,
    storageFlag
  });

  insertUploads(submission.id, req.files);
  fireEmail(submission);
  // Fire-and-forget — Sheets write must never block the response
  sheets.logSeller({ ...submission, payload }).catch(err =>
    console.error('[public] sheets.logSeller error:', err.message)
  );

  res.render('layout', { page: 'thanks', title: 'Thanks — Gorilla Realty', reference: submission.id });
});

// --- Join ------------------------------------------------------------------

router.get('/join', (_req, res) => {
  res.render('layout', { page: 'join', title: 'Join Gorilla Realty' });
});

router.post('/join', express.urlencoded({ extended: true }), (req, res) => {
  const payload = normalizePayload(req.body);
  const submission = insertSubmission({
    type: 'agent',
    payload,
    listed: false,
    storageFlag: false
  });
  fireEmail(submission);
  // Fire-and-forget — Sheets write must never block the response
  sheets.logAgent({ ...submission, payload }).catch(err =>
    console.error('[public] sheets.logAgent error:', err.message)
  );
  res.render('layout', { page: 'thanks', title: 'Thanks — Gorilla Realty', reference: submission.id });
});

module.exports = router;
