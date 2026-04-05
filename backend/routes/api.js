const express       = require('express');
const router        = express.Router();
const Anthropic     = require('@anthropic-ai/sdk');
const Visit         = require('../models/Visit');
const ChatLog       = require('../models/ChatLog');
const BuildingPhoto = require('../models/BuildingPhoto');

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

When a user asks for a "campus tour", "show me around", or "drone tour", use the campus_tour tool with ALL 12 buildings as stops. Include every building on campus for a complete tour.

## Campus Buildings (use EXACT names in tool calls)
- Campus Center — Heart of student life, dining, organizations, events (2004, 331k SF)
- Integrated Sciences Complex — State-of-the-art research labs for biology, chemistry, physics (2015, LEED Gold)
- Healey Library — 11-story Brutalist tower, 700,000+ volumes, panoramic harbor views (1974)
- Quinn Administration — Administrative offices, Registrar, Bursar, leadership
- Wheatley Hall — College of Education, Nursing and Social Work
- McCormack Hall — Graduate studies, College of Liberal Arts
- Clark Athletic Center — Full rec center with gym, pool, courts, ice rink
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
      max_tokens: 600,
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
