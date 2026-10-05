#!/usr/bin/env node
'use strict';

// Emergency admin tool, run on the server itself. Works even if you forgot
// your PIN or got locked out of the app.
//
//   npm run admin -- list
//   npm run admin -- reset-pin "Alex" 4821
//   npm run admin -- make-owner "Alex"
//   npm run admin -- add-manager "Jamie" 5590
//   npm run admin -- delete "Old Rep"
//
// After a change, restart SalesBoard so it sees it:
//   sudo systemctl restart salesboard   (server)   or   Ctrl+C then npm start

const path = require('node:path');
const crypto = require('node:crypto');
const { openDefault } = require('../src/db');
const { hashPin, validPin } = require('../src/auth');

const db = openDefault(path.join(__dirname, '..', 'data'), process.env.DATA_FILE);
const [cmd, name, pin] = process.argv.slice(2);
const find = (n) => db.users.find((u) => u.name.toLowerCase() === String(n || '').toLowerCase());
const done = (msg) => { db.save(); db.close(); console.log(`✅ ${msg}\n   Now restart SalesBoard: sudo systemctl restart salesboard  (or Ctrl+C, then npm start)`); };
const fail = (msg) => { console.error(`❌ ${msg}`); process.exit(1); };

switch (cmd) {
  case 'list': {
    if (!db.users.length) console.log('No team members yet. Open the app to create the owner account.');
    for (const u of db.users) console.log(`${u.owner ? '👑' : u.role === 'manager' ? '🛠️ ' : '  '} ${u.name.padEnd(20)} ${u.role}${u.owner ? ' (owner)' : ''}${u.active === false ? ' · inactive' : ''}`);
    db.close();
    break;
  }
  case 'reset-pin': {
    const u = find(name);
    if (!u) fail(`No one named "${name}". Run: npm run admin -- list`);
    if (!validPin(pin)) fail('PIN must be 4 to 8 digits.');
    u.pinHash = hashPin(pin);
    u.active = true;
    db.data.sessions = db.sessions.filter((s) => s.userId !== u.id);
    done(`${u.name}'s PIN is now ${pin}.`);
    break;
  }
  case 'make-owner': {
    const u = find(name);
    if (!u) fail(`No one named "${name}". Run: npm run admin -- list`);
    for (const x of db.users) x.owner = false;
    u.owner = true;
    u.role = 'manager';
    u.active = true;
    done(`${u.name} is now the owner (full admin).`);
    break;
  }
  case 'add-manager': {
    if (!name) fail('Give a name, like: npm run admin -- add-manager "Jamie" 5590');
    if (find(name)) fail(`"${name}" already exists. Use reset-pin instead.`);
    if (!validPin(pin)) fail('PIN must be 4 to 8 digits.');
    db.users.push({ id: `usr_${crypto.randomBytes(6).toString('hex')}`, name, avatar: '🛠️', color: '#4f8cff', role: 'manager', owner: !db.users.some((u) => u.owner), pinHash: hashPin(pin), active: true, createdAt: Date.now() });
    done(`Added manager ${name} with PIN ${pin}.`);
    break;
  }
  case 'delete': {
    const u = find(name);
    if (!u) fail(`No one named "${name}".`);
    if (u.owner) fail('That\'s the owner. Make someone else the owner first (make-owner).');
    for (const l of db.leads) if (l.repId === u.id && l.status !== 'won') l.repId = null;
    db.data.users = db.users.filter((x) => x.id !== u.id);
    db.data.sessions = db.sessions.filter((s) => s.userId !== u.id);
    done(`Deleted ${u.name}. Their open leads went back to the pool.`);
    break;
  }
  default:
    console.log(`SalesBoard admin tool

  npm run admin -- list                         show everyone
  npm run admin -- reset-pin "Name" 1234        new PIN (also unlocks them)
  npm run admin -- make-owner "Name"            give someone full owner access
  npm run admin -- add-manager "Name" 1234      add a manager
  npm run admin -- delete "Name"                remove someone`);
    db.close();
}
