'use strict';

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

/**
 * Reads the login token from the httpOnly cookie (preferred) or the
 * Authorization header, verifies it, and attaches the staff member to req.user.
 */
function authRequired(req, res, next) {
  const fromCookie = req.cookies && req.cookies.aurum_token;
  const header = req.headers.authorization || '';
  const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = fromCookie || fromHeader;

  if (!token) {
    return res.status(401).json({ error: 'auth_required' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

/**
 * Restricts a route to specific roles, e.g. requireRole('owner', 'manager').
 * Must be used after authRequired.
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  });
}

module.exports = { authRequired, requireRole, signToken, JWT_SECRET };
