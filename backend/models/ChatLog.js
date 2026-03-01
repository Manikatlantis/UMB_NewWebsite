const mongoose = require('mongoose');

// Stores Harbor chatbot conversations (optional — for analytics / future AI training)
const chatLogSchema = new mongoose.Schema({
  sessionId: { type: String, index: true },
  messages: [
    {
      role:    { type: String, enum: ['user', 'assistant'] },
      content: { type: String },
      ts:      { type: Date, default: Date.now },
    }
  ],
  createdAt: { type: Date, default: Date.now, expires: '180d' },
});

module.exports = mongoose.model('ChatLog', chatLogSchema);
