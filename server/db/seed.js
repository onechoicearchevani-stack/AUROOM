'use strict';

/**
 * Load the real Aurum trilingual menu into the database.
 *
 *   npm run seed
 *
 * This REPLACES the current menu with the canonical version from
 * menu-data.json (clears categories + items, then re-inserts). Orders are not
 * touched. Normally you don't need to run this manually — the app auto-seeds
 * the menu on first boot — but it's handy to force a reset to the spreadsheet.
 */

const db = require('./database');
const { loadMenu } = require('./load-menu');

const { catCount, itemCount, hidden } = loadMenu(db);
db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('menu_seeded', '1')").run();

console.log(`Seeded ${catCount} categories and ${itemCount} menu items.`);
if (hidden) {
  console.log(`(${hidden} item(s) had no price in the source — added as HIDDEN; set a price in the admin panel to show them.)`);
}
process.exit(0);
