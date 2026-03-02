const express       = require('express');
const router        = express.Router();
const Visit         = require('../models/Visit');
const ChatLog       = require('../models/ChatLog');
const BuildingPhoto = require('../models/BuildingPhoto');

// ── POST /api/track ─────────────────────────────
// Front-end fires this to log user interactions
router.post('/track', async (req, res) => {
  try {
    const { sessionId, section, action, metadata } = req.body;
    await Visit.create({
      sessionId,
      section,
      action,
      metadata,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Tracking failed' });
  }
});

// ── POST /api/chat ──────────────────────────────
// Proxy endpoint — receives user message, calls Anthropic API,
// stores chat log, returns assistant reply.
// (Front-end static KB is used until this is called.)
router.post('/chat', async (req, res) => {
  const { sessionId, message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  // TODO: Replace KB logic with a real Anthropic API call here.
  // Example:
  //   const Anthropic = require('@anthropic-ai/sdk');
  //   const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  //   const resp = await client.messages.create({ model: 'claude-opus-4-6', max_tokens: 500,
  //     system: 'You are Harbor, the UMass Boston AI guide...', messages: [{ role: 'user', content: message }] });
  //   const reply = resp.content[0].text;

  // For now — simple placeholder reply
  const reply = `I'm Harbor, the UMass Boston guide! Backend chat is coming soon. Visit umb.edu for info.`;

  try {
    await ChatLog.findOneAndUpdate(
      { sessionId },
      { $push: { messages: [{ role: 'user', content: message }, { role: 'assistant', content: reply }] } },
      { upsert: true, new: true }
    );
  } catch (_) {}

  res.json({ reply });
});

// ── GET /api/maps-key ───────────────────────────
// Returns the Google Maps API key from env so it never appears in static HTML
router.get('/maps-key', (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: 'Maps key not configured' });
  res.json({ key });
});

// ── GET /api/stats ──────────────────────────────
// Simple analytics endpoint (admin use)
router.get('/stats', async (req, res) => {
  try {
    const [totalVisits, sectionBreakdown] = await Promise.all([
      Visit.countDocuments(),
      Visit.aggregate([
        { $group: { _id: '$section', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);
    res.json({ totalVisits, sectionBreakdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/building-photos/:building ──────────
// Fetch photos for a specific building (optional face/floor/col query params)
router.get('/building-photos/:building', async (req, res) => {
  try {
    const query = { building: req.params.building };
    if (req.query.face  !== undefined) query.face  = Number(req.query.face);
    if (req.query.floor !== undefined) query.floor = Number(req.query.floor);
    if (req.query.col   !== undefined) query.col   = Number(req.query.col);
    const photos = await BuildingPhoto.find(query).sort({ createdAt: -1 });
    res.json({ photos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/building-photos ───────────────────
// Create a photo record (admin use, for later)
router.post('/building-photos', async (req, res) => {
  try {
    const { building, face, floor, col, photoUrl, caption } = req.body;
    if (!building || face === undefined || !photoUrl) {
      return res.status(400).json({ error: 'building, face, and photoUrl are required' });
    }
    const photo = await BuildingPhoto.create({ building, face, floor, col, photoUrl, caption });
    res.status(201).json({ photo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
