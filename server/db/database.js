'use strict';

/**
 * Database layer for Aurum Restaurant.
 *
 * Uses Node's built-in SQLite module (node:sqlite, available in Node 22.5+ and
 * stable in Node 24). This keeps the app fully self-contained with ZERO native
 * compilation — no better-sqlite3, no node-gyp, no Python/Visual Studio build
 * tools required. Ideal for a single restaurant box or a cheap VPS.
 *
 * A thin wrapper adds .pragma() and .transaction() helpers so the rest of the
 * codebase keeps the same familiar (better-sqlite3-style) API.
 *
 * To migrate to PostgreSQL/MySQL later, only this file and the queries inside
 * the route modules need changing — the rest of the app is storage-agnostic.
 */

const path = require('path');
const fs = require('fs');

// node:sqlite is marked "experimental" and prints a warning on first use.
// It is stable enough for this app; silence only that one warning so the
// startup console stays clean. All other warnings pass through normally.
const _emitWarning = process.emitWarning.bind(process);
process.emitWarning = function (warning, ...args) {
  const message = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  const type = args[0] && typeof args[0] === 'object' ? args[0].type : args[0];
  if (type === 'ExperimentalWarning' && /SQLite/i.test(message)) return;
  return _emitWarning(warning, ...args);
};

const { DatabaseSync } = require('node:sqlite');

// DATA_DIR can be overridden with an env var so the database can live on a
// persistent volume in production (e.g. Railway/Render disk mounted at /data).
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'aurum.db'));

// ── Compatibility helpers ─────────────────────────────────────────
// node:sqlite has no .pragma(); use exec.
db.pragma = function (statement) {
  this.exec('PRAGMA ' + statement + ';');
};

// node:sqlite has no .transaction(); emulate better-sqlite3's behaviour:
// returns a function that runs `fn` inside BEGIN/COMMIT (ROLLBACK on throw)
// and returns whatever `fn` returns.
db.transaction = function (fn) {
  const self = this;
  return function (...args) {
    self.exec('BEGIN');
    try {
      const result = fn.apply(this, args);
      self.exec('COMMIT');
      return result;
    } catch (err) {
      try { self.exec('ROLLBACK'); } catch (_) { /* ignore */ }
      throw err;
    }
  };
};

// Reliability + concurrency settings.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    full_name     TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'staff',  -- 'owner' | 'manager' | 'staff'
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name_ka     TEXT NOT NULL,
    name_en     TEXT NOT NULL,
    name_ru     TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    name_ka        TEXT NOT NULL,
    name_en        TEXT NOT NULL,
    name_ru        TEXT NOT NULL,
    description_ka TEXT NOT NULL DEFAULT '',
    description_en TEXT NOT NULL DEFAULT '',
    description_ru TEXT NOT NULL DEFAULT '',
    price          REAL NOT NULL DEFAULT 0,
    image_url      TEXT NOT NULL DEFAULT '',
    is_available   INTEGER NOT NULL DEFAULT 1,
    is_featured    INTEGER NOT NULL DEFAULT 0,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Fixed floor plan: tables 1..40
  CREATE TABLE IF NOT EXISTS restaurant_tables (
    table_number INTEGER PRIMARY KEY,
    seats        INTEGER NOT NULL DEFAULT 4,
    zone         TEXT NOT NULL DEFAULT 'main'   -- main | terrace | hall
  );

  CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    table_number  INTEGER NOT NULL,
    status        TEXT NOT NULL DEFAULT 'new',  -- new | preparing | done
    customer_name TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '',
    total         REAL NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id INTEGER,
    name_ka      TEXT NOT NULL,
    name_en      TEXT NOT NULL,
    name_ru      TEXT NOT NULL,
    price        REAL NOT NULL,
    quantity     INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_menu_category ON menu_items(category_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orderitems_order ON order_items(order_id);

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Floor plan: 40 tables numbered 13..52. If an older numbering (e.g. 1..40) is
// present, it is reset to this scheme once (tracked via the meta table).
const TABLE_START = 13;
const TABLE_END = 52;
const wantScheme = `${TABLE_START}-${TABLE_END}`;
const tablesScheme = db.prepare("SELECT value FROM meta WHERE key = 'tables_scheme'").get();
if (!tablesScheme || tablesScheme.value !== wantScheme) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO restaurant_tables (table_number, seats, zone) VALUES (?, ?, ?)'
  );
  const reset = db.transaction(() => {
    db.prepare('DELETE FROM restaurant_tables').run();
    let idx = 0;
    for (let n = TABLE_START; n <= TABLE_END; n++) {
      const zone = idx < 28 ? 'main' : idx < 36 ? 'hall' : 'terrace';
      const seats = idx % 5 === 0 ? 6 : idx % 3 === 0 ? 2 : 4;
      insert.run(n, seats, zone);
      idx++;
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('tables_scheme', ?)").run(wantScheme);
  });
  reset();
}

// One-time automatic menu load on first boot (e.g. a fresh production volume).
// Runs only when no menu has ever been seeded AND the menu is currently empty,
// so it never overwrites a menu you've edited. To force a reset to the
// spreadsheet later, run `npm run seed`.
try {
  const marker = db.prepare("SELECT value FROM meta WHERE key = 'menu_seeded'").get();
  const menuCount = db.prepare('SELECT COUNT(*) AS c FROM menu_items').get().c;
  if (!marker && menuCount === 0) {
    const { loadMenu } = require('./load-menu');
    const res = loadMenu(db);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('menu_seeded', '1')").run();
    console.log(`Menu auto-loaded: ${res.catCount} categories, ${res.itemCount} items.`);
  }
} catch (err) {
  console.error('Menu auto-load skipped:', err.message);
}

module.exports = db;
