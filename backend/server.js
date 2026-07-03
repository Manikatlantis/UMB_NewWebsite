require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const morgan    = require('morgan');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const path      = require('path');
const connectDB = require('./config/db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Connect to MongoDB ──────────────────────────
connectDB();

// ── Security headers ────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,   // CSP breaks inline scripts in single-page HTML
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow archive.org audio
}));

// ── CORS — restrict to production domain ────────
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length > 0
    ? function(origin, cb) {
        // Allow requests with no origin (curl, server-to-server, same-origin)
        if (!origin || allowedOrigins.includes(origin)) cb(null, true);
        else cb(new Error('CORS blocked'));
      }
    : true  // if no ALLOWED_ORIGIN set, allow all (dev mode)
}));

// ── Block sensitive file access ──────────────────
app.use((req, res, next) => {
  if (/\/\.git|\/\.env|\/\.DS_Store/i.test(req.path)) {
    return res.status(404).end();
  }
  next();
});

app.use(express.json());
app.use(morgan('dev'));

// ── Rate limiters ───────────────────────────────
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 15,               // 15 chat messages per minute per IP
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                    // 10 uploads per 15 min per IP
  message: { error: 'Upload limit reached. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,                    // 10 login attempts per 15 min
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Serve uploaded photos ───────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Serve the front-end HTML ────────────────────
app.use(express.static(path.join(__dirname, '..')));

// ── Apply rate limiters to specific routes ──────
app.use('/api/chat', chatLimiter);
app.use('/api/building-photos', uploadLimiter);
app.use('/admin/api/login', authLimiter);
app.use('/admin/api/setup', authLimiter);

// ── API Routes ──────────────────────────────────
app.use('/api', require('./routes/api'));

// ── Admin Panel ─────────────────────────────────
app.use('/admin/api', require('./routes/admin'));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin.html'));
});

// ── The Night Crossing — launched from the About section (and /experience) ──
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'umass-boston.html'));
});
app.get('/experience', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'prototypes', 'direction-b-drone.html'));
});
app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'umass-boston.html'));
});

// ── Health check ────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── Fallback — serve index HTML for any unknown path ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'umass-boston.html'));
});

app.listen(PORT, () => {
  console.log(`UMass Boston server running on http://localhost:${PORT}`);
});
