'use strict';

/**
 * Editable site content (about text, contacts, gallery images, socials).
 * Stored as a single JSON blob in the settings table under key 'site_content'.
 *
 *   GET  /api/settings         public   → current content (with sane defaults)
 *   PUT  /api/settings         owner/manager → replace content
 */

const express = require('express');
const db = require('../db/database');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();
const KEY = 'site_content';

const DEFAULTS = {
  hero_location: { ka: '', en: '', ru: '' },
  hero_subtitle: { ka: '', en: '', ru: '' },
  about_eyebrow: { ka: '', en: '', ru: '' },
  about_title: { ka: '', en: '', ru: '' },
  about: { ka: '', en: '', ru: '' },
  stats: [], // [{ num: '12', label: {ka,en,ru} }]
  phone: '',
  address: '',
  hours: '',
  email: '',
  instagram: '',
  facebook: '',
  gallery: [], // array of image URLs like "/uploads/xxx.jpg"
};

function readContent() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
  if (!row) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(row.value) };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

router.get('/', (req, res) => {
  res.json(readContent());
});

router.put('/', authRequired, requireRole('owner', 'manager'), (req, res) => {
  const b = req.body || {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const tri = (o) => ({ ka: str(o && o.ka), en: str(o && o.en), ru: str(o && o.ru) });

  const content = {
    hero_location: tri(b.hero_location),
    hero_subtitle: tri(b.hero_subtitle),
    about_eyebrow: tri(b.about_eyebrow),
    about_title: tri(b.about_title),
    about: tri(b.about),
    stats: Array.isArray(b.stats)
      ? b.stats.slice(0, 6).map((s) => ({ num: str(s && s.num), label: tri(s && s.label) }))
      : [],
    phone: str(b.phone),
    address: str(b.address),
    hours: str(b.hours),
    email: str(b.email),
    instagram: str(b.instagram),
    facebook: str(b.facebook),
    gallery: Array.isArray(b.gallery)
      ? b.gallery.filter((u) => typeof u === 'string' && u.startsWith('/uploads/')).slice(0, 24)
      : [],
  };

  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(KEY, JSON.stringify(content));

  res.json(content);
});

module.exports = router;
