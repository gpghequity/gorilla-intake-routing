require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const rateLimit = require('express-rate-limit');
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });

// Trigger DB initialization at startup
require('./db/init');

const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
app.set('trust proxy', 1);
app.use(generalLimiter);
const PORT = process.env.PORT || 3001;

// Views
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static assets + uploads
app.use(express.static(path.join(__dirname, 'public')));

// Sessions (admin auth)
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12 // 12 hours
  }
}));

// Mount
app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

// Health check (both paths for auditor compatibility)
app.get('/_health', (_req, res) => res.json({ ok: true, service: 'gorilla-intake-routing' }));
app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'gorilla-intake-routing' }));

// 404
app.use((req, res) => {
  res.status(404).send(`Not found: ${req.path}`);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).send('Server error.');
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Gorilla Intake running on http://localhost:${PORT}`);
    console.log(`  Admin at http://localhost:${PORT}/admin (password = ADMIN_PASSWORD env var)\n`);
  });
}

module.exports = app;
