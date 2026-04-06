const express    = require('express');
const router     = express.Router();
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const { authenticator } = require('otplib');
const QRCode     = require('qrcode');
const fs         = require('fs');
const path       = require('path');
const BuildingPhoto = require('../models/BuildingPhoto');

// ── Config ──
const JWT_SECRET    = process.env.ADMIN_JWT_SECRET || 'change-me-in-production-' + require('crypto').randomBytes(16).toString('hex');
const JWT_EXPIRY    = '2h';
const TOTP_ISSUER   = 'UMassBoston Admin';
const SECRETS_FILE  = path.join(__dirname, '..', '.admin-secrets.json');

// Rate limiting: track failed attempts per IP
const loginAttempts = new Map();
const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return true;
  if (Date.now() - record.lastAttempt > LOCKOUT_MS) {
    loginAttempts.delete(ip);
    return true;
  }
  return record.count < MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const record = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  loginAttempts.set(ip, record);
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

// ── Load/save admin secrets ──
function loadSecrets() {
  try {
    if (fs.existsSync(SECRETS_FILE)) {
      return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
    }
  } catch (e) { console.error('Error loading admin secrets:', e.message); }
  return null;
}

function saveSecrets(data) {
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ── JWT middleware ──
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

// ── POST /admin/api/setup ──
// Initial setup: set passphrase and generate TOTP secret
// Only works if no admin has been set up yet
router.post('/setup', async (req, res) => {
  const existing = loadSecrets();
  if (existing && existing.setupComplete) {
    return res.status(403).json({ error: 'Admin already configured. Delete .admin-secrets.json on the server to reset.' });
  }

  const { passphrase } = req.body;
  if (!passphrase || passphrase.length < 12) {
    return res.status(400).json({ error: 'Passphrase must be at least 12 characters.' });
  }

  const hash = await bcrypt.hash(passphrase, 12);
  const totpSecret = authenticator.generateSecret();

  // Generate QR code for Google Authenticator
  const otpauthUrl = authenticator.keyuri('admin', TOTP_ISSUER, totpSecret);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  // Save but mark setup as incomplete until TOTP is verified
  saveSecrets({ passphraseHash: hash, totpSecret, setupComplete: false });

  res.json({ qrDataUrl, totpSecret, message: 'Scan QR code with Google Authenticator, then verify with a code.' });
});

// ── POST /admin/api/verify-setup ──
// Complete setup by verifying TOTP code
router.post('/verify-setup', (req, res) => {
  const secrets = loadSecrets();
  if (!secrets || !secrets.totpSecret) {
    return res.status(400).json({ error: 'Run setup first.' });
  }
  if (secrets.setupComplete) {
    return res.status(403).json({ error: 'Already configured.' });
  }

  const { code } = req.body;
  const valid = authenticator.verify({ token: code, secret: secrets.totpSecret });
  if (!valid) {
    return res.status(400).json({ error: 'Invalid code. Try again.' });
  }

  secrets.setupComplete = true;
  saveSecrets(secrets);

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.json({ success: true, token });
});

// ── POST /admin/api/login ──
router.post('/login', async (req, res) => {
  const ip = req.ip;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  }

  const secrets = loadSecrets();
  if (!secrets || !secrets.setupComplete) {
    return res.json({ needsSetup: true });
  }

  const { passphrase, totpCode } = req.body;
  if (!passphrase || !totpCode) {
    return res.status(400).json({ error: 'Passphrase and authenticator code required.' });
  }

  // Verify passphrase
  const passMatch = await bcrypt.compare(passphrase, secrets.passphraseHash);
  if (!passMatch) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  // Verify TOTP
  const totpValid = authenticator.verify({ token: totpCode, secret: secrets.totpSecret });
  if (!totpValid) {
    recordFailedAttempt(ip);
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  clearAttempts(ip);
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.json({ success: true, token });
});

// ── GET /admin/api/check ──
// Check if admin is set up and if token is valid
router.get('/check', (req, res) => {
  const secrets = loadSecrets();
  if (!secrets || !secrets.setupComplete) {
    return res.json({ setupComplete: false, authenticated: false });
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      jwt.verify(authHeader.slice(7), JWT_SECRET);
      return res.json({ setupComplete: true, authenticated: true });
    } catch (e) {}
  }
  res.json({ setupComplete: true, authenticated: false });
});

// ── GET /admin/api/photos ──
// List all photos (including pending/rejected)
router.get('/photos', requireAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.building) filter.building = req.query.building;
    const photos = await BuildingPhoto.find(filter).sort({ createdAt: -1 }).limit(200);
    const total  = await BuildingPhoto.countDocuments();
    res.json({ photos, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /admin/api/photos/:id ──
// Update photo status (approve/reject)
router.patch('/photos/:id', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'pending', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    const photo = await BuildingPhoto.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!photo) return res.status(404).json({ error: 'Photo not found.' });
    res.json({ photo });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /admin/api/photos/:id ──
// Permanently delete a photo
router.delete('/photos/:id', requireAuth, async (req, res) => {
  try {
    const photo = await BuildingPhoto.findById(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found.' });

    // Delete file from disk
    if (photo.photoUrl && photo.photoUrl.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '..', photo.photoUrl);
      fs.unlink(filePath, () => {});
    }

    await BuildingPhoto.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
