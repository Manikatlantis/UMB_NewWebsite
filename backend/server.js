require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const path    = require('path');
const connectDB = require('./config/db');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Connect to MongoDB ──────────────────────────
connectDB();

// ── Middleware ──────────────────────────────────
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());
app.use(morgan('dev'));

// ── Serve the front-end HTML ────────────────────
// The single-page HTML lives one level up from backend/
app.use(express.static(path.join(__dirname, '..')));

// ── API Routes ──────────────────────────────────
app.use('/api', require('./routes/api'));

// ── Health check ────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── Fallback — serve index HTML for any unknown path ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'umass-boston-v2.html'));
});

app.listen(PORT, () => {
  console.log(`UMass Boston server running on http://localhost:${PORT}`);
});
