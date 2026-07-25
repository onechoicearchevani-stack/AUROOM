'use strict';

/**
 * loadMenu(db) — replaces the current menu with the canonical menu defined in
 * menu-data.json (categories + items, each in ka/en/ru). Clears existing
 * categories + menu_items first, then inserts. Orders are left untouched.
 * Items with a null price are inserted as hidden (is_available = 0).
 *
 * Used by:
 *   • seed.js               (manual `npm run seed`)
 *   • database.js           (one-time automatic seed on first boot)
 */

const fs = require('fs');
const path = require('path');

function loadMenu(db) {
  const menu = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'menu-data.json'), 'utf8')
  );

  const insertCat = db.prepare(
    'INSERT INTO categories (name_ka, name_en, name_ru, sort_order) VALUES (?, ?, ?, ?)'
  );
  const insertItem = db.prepare(`
    INSERT INTO menu_items
      (category_id, name_ka, name_en, name_ru,
       description_ka, description_en, description_ru,
       price, is_featured, is_available, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const run = db.transaction(() => {
    db.prepare('DELETE FROM menu_items').run();
    db.prepare('DELETE FROM categories').run();

    let catCount = 0, itemCount = 0, hidden = 0;
    menu.forEach((cat, ci) => {
      const c = insertCat.run(cat.name.ka, cat.name.en, cat.name.ru, ci);
      const categoryId = c.lastInsertRowid;
      catCount++;
      cat.items.forEach((it, ii) => {
        const [nk, ne, nr, dk, de, dr, price, featured] = it;
        const available = price === null ? 0 : 1;
        if (!available) hidden++;
        insertItem.run(
          categoryId, nk, ne, nr,
          dk || '', de || '', dr || '',
          price === null ? 0 : price,
          featured ? 1 : 0, available, ii
        );
        itemCount++;
      });
    });
    return { catCount, itemCount, hidden };
  });

  return run();
}

module.exports = { loadMenu };
