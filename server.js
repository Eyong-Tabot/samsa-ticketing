require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB error:', err.message));

// --- MODELS ---
const movieSchema = new mongoose.Schema({
  title: String, description: String, posterUrl: String, genre: String, duration: Number, createdAt: { type: Date, default: Date.now }
});
const Movie = mongoose.model('Movie', movieSchema);

const showtimeSchema = new mongoose.Schema({
  movieId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movie' },
  date: String, time: String, priceGHS: Number, totalSeats: Number, availableSeats: Number
});
const Showtime = mongoose.model('Showtime', showtimeSchema);

// NEW: Booking Model to save seats
const bookingSchema = new mongoose.Schema({
  showtimeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Showtime' },
  seats: [String], // e.g. ["A1", "A2"]
  status: { type: String, default: 'pending' }, // pending or paid
  createdAt: { type: Date, default: Date.now }
});
const Booking = mongoose.model('Booking', bookingSchema);

// --- ROUTES ---

app.get('/ping', (req, res) => res.send('pong'));

app.get('/api/movies', async (req, res) => {
  try {
    const movies = await Movie.find().sort({ createdAt: -1 });
    res.json(movies);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/movies/:id/showtimes', async (req, res) => {
  try {
    const showtimes = await Showtime.find({ movieId: req.params.id }).sort({ time: 1 });
    res.json(showtimes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// NEW: Get all booked seats for a specific showtime
app.get('/api/showtimes/:id/booked-seats', async (req, res) => {
  try {
    const bookings = await Booking.find({ showtimeId: req.params.id });
    // Flatten the array of arrays into one simple list of seats: ["A1", "B5", etc.]
    const bookedSeats = bookings.reduce((acc, booking) => acc.concat(booking.seats), []);
    res.json(bookedSeats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// NEW: Save a new booking (lock the seats)
app.post('/api/bookings', async (req, res) => {
  try {
    const { showtimeId, seats } = req.body;
    const newBooking = new Booking({ showtimeId, seats, status: 'pending' });
    await newBooking.save();
    res.json({ message: 'Seats locked!', bookingId: newBooking._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Samsa running on port ${PORT}`));