'use strict';

/**
 * Interactive helper to create the first owner account (or any staff account)
 * from the command line — handy for the very first setup before the web
 * registration form is reachable.
 *
 *   npm run create-admin
 */

const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('./database');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

(async () => {
  console.log('\n=== Create Aurum admin account ===\n');
  const username = (await ask('Username: ')).trim();
  const fullName = (await ask('Full name: ')).trim();
  const role = (await ask('Role (owner/manager/staff) [owner]: ')).trim() || 'owner';
  const password = (await ask('Password (min 8 chars): ')).trim();

  if (!username || password.length < 8) {
    console.error('\nUsername required and password must be at least 8 characters.');
    rl.close();
    process.exit(1);
  }

  const exists = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (exists) {
    console.error('\nThat username already exists.');
    rl.close();
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  db.prepare(
    'INSERT INTO admins (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(username, fullName, hash, role);

  console.log(`\nAccount "${username}" (${role}) created. You can now log in at /admin.\n`);
  rl.close();
  process.exit(0);
})();
