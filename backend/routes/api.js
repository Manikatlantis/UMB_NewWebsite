const express       = require('express');
const router        = express.Router();
const Anthropic     = require('@anthropic-ai/sdk');
const multer        = require('multer');
const fs            = require('fs');
const path          = require('path');
const xml2js        = require('xml2js');
const Visit         = require('../models/Visit');
const ChatLog       = require('../models/ChatLog');
const BuildingPhoto = require('../models/BuildingPhoto');

// ── HTML sanitization ──
function escapeHtml(str) {
  if (!str) return str;
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Multer config for photo uploads ──
const photoStorage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'photos'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`);
  }
});
const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files allowed'), false);
  }
}).single('photo');

// ── Events feed cache ──
const EVENTS_FEED_URL = 'https://25livepub.collegenet.com/calendars/umb-featured-events.rss';
let eventsCache = null;
let eventsCacheTime = 0;
const EVENTS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const KNOWN_BUILDINGS = [
  { name: 'Campus Center', lat: 42.3133, lng: -71.0387 },
  { name: 'Integrated Sciences Complex', lat: 42.3138, lng: -71.0367 },
  { name: 'Healey Library', lat: 42.3127, lng: -71.0397 },
  { name: 'Quinn Administration', lat: 42.3148, lng: -71.0385 },
  { name: 'Wheatley Hall', lat: 42.3143, lng: -71.0378 },
  { name: 'McCormack Hall', lat: 42.3130, lng: -71.0405 },
  { name: 'Clark Athletic Center', lat: 42.3122, lng: -71.0420 },
  { name: 'University Hall', lat: 42.3135, lng: -71.0372 },
  { name: 'West Garage', lat: 42.3145, lng: -71.0360 },
  { name: 'JFK Presidential Library', lat: 42.3098, lng: -71.0370 },
  { name: 'West Residence Hall', lat: 42.3168, lng: -71.0405 },
  { name: 'East Residence Hall', lat: 42.3158, lng: -71.0395 },
];

// ── Anthropic client (lazy-init on first chat) ──
let anthropic = null;
function getAnthropic() {
  if (!anthropic && process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'sk-ant-...') {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

const HARBOR_SYSTEM = `You are Harbor, the UMass Boston AI campus guide. You are enthusiastic, knowledgeable, and speak like a friendly tour guide.

You have access to a live 3D drone camera on the campus map. When a user asks to SEE, VISIT, FLY TO, GO TO, or SHOW a building, you MUST use the fly_to_building tool AND provide a 2-3 sentence narration about that building.

When a user asks for a "campus tour", "show me around", or "drone tour", use the campus_tour tool with EXACTLY these 12 stops in this order: ["Campus Center", "Healey Library", "Integrated Sciences Complex", "McCormack Hall", "Wheatley Hall", "Quinn Administration", "University Hall", "Clark Athletic Center", "West Garage", "JFK Presidential Library", "West Residence Hall", "East Residence Hall"]. ALWAYS include all 12. Never skip any.

## Campus Buildings (use EXACT names in tool calls)
- Campus Center — Heart of student life, dining, organizations, events (2004, 331k SF)
- Integrated Sciences Complex — State-of-the-art research labs for biology, chemistry, physics (2015, LEED Gold)
- Healey Library — 11-story Brutalist tower, 700,000+ volumes, panoramic harbor views (1974)
- Quinn Administration — Administrative offices, Registrar, Bursar, leadership
- Wheatley Hall — College of Education, Nursing and Social Work
- McCormack Hall — Graduate studies, College of Liberal Arts
- Clark Athletic Center — Full rec center with gym, courts, fitness center, ice rink
- University Hall — Computer Science, Math, and Sciences classrooms and labs (2016, LEED Gold)
- West Garage — 8-level campus parking garage, 1,400 spaces
- JFK Presidential Library — Iconic I.M. Pei landmark dedicated to President Kennedy (1979)
- West Residence Hall — On-campus student housing with harbor views
- East Residence Hall — On-campus student residence, suite-style living near waterfront

## Aliases (resolve these to exact building names)
- "library" / "books" → Healey Library
- "gym" / "athletic" / "pool" / "fitness" / "sports" → Clark Athletic Center
- "science" / "ISC" / "labs" / "chemistry" / "biology" / "physics" → Integrated Sciences Complex
- "admin" / "registrar" / "bursar" → Quinn Administration
- "JFK" / "Kennedy" / "presidential" → JFK Presidential Library
- "parking" / "garage" → West Garage
- "CS" / "computer" / "math" / "tech" → University Hall
- "nursing" / "education" / "social work" → Wheatley Hall
- "food" / "dining" / "student center" / "cafeteria" → Campus Center
- "liberal arts" / "graduate" → McCormack Hall
- "dorm" / "housing" / "residence" / "live on campus" → West Residence Hall
- "east dorm" / "east residence" → East Residence Hall

For non-tour questions (tuition, admissions, programs, etc.), answer helpfully using your knowledge of UMass Boston. Do NOT use tools for informational questions.

Keep responses concise — 2-4 sentences max for tour narrations. Use HTML formatting: <strong>, <br>, <ul>/<li>, <a href="..." target="_blank"> for links.

CRITICAL: You MUST ALWAYS include a text response alongside any tool call. Never return only a tool call with no text. The text appears in the chat while the tool controls the camera.`;

const HARBOR_TOOLS = [
  {
    name: 'fly_to_building',
    description: 'Fly the 3D drone camera to a specific campus building and highlight it on the map. Use when the user wants to SEE or VISIT a building.',
    input_schema: {
      type: 'object',
      properties: {
        building_name: {
          type: 'string',
          description: 'Exact building name from the campus list (e.g. "Healey Library", "Clark Athletic Center")'
        }
      },
      required: ['building_name']
    }
  },
  {
    name: 'campus_tour',
    description: 'Start a multi-stop guided drone tour flying between key campus buildings. Use when the user asks for a tour or to "show me around".',
    input_schema: {
      type: 'object',
      properties: {
        stops: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ordered list of exact building names to visit on the tour'
        }
      },
      required: ['stops']
    }
  }
];

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
// AI-powered chat with drone tour capabilities via Claude tool_use
router.post('/chat', async (req, res) => {
  const { sessionId, message, history } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  const client = getAnthropic();
  if (!client) {
    // No API key configured — return fallback signal
    return res.json({ reply: null, actions: [], fallback: true });
  }

  try {
    // Build conversation messages (last 10 for context)
    const messages = [];
    if (Array.isArray(history)) {
      for (const h of history.slice(-10)) {
        if (h.role === 'user' || h.role === 'assistant') {
          messages.push({ role: h.role, content: h.content });
        }
      }
    }
    messages.push({ role: 'user', content: message });

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: HARBOR_SYSTEM,
      tools: HARBOR_TOOLS,
      messages,
    });

    // Extract text blocks and tool_use blocks
    let reply = '';
    const actions = [];
    for (const block of resp.content) {
      if (block.type === 'text') {
        reply += block.text;
      } else if (block.type === 'tool_use') {
        if (block.name === 'fly_to_building') {
          actions.push({ type: 'fly_to', building: block.input.building_name });
        } else if (block.name === 'campus_tour') {
          actions.push({ type: 'campus_tour', stops: block.input.stops });
        }
      }
    }

    // Fallback narration if Claude returned tool_use but no text
    if (!reply.trim() && actions.length > 0) {
      const buildingName = actions[0].building || (actions[0].stops && actions[0].stops[0]) || '';
      if (actions[0].type === 'fly_to') {
        reply = `Let me fly you over to <strong>${buildingName}</strong>! Taking the drone camera there now.`;
      } else if (actions[0].type === 'campus_tour') {
        reply = `Let's take a guided drone tour of UMass Boston! I'll fly you to ${actions[0].stops.length} key buildings across campus.`;
      }
    }

    // Store in MongoDB
    try {
      await ChatLog.findOneAndUpdate(
        { sessionId },
        { $push: { messages: [{ role: 'user', content: message }, { role: 'assistant', content: reply }] } },
        { upsert: true, new: true }
      );
    } catch (_) {}

    res.json({ reply, actions });
  } catch (err) {
    console.error('Anthropic API error:', err.message);
    res.json({ reply: null, actions: [], fallback: true });
  }
});

// ── GET /api/maps-key ───────────────────────────
// Returns the Google Maps API key from env so it never appears in static HTML
router.get('/maps-key', (req, res) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: 'Maps key not configured' });
  res.json({ key });
});

// ── GET /api/walking-route ──────────────────────
// Returns walking route waypoints between two campus coordinates
// Uses Google Directions API, caches results to minimize API calls
const walkingRouteCache = new Map();

router.get('/walking-route', async (req, res) => {
  const { origin, destination } = req.query;
  if (!origin || !destination) {
    return res.status(400).json({ error: 'origin and destination required (lat,lng)' });
  }
  const key = process.env.GOOGLE_DIRECTIONS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: 'Directions API key not configured' });

  const cacheKey = `${origin}|${destination}`;
  if (walkingRouteCache.has(cacheKey)) {
    return res.json(walkingRouteCache.get(cacheKey));
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=walking&key=${key}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== 'OK' || !data.routes || !data.routes.length) {
      return res.json({ points: [], duration: '' });
    }

    const route = data.routes[0];
    const encoded = route.overview_polyline.points;
    const points = decodePolyline(encoded);
    const duration = route.legs[0] ? route.legs[0].duration.text : '';

    const result = { points, duration };
    walkingRouteCache.set(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.error('Walking route error:', e.message);
    res.json({ points: [], duration: '' });
  }
});

// Decode Google's encoded polyline format
function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

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

// ── GET /api/building-photos ─────────────────────
// Fetch all approved photos, optionally filtered by building
router.get('/building-photos', async (req, res) => {
  try {
    const query = { status: 'approved' };
    if (req.query.building) query.building = req.query.building;
    if (req.query.season) query.season = req.query.season;
    const photos = await BuildingPhoto.find(query).sort({ createdAt: -1 }).limit(100);
    res.json({ photos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/building-photos/:building ──────────
// Fetch photos for a specific building (optional face/floor/col query params)
router.get('/building-photos/:building', async (req, res) => {
  try {
    const query = { building: req.params.building, status: 'approved' };
    if (req.query.face  !== undefined) query.face  = Number(req.query.face);
    if (req.query.floor !== undefined) query.floor = Number(req.query.floor);
    if (req.query.col   !== undefined) query.col   = Number(req.query.col);
    const photos = await BuildingPhoto.find(query).sort({ createdAt: -1 });
    res.json({ photos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Image moderation via Claude Vision ──
async function moderateImage(filePath, mimeType) {
  const client = getAnthropic();
  if (!client) return { safe: true }; // skip if no API key

  const imageData = fs.readFileSync(filePath).toString('base64');
  const mediaType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
          { type: 'text', text: 'You are a content moderator for a university campus website. Analyze this image and respond with ONLY a JSON object: {"safe": true} or {"safe": false, "reason": "brief reason"}. Reject if the image contains: nudity/sexual content, graphic violence/gore, hate symbols/slurs, political campaign material/propaganda, drugs/drug paraphernalia, weapons, spam/ads, or anything not appropriate for a public university website. A normal photo of a campus building, landscape, students, or campus life is safe.' }
        ]
      }]
    });

    const text = resp.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { safe: true };
  } catch (e) {
    console.error('Moderation check failed:', e.message);
    return { safe: true }; // allow on error to not block uploads
  }
}

// ── POST /api/building-photos ───────────────────
// Upload a photo for a building (multipart/form-data with 'photo' file field)
router.post('/building-photos', (req, res) => {
  uploadPhoto(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const { building, face, floor, col, caption, season, uploadedBy } = req.body;
      if (!building || face === undefined) {
        return res.status(400).json({ error: 'building and face are required' });
      }

      // Moderate uploaded image before accepting
      if (req.file) {
        const result = await moderateImage(req.file.path, req.file.mimetype);
        if (!result.safe) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({
            error: 'Photo rejected: ' + (result.reason || 'Content not appropriate for a university website.')
          });
        }
      }

      // Quick text check on caption
      if (caption && caption.length > 500) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(400).json({ error: 'Caption too long (500 char max).' });
      }

      const photoUrl = req.file
        ? `/uploads/photos/${req.file.filename}`
        : req.body.photoUrl;
      if (!photoUrl) {
        return res.status(400).json({ error: 'photo file or photoUrl is required' });
      }
      const photo = await BuildingPhoto.create({
        building: escapeHtml(building), face: Number(face), floor: Number(floor || 0), col: Number(col || 0),
        photoUrl, caption: escapeHtml(caption) || '', season: escapeHtml(season) || '',
        uploadedBy: escapeHtml(uploadedBy) || 'Anonymous', status: 'approved'
      });
      res.status(201).json({ photo });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

// ── GET /api/events ─────────────────────────────
// Proxy + cache UMB events feed, match locations to campus buildings
router.get('/events', async (req, res) => {
  try {
    const now = Date.now();
    if (eventsCache && (now - eventsCacheTime) < EVENTS_CACHE_TTL) {
      return res.json(eventsCache);
    }

    const feedResp = await fetch(EVENTS_FEED_URL);
    if (!feedResp.ok) throw new Error('Feed fetch failed: ' + feedResp.status);
    const xml = await feedResp.text();

    const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
    const items = parsed.rss && parsed.rss.channel && parsed.rss.channel.item;
    if (!items) return res.json({ events: [] });

    const rawItems = Array.isArray(items) ? items : [items];
    const events = rawItems.slice(0, 20).map(item => {
      const title = item.title || '';
      const link = item.link || '';
      const description = (item.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const pubDate = item.pubDate || '';

      // Try to extract location from description
      let location = '';
      const locMatch = description.match(/(?:Location|Where|Room|Building):\s*([^.]+)/i);
      if (locMatch) location = locMatch[1].trim();

      // Match against known buildings — pick the one mentioned earliest in description
      let buildingMatch = null;
      const searchText = (description + ' ' + location).toLowerCase();
      let earliestPos = Infinity;
      for (const b of KNOWN_BUILDINGS) {
        const pos = searchText.indexOf(b.name.toLowerCase());
        if (pos !== -1 && pos < earliestPos) {
          earliestPos = pos;
          buildingMatch = { name: b.name, lat: b.lat, lng: b.lng };
        }
      }

      return { title, link, description: description.slice(0, 200), pubDate, location, buildingMatch };
    });

    eventsCache = { events };
    eventsCacheTime = now;
    res.json({ events });
  } catch (err) {
    console.error('Events fetch error:', err.message);
    res.json({ events: [], error: 'Could not load events' });
  }
});

module.exports = router;
