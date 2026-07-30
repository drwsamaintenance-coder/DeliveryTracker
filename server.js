const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
require('./db/init');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Cloud hosts (Render, Railway, etc.) sit behind a reverse proxy that terminates
// HTTPS — Express needs to know that so it reads the real client IP and, more
// importantly, so secure cookies (below) actually get set correctly.
if (isProduction) app.set('trust proxy', 1);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  // Set a real SESSION_SECRET environment variable in production — this
  // fallback is only meant for local/office use where the code isn't
  // exposed anywhere.
  secret: process.env.SESSION_SECRET || 'drwsa-maintenance-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12, // 12 hours
    secure: isProduction, // only send the cookie over HTTPS once actually deployed
    sameSite: isProduction ? 'none' : 'lax' // allows the app to work if the frontend and API ever end up on different subdomains
  }
}));

app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/users', require('./routes/users'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/settings', require('./routes/settings'));

// Fallback to login page
app.get('/', (req, res) => res.redirect('/login.html'));

// Catch upload/parsing errors (e.g. bad photo field, oversized/invalid file) and
// return JSON instead of an HTML error page, so the frontend can show a real message.
app.use((err, req, res, next) => {
  if (!err) return next();
  console.error(err);
  res.status(400).json({ error: err.message || 'Request failed.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`DRWSA Maintenance Delivery Tracking System running on http://0.0.0.0:${PORT}`);
  if (isProduction) {
    console.log('Running in production mode — reachable at whatever public URL your host assigned.');
  } else {
    console.log('On this LAN, other computers can connect using this machine\'s IP address, e.g. http://192.168.x.x:' + PORT);
  }
});
