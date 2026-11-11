require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');

const app = express();
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
  paymentReference: String, // CamerPay transaction_uuid
  createdAt: { type: Date, default: Date.now }
});
const Booking = mongoose.model('Booking', bookingSchema);

// --- ADMIN AUTH MIDDLEWARE ---
const adminAuth = (req, res, next) => {
  const adminPassword = req.headers.authorization;
  if (adminPassword === process.env.ADMIN_PASSWORD) next();
  else res.status(401).json({ error: 'Unauthorized: Wrong password' });
};

// --- PUBLIC ROUTES ---
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

// --- PAIEMENT CAMERPAY : INITIALISATION ---
app.post('/api/payments/initialize', async (req, res) => {
  try {
    const { showtimeId, seats, email, name, phone } = req.body;
    const showtime = await Showtime.findById(showtimeId);
    if (!showtime) return res.status(404).json({ error: 'Showtime not found' });

    const totalAmount = showtime.priceGHS * seats.length;
    
    // 1. Créer la réservation en attente
    const booking = new Booking({
      showtimeId, seats, customerName: name, customerEmail: email, 
      customerPhone: phone, totalAmountXAF: totalAmount
    });
    await booking.save();

    // CamerPay attend un format de numéro spécifique (+237...)
    const formattedPhone = phone.startsWith('+237') ? phone : `+237${phone.replace(/^0+/, '')}`;

    // 2. Demander le lien de paiement à CamerPay
    const payload = {
      amount: totalAmount,
      currency: 'XAF',
      payment_method: 'mobile_money', // Force le choix MoMo/OM
      customer_phone: formattedPhone,
      customer_email: email,
      customer_name: name,
      merchant_invoice_id: booking._id.toString(), // Référence unique interne
      merchant_callback_url: `${req.headers.origin}/api/payments/webhook`, // Pour la confirmation serveur
      merchant_return_url: `${req.headers.origin}/?booking=${booking._id}`, // Retour du client
      idempotency_key: `samsa-${booking._id}` // Anti-doublon
    };

    const response = await axios.post('https://camerpay.biz/api/payment/initiate', payload, {
      headers: { 
        'Authorization': `Bearer ${process.env.CAMERPAY_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    // 3. Sauvegarder l'UUID de transaction et renvoyer l'URL au frontend
    booking.paymentReference = response.data.transaction_uuid;
    await booking.save();

    res.json({ 
      success: true, 
      redirect_url: response.data.pay_url, // L'URL vers laquelle rediriger
      bookingId: booking._id 
    });

  } catch (err) {
    console.error('CamerPay Error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Payment initialization failed.' });
  }
});

// --- PAIEMENT CAMERPAY : VÉRIFICATION ---
app.get('/api/payments/verify/:bookingId', async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    if (booking.status === 'paid') return res.json({ status: 'success' });

    // Interroger CamerPay pour connaître le statut de la transaction
    const response = await axios.get(`https://camerpay.biz/api/payment/${booking.paymentReference}/status`, {
      headers: { 'Authorization': `Bearer ${process.env.CAMERPAY_API_KEY}` }
    });

    const status = response.data.status; // 'completed', 'pending', 'failed', etc.

    if (status === 'completed') {
      booking.status = 'paid';
      await booking.save();
      res.json({ status: 'success' });
    } else if (status === 'failed') {
      res.json({ status: 'failed' });
    } else {
      res.json({ status: 'pending' }); // Le client n'a pas encore entré son code
    }

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ADMIN ROUTES ---
app.post('/api/admin/movies', adminAuth, async (req, res) => {
  try {
    const newMovie = new Movie(req.body);
    await newMovie.save();
    res.json(newMovie);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/showtimes', adminAuth, async (req, res) => {
  try {
    const { movieId, date, time, priceGHS } = req.body;
    const newShowtime = new Showtime({ movieId, date, time, priceGHS, totalSeats: 50, availableSeats: 50 });
    await newShowtime.save();
    res.json(newShowtime);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/bookings', adminAuth, async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate({ path: 'showtimeId', populate: { path: 'movieId', select: 'title' } })
      .sort({ createdAt: -1 });
    res.json(bookings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('*', (req, res) => res.sendFile(__dirname + '/public/index.html'));
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Samsa running on port ${PORT}`));