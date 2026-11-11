require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');

const app = express();

// FIX: Trust the Render proxy for the rate limiter
app.set('trust proxy', 1);

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

const bookingSchema = new mongoose.Schema({
  showtimeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Showtime' },
  seats: [String],
  customerName: String,
  customerEmail: String,
  customerPhone: String,
  totalAmountXAF: Number,
  status: { type: String, default: 'pending' }, 
  paymentReference: String,
  createdAt: { type: Date, default: Date.now }
});
const Booking = mongoose.model('Booking', bookingSchema);

// --- ROUTES ---
app.get('/ping', (req, res) => res.send('pong'));

app.get('/api/movies', async (req, res) => {
  try { res.json(await Movie.find().sort({ createdAt: -1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/movies/:id/showtimes', async (req, res) => {
  try { res.json(await Showtime.find({ movieId: req.params.id }).sort({ time: 1 })); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/showtimes/:id/booked-seats', async (req, res) => {
  try {
    const bookings = await Booking.find({ showtimeId: req.params.id });
    const bookedSeats = bookings.reduce((acc, booking) => acc.concat(booking.seats), []);
    res.json(bookedSeats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Initialize Campay Payment (USSD Push) - NOW USING DEMO URL
app.post('/api/payments/initialize', async (req, res) => {
  try {
    const { showtimeId, seats, email, name, phone } = req.body;
    
    const showtime = await Showtime.findById(showtimeId);
    if (!showtime) return res.status(404).json({ error: 'Showtime not found' });

    const totalAmount = showtime.priceGHS * seats.length;
    
    const booking = new Booking({
      showtimeId, seats, customerName: name, customerEmail: email, 
      customerPhone: phone, totalAmountXAF: totalAmount
    });
    await booking.save();

    const formattedPhone = phone.startsWith('237') ? phone : `237${phone.replace(/^0+/, '')}`;

    // CHANGED TO DEMO.CAMPAY.NET
    const response = await axios.post('https://demo.campay.net/api/collect/', {
      amount: totalAmount.toString(),
      currency: 'XAF',
      from: formattedPhone,
      description: `Movie Tickets: ${seats.join(', ')}`,
      external_reference: booking._id.toString()
    }, {
      headers: { 
        'Authorization': `Token ${process.env.CAMPAY_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    booking.paymentReference = response.data.reference;
    await booking.save();

    res.json({ 
      success: true, 
      message: 'USSD prompt sent to your phone. Please enter your PIN.',
      bookingId: booking._id 
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Could not initiate Mobile Money payment. Check the phone number.' });
  }
});

// Verify Payment - NOW USING DEMO URL
app.get('/api/payments/verify/:bookingId', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    if (booking.status === 'paid') return res.json({ status: 'success' });

    // CHANGED TO DEMO.CAMPAY.NET
    const response = await axios.get(`https://demo.campay.net/api/transaction/${booking.paymentReference}/`, {
      headers: { 'Authorization': `Token ${process.env.CAMPAY_TOKEN}` }
    });

    if (response.data.status === 'SUCCESSFUL') {
      booking.status = 'paid';
      await booking.save();
      res.json({ status: 'success' });
    } else if (response.data.status === 'FAILED') {
      res.json({ status: 'failed' });
    } else {
      res.json({ status: 'pending' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => res.sendFile(__dirname + '/public/index.html'));
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Samsa running on port ${PORT}`));