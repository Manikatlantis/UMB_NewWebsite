const mongoose = require('mongoose');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected:', mongoose.connection.host);
  } catch (err) {
    // Do NOT exit — the site must keep serving (pages, maps key, chat) without a DB.
    // Only analytics, chat logs, and gallery reads/writes degrade until MONGO_URI works.
    console.error('MongoDB connection error:', err.message);
    console.error('Continuing WITHOUT a database — /api/track, chat logs, and building photos will fail until MONGO_URI is fixed.');
  }
}

module.exports = connectDB;
