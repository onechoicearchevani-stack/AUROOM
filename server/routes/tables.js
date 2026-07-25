'use strict';

const express = require('express');
const db = require('../db/database');

const router = express.Router();

// Public: the floor plan (tables 1..40) plus which tables currently have an
// open order, so the ordering screen can flag them as busy.
router.get('/', (req, res) => {
  const tables = db
    .prepare('SELECT table_number, seats, zone FROM restaurant_tables ORDER BY table_number')
    .all();

  const busyRows = db
    .prepare(
      "SELECT DISTINCT table_number FROM orders WHERE status IN ('new', 'preparing')"
    )
    .all();
  const busy = new Set(busyRows.map((r) => r.table_number));

  res.json(
    tables.map((t) => ({ ...t, busy: busy.has(t.table_number) }))
  );
});

module.exports = router;
