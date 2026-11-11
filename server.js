require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Security & setup
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB error:', err.message));

// --- MODELS ---
const movieSchema = new mongoose.Schema({
  title: String,
  description: String,
  posterUrl: String,
  genre: String,
  duration: Number,
  createdAt: { type: Date, default: Date.now }
});
const Movie = mongoose.model('Movie', movieSchema);

const showtimeSchema = new mongoose.Schema({
  movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie' },
  date: String, // e.g., "Friday, Nov 15"
  time: String, // e.g., "7:00 PM"
  priceGHS: Number,
  totalSeats: Number,
  availableSeats: Number
});
const Showtime = mongoose.model('Showtime', showtimeSchema);

// --- ROUTES ---

app.get('/ping', (req, res) => res.send('pong'));

// Get all movies
app.get('/api/movies', async (req, res) => {
  try {
    const movies = await Movie.find().sort({ createdAt: -1 });
    res.json(movies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get showtimes for a specific movie
app.get('/api/movies/:id/showtimes', async (req, res) => {
  try {
    const showtimes = await Showtime.find({ movieId: req.params.id }).sort({ time: 1 });
    res.json(showtimes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve homepage
app.get('*', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Samsa running on port ${PORT}`));