'use strict';

const express = require('express');
const db = require('../db/database');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

// Public: list active categories (all languages included so the client can
// switch language without refetching).
router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order, id')
    .all();
  res.json(rows);
});

// Admin: list every category, including hidden ones.
router.get('/all', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY sort_order, id').all();
  res.json(rows);
});

function validateCategory(body) {
  const { name_ka, name_en, name_ru } = body || {};
  if (!name_ka || !name_en || !name_ru) return 'name_required_all_languages';
  return null;
}

router.post('/', authRequired, requireRole('owner', 'manager'), (req, res) => {
  const err = validateCategory(req.body);
  if (err) return res.status(400).json({ error: err });

  const { name_ka, name_en, name_ru, sort_order = 0, is_active = 1 } = req.body;
  const info = db
    .prepare(
      'INSERT INTO categories (name_ka, name_en, name_ru, sort_order, is_active) VALUES (?, ?, ?, ?, ?)'
    )
    .run(name_ka, name_en, name_ru, Number(sort_order) || 0, is_active ? 1 : 0);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', authRequired, requireRole('owner', 'manager'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const err = validateCategory(req.body);
  if (err) return res.status(400).json({ error: err });

  const { name_ka, name_en, name_ru, sort_order, is_active } = req.body;
  db.prepare(
    `UPDATE categories
       SET name_ka = ?, name_en = ?, name_ru = ?, sort_order = ?, is_active = ?
     WHERE id = ?`
  ).run(
    name_ka,
    name_en,
    name_ru,
    Number(sort_order) || 0,
    is_active ? 1 : 0,
    id
  );
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id));
});

router.delete('/:id', authRequired, requireRole('owner', 'manager'), (req, res) => {
  const id = Number(req.params.id);
  // Menu items keep working — their category_id is set to NULL by the FK rule.
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
