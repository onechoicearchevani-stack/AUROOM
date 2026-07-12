'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db/database');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Image upload setup ────────────────────────────────────────────
// UPLOAD_DIR can be overridden with an env var so uploaded images can live on
// a persistent volume in production (e.g. UPLOADS_DIR=/data/uploads).
const UPLOAD_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB (images are normally resized client-side)
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(ok ? null : new Error('only_images_allowed'), ok);
  },
});

// ── Public read ───────────────────────────────────────────────────
// Public: only available items. Optional ?category=ID filter.
router.get('/', (req, res) => {
  const cat = req.query.category ? Number(req.query.category) : null;
  const rows = cat
    ? db
        .prepare(
          'SELECT * FROM menu_items WHERE is_available = 1 AND category_id = ? ORDER BY sort_order, id'
        )
        .all(cat)
    : db
        .prepare('SELECT * FROM menu_items WHERE is_available = 1 ORDER BY sort_order, id')
        .all();
  res.json(rows);
});

// Admin: every item, available or not.
router.get('/all', authRequired, (req, res) => {
  res.json(db.prepare('SELECT * FROM menu_items ORDER BY sort_order, id').all());
});

function validateItem(body) {
  const { name_ka, name_en, name_ru } = body || {};
  if (!name_ka || !name_en || !name_ru) return 'name_required_all_languages';
  if (body.price != null && (isNaN(Number(body.price)) || Number(body.price) < 0))
    return 'invalid_price';
  return null;
}

router.post('/', authRequired, requireRole('owner', 'manager'), (req, res) => {
  const err = validateItem(req.body);
  if (err) return res.status(400).json({ error: err });

  const b = req.body;
  const info = db
    .prepare(
      `INSERT INTO menu_items
         (category_id, name_ka, name_en, name_ru,
          description_ka, description_en, description_ru,
          price, image_url, is_available, is_featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      b.category_id || null,
      b.name_ka, b.name_en, b.name_ru,
      b.description_ka || '', b.description_en || '', b.description_ru || '',
      Number(b.price) || 0,
      b.image_url || '',
      b.is_available ? 1 : 0,
      b.is_featured ? 1 : 0,
      Number(b.sort_order) || 0
    );
  res.json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', authRequired, requireRole('owner', 'manager'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const err = validateItem(req.body);
  if (err) return res.status(400).json({ error: err });

  const b = req.body;
  db.prepare(
    `UPDATE menu_items SET
       category_id = ?, name_ka = ?, name_en = ?, name_ru = ?,
       description_ka = ?, description_en = ?, description_ru = ?,
       price = ?, image_url = ?, is_available = ?, is_featured = ?, sort_order = ?
     WHERE id = ?`
  ).run(
    b.category_id || null,
    b.name_ka, b.name_en, b.name_ru,
    b.description_ka || '', b.description_en || '', b.description_ru || '',
    Number(b.price) || 0,
    b.image_url != null ? b.image_url : existing.image_url,
    b.is_available ? 1 : 0,
    b.is_featured ? 1 : 0,
    Number(b.sort_order) || 0,
    id
  );
  res.json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id));
});

router.delete('/:id', authRequired, requireRole('owner', 'manager'), (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare('SELECT image_url FROM menu_items WHERE id = ?').get(id);
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
  // Clean up an uploaded image if it lived in our uploads folder.
  if (item && item.image_url && item.image_url.startsWith('/uploads/')) {
    const file = path.join(UPLOAD_DIR, path.basename(item.image_url));
    fs.promises.unlink(file).catch(() => {});
  }
  res.json({ ok: true });
});

// Upload an image, returns its public URL to store on a menu item.
router.post(
  '/upload',
  authRequired,
  requireRole('owner', 'manager'),
  upload.single('image'),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    res.json({ url: `/uploads/${req.file.filename}` });
  }
);

module.exports = router;
