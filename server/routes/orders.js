'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db/database');
const bus = require('../utils/events');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Limit how often a single IP can place orders (anti-spam).
const orderLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_orders' },
});

// Build a full order object (with its items) for sending to clients.
function getFullOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  return order;
}

// ── Public: place an order ────────────────────────────────────────
router.post('/', orderLimiter, (req, res) => {
  const { tableNumber, items, customerName, phone, note } = req.body || {};

  const table = Number(tableNumber);
  if (!Number.isInteger(table) || table < 1 || table > 40) {
    return res.status(400).json({ error: 'invalid_table' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'empty_order' });
  }

  // Re-price every line from the database — never trust prices from the client.
  const lines = [];
  let total = 0;
  for (const line of items) {
    const menuItem = db
      .prepare('SELECT * FROM menu_items WHERE id = ? AND is_available = 1')
      .get(Number(line.id));
    if (!menuItem) continue;
    const qty = Math.max(1, Math.min(50, parseInt(line.quantity, 10) || 1));
    total += menuItem.price * qty;
    lines.push({ menuItem, qty });
  }

  if (lines.length === 0) return res.status(400).json({ error: 'no_valid_items' });

  const createOrder = db.transaction(() => {
    const info = db
      .prepare(
        'INSERT INTO orders (table_number, customer_name, phone, note, total) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        table,
        (customerName || '').toString().slice(0, 80),
        (phone || '').toString().slice(0, 30),
        (note || '').toString().slice(0, 300),
        total
      );

    const insertLine = db.prepare(
      `INSERT INTO order_items
         (order_id, menu_item_id, name_ka, name_en, name_ru, price, quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const { menuItem, qty } of lines) {
      insertLine.run(
        info.lastInsertRowid,
        menuItem.id,
        menuItem.name_ka, menuItem.name_en, menuItem.name_ru,
        menuItem.price, qty
      );
    }
    return info.lastInsertRowid;
  });

  const orderId = createOrder();
  const fullOrder = getFullOrder(orderId);

  // Push to every connected kitchen/admin screen in real time.
  bus.emit('order', { type: 'new', order: fullOrder });

  res.status(201).json({ ok: true, orderId, total });
});

// ── Admin: live stream of orders (Server-Sent Events) ─────────────
router.get('/stream', authRequired, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Send current open orders immediately on connect.
  const open = db
    .prepare("SELECT id FROM orders WHERE status IN ('new','preparing') ORDER BY created_at")
    .all();
  res.write(`event: snapshot\ndata: ${JSON.stringify(open.map((o) => getFullOrder(o.id)))}\n\n`);

  const onEvent = (payload) => {
    res.write(`event: order\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  bus.on('order', onEvent);

  // Keep the connection alive through proxies.
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(ping);
    bus.off('order', onEvent);
  });
});

// ── Admin: list open orders (fallback if SSE is unavailable) ──────
router.get('/', authRequired, (req, res) => {
  const status = req.query.status;
  const rows =
    status && ['new', 'preparing', 'done'].includes(status)
      ? db.prepare('SELECT id FROM orders WHERE status = ? ORDER BY created_at').all(status)
      : db
          .prepare("SELECT id FROM orders WHERE status IN ('new','preparing') ORDER BY created_at")
          .all();
  res.json(rows.map((r) => getFullOrder(r.id)));
});

// ── Admin: change status (e.g. mark as preparing) ─────────────────
router.patch('/:id/status', authRequired, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!['new', 'preparing', 'done'].includes(status)) {
    return res.status(400).json({ error: 'invalid_status' });
  }
  const r = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  if (r.changes === 0) return res.status(404).json({ error: 'not_found' });
  bus.emit('order', { type: 'status', orderId: id, status });
  res.json({ ok: true });
});

// ── Admin: delete a finished order (clears it from the screen) ────
router.delete('/:id', authRequired, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(id); // order_items cascade
  bus.emit('order', { type: 'removed', orderId: id });
  res.json({ ok: true });
});

module.exports = router;
