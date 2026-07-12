'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the first proxy hop (needed for secure cookies / rate-limit IPs
// when running behind Nginx or a platform load balancer).
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── API routes ────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/tables', require('./routes/tables'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/settings', require('./routes/settings'));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Static frontend ───────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Serve uploaded images explicitly so they work even when stored outside the
// public/ folder (e.g. on a persistent volume in production).
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(PUBLIC_DIR, 'uploads');
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  })
);

app.use(
  express.static(PUBLIC_DIR, {
    extensions: ['html'],
    etag: true,
    lastModified: true,
    // Always revalidate HTML/CSS/JS so site updates appear immediately after a
    // deploy (no stale cached pages). Files are tiny, so the cost is trivial.
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (/\.(html|css|js)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

// Friendly routes for the admin panel (also no-cache so they stay fresh).
const noCacheHtml = (res) => res.setHeader('Cache-Control', 'no-cache');
app.get('/admin', (req, res) => { noCacheHtml(res); res.sendFile(path.join(PUBLIC_DIR, 'admin.html')); });
app.get('/order', (req, res) => { noCacheHtml(res); res.sendFile(path.join(PUBLIC_DIR, 'order.html')); });

// 404 for unknown API calls; everything else falls back to the homepage.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  noCacheHtml(res);
  res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err && err.message === 'only_images_allowed') {
    return res.status(400).json({ error: 'only_images_allowed' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'file_too_large' });
  }
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

const server = app.listen(PORT, () => {
  console.log(`\n  Aurum Restaurant running →  http://localhost:${PORT}`);
  console.log(`  Public site:  /`);
  console.log(`  Order page:   /order`);
  console.log(`  Admin panel:  /admin\n`);
});

// Graceful shutdown so hosting platforms can stop/redeploy cleanly.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`\n${signal} received — shutting down.`);
    server.close(() => process.exit(0));
    // Force-exit if connections linger too long.
    setTimeout(() => process.exit(0), 10000).unref();
  });
}
