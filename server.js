require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Security basics
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

// Limit repeated requests (protects login later)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB error:', err.message));

// Movie model (simple version for Day 2)
const movieSchema = new mongoose.Schema({
  title: String,
  description: String,
  posterUrl: String,
  genre: String,
  duration: Number,
  createdAt: { type: Date, default: Date.now }
});
const Movie = mongoose.model('Movie', movieSchema);

// --- Routes ---

// Health check for UptimeRobot
app.get('/ping', (req, res) => {
  res.send('pong');
});

// List all movies
app.get('/api/movies', async (req, res) => {
  try {
    const movies = await Movie.find().sort({ createdAt: -1 });
    res.json(movies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve homepage
app.get('*', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Samsa running on port ${PORT}`));
