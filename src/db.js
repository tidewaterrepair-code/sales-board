'use strict';

// Tiny JSON-file database. Whole state lives in memory and is flushed to
// disk atomically (write temp file, then rename) after every change.
// Plenty for a sales team of a few dozen people.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EMPTY = () => ({
  users: [],
  sessions: [],
  leads: [],
  deals: [],
  events: [],
  settings: {},
  workflowOverrides: {},
});

class DB {
  constructor(file) {
    this.file = file;
    this.data = EMPTY();
    this._timer = null;
    if (file && fs.existsSync(file)) {
      try {
        this.data = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      } catch (err) {
        const backup = `${file}.corrupt-${Date.now()}`;
        fs.copyFileSync(file, backup);
        console.error(`[db] Could not parse ${file}; backed up to ${backup} and starting fresh.`);
      }
    }
  }

  get users() { return this.data.users; }
  get sessions() { return this.data.sessions; }
  get leads() { return this.data.leads; }
  get deals() { return this.data.deals; }
  get events() { return this.data.events; }
  get settings() { return this.data.settings; }
  get workflowOverrides() { return this.data.workflowOverrides; }

  save() {
    if (!this.file) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 50);
  }

  flush() {
    if (!this.file) return;
    clearTimeout(this._timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  reset() {
    this.data = EMPTY();
    this.save();
  }
}

const id = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

module.exports = { DB, id };
