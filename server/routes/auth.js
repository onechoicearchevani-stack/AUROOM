'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const { authRequired, signToken } = require('../middleware/auth');

const router = express.Router();

// Brute-force protection on the login/register endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_attempts' },
});

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 12 * 60 * 60 * 1000,
});

// Register a staff/admin account. Requires the shared registration code so
// random visitors cannot create staff accounts.
router.post('/register', authLimiter, (req, res) => {
  const { username, password, fullName, role, registrationCode } = req.body || {};

  if (registrationCode !== (process.env.ADMIN_REGISTRATION_CODE || 'aurum-staff-2024')) {
    return res.status(403).json({ error: 'bad_registration_code' });
  }
  if (!username || typeof username !== 'string' || username.length < 3) {
    return res.status(400).json({ error: 'username_too_short' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'password_too_short' });
  }

  const allowedRoles = ['owner', 'manager', 'staff'];
  const safeRole = allowedRoles.includes(role) ? role : 'staff';

  const exists = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'username_taken' });

  const hash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare('INSERT INTO admins (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(username, fullName || '', hash, safeRole);

  const user = { id: info.lastInsertRowid, username, role: safeRole, fullName: fullName || '' };
  const token = signToken(user);
  res.cookie('aurum_token', token, cookieOptions());
  res.json({ user });
});

router.post('/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_credentials' });

  const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  // Always run a hash compare to reduce timing differences between
  // "user not found" and "wrong password".
  const ok = row
    ? bcrypt.compareSync(password, row.password_hash)
    : bcrypt.compareSync(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv');

  if (!row || !ok) return res.status(401).json({ error: 'invalid_credentials' });

  const user = { id: row.id, username: row.username, role: row.role, fullName: row.full_name };
  const token = signToken(user);
  res.cookie('aurum_token', token, cookieOptions());
  res.json({ user });
});

router.post('/logout', (req, res) => {
  res.clearCookie('aurum_token');
  res.json({ ok: true });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
