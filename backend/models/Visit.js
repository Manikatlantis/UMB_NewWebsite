const mongoose = require('mongoose');

// Tracks page visits and section interactions for analytics
const visitSchema = new mongoose.Schema({
  sessionId:  { type: String, index: true },
  page:       { type: String, default: '/' },
  section:    { type: String },           // e.g. 'campus-map', 'game', 'chatbot'
  action:     { type: String },           // e.g. 'map-pin-click', 'game-start', 'chat-send'
  metadata:   { type: mongoose.Schema.Types.Mixed },
  userAgent:  { type: String },
  ip:         { type: String },
  createdAt:  { type: Date, default: Date.now, expires: '90d' }, // auto-purge after 90 days
});

module.exports = mongoose.model('Visit', visitSchema);
