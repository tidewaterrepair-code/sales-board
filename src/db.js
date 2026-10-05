'use strict';

// Storage. The whole state lives in memory (fast reads, simple code) and is
// persisted to SQLite, writing only the records that changed since the last
// save. Falls back to a JSON file on Node versions without node:sqlite.
//
//   new DB('data/salesboard.db')  SQLite (default)
//   new DB('data/db.json')        JSON file (legacy)
//   new DB(null)                  memory only (tests)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ARRAYS = ['users', 'sessions', 'leads', 'deals', 'events', 'drips', 'variants'];
const OBJECTS = ['settings', 'workflowOverrides', 'usage', 'suppressed', 'dnc', 'system'];
const keyOf = (col, rec) => (col === 'sessions' ? rec.hash : rec.id);

const EMPTY = () => ({
  users: [],
  sessions: [],
  leads: [],
  deals: [],
  events: [],
  drips: [],
  variants: [],
  settings: {},
  workflowOverrides: {},
  usage: {},
  suppressed: [],
  dnc: [],
  system: {},
});

function loadSqlite() {
  // node:sqlite prints an "experimental" warning on load; keep logs clean.
  const original = process.emitWarning;
  process.emitWarning = (w, ...rest) => (String(w?.message || w).includes('SQLite') ? undefined : original.call(process, w, ...rest));
  try { return require('node:sqlite'); } catch { return null; } finally { process.emitWarning = original; }
}

class DB {
  constructor(file) {
    this.file = file;
    this.data = EMPTY();
    this.version = 0;
    this._timer = null;
    this.kind = !file ? 'memory' : file.endsWith('.json') ? 'json' : 'sqlite';
    if (this.kind === 'sqlite') {
      const sqlite = loadSqlite();
      if (!sqlite) {
        this.kind = 'json';
        this.file = file.replace(/\.[^.]+$/, '') + '.json';
        console.warn('[db] This Node version has no built-in SQLite; using a JSON file instead. Upgrade to Node 22.13+ for SQLite.');
      } else {
        this._openSqlite(sqlite);
        return;
      }
    }
    if (this.kind === 'json' && fs.existsSync(this.file)) this.data = { ...EMPTY(), ...readJson(this.file) };
  }

  _openSqlite(sqlite) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.sql = new sqlite.DatabaseSync(this.file);
    this.sql.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id));
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
    this._written = Object.fromEntries(ARRAYS.map((c) => [c, new Map()]));
    this._writtenKv = new Map();
    const rows = this.sql.prepare('SELECT col, id, data FROM docs ORDER BY rowid').all();
    for (const r of rows) {
      if (!this.data[r.col]) continue;
      this.data[r.col].push(JSON.parse(r.data));
      this._written[r.col].set(r.id, r.data);
    }
    for (const r of this.sql.prepare('SELECT key, data FROM kv').all()) {
      this.data[r.key] = JSON.parse(r.data);
      this._writtenKv.set(r.key, r.data);
    }
    this._eventsDirty = new Set();
  }

  get users() { return this.data.users; }
  get sessions() { return this.data.sessions; }
  get leads() { return this.data.leads; }
  get deals() { return this.data.deals; }
  get events() { return this.data.events; }
  get settings() { return this.data.settings; }
  get workflowOverrides() { return this.data.workflowOverrides; }

  // Events are append-only and can be huge, so they're diffed cheaply:
  // new rows are inserted, and code that edits an old event calls this.
  markDirty(col, rec) {
    if (col === 'events' && this._eventsDirty) this._eventsDirty.add(rec.id);
  }

  save() {
    this.version++;
    if (!this.file) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 50);
  }

  flush() {
    clearTimeout(this._timer);
    if (this.kind === 'json') {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
      return;
    }
    if (this.kind !== 'sqlite') return;
    const upsert = this.sql.prepare('INSERT INTO docs (col, id, data) VALUES (?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET data = excluded.data');
    const del = this.sql.prepare('DELETE FROM docs WHERE col = ? AND id = ?');
    const kvUpsert = this.sql.prepare('INSERT INTO kv (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data');
    this.sql.exec('BEGIN');
    try {
      for (const col of ARRAYS) {
        const written = this._written[col];
        const list = this.data[col] || [];
        if (col === 'events' && list.length >= written.size) {
          // Fast path: insert new events + any marked dirty.
          for (const e of list) {
            if (!written.has(e.id) || this._eventsDirty.has(e.id)) {
              const json = JSON.stringify(e);
              upsert.run(col, e.id, json);
              written.set(e.id, json);
            }
          }
          this._eventsDirty.clear();
          if (list.length === written.size) continue;
        }
        const seen = new Set();
        for (const rec of list) {
          const id = String(keyOf(col, rec));
          seen.add(id);
          const json = JSON.stringify(rec);
          if (written.get(id) !== json) { upsert.run(col, id, json); written.set(id, json); }
        }
        for (const id of [...written.keys()]) if (!seen.has(id)) { del.run(col, id); written.delete(id); }
      }
      for (const key of OBJECTS) {
        const json = JSON.stringify(this.data[key] ?? null);
        if (this._writtenKv.get(key) !== json) { kvUpsert.run(key, json); this._writtenKv.set(key, json); }
      }
      this.sql.exec('COMMIT');
    } catch (err) {
      this.sql.exec('ROLLBACK');
      throw err;
    }
  }

  // Consistent copy of the database file (for backups).
  backupTo(dest) {
    this.flush();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    if (this.kind === 'sqlite') this.sql.prepare('VACUUM INTO ?').run(dest);
    else if (this.kind === 'json') fs.copyFileSync(this.file, dest);
    else fs.writeFileSync(dest, JSON.stringify(this.data));
    return dest;
  }

  // One-time move from the old JSON file to SQLite.
  importFrom(data) {
    this.data = { ...EMPTY(), ...data };
    delete this.data.searchCache;
    this.save();
    this.flush();
  }

  close() {
    this.flush();
    if (this.sql) this.sql.close();
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const backup = `${file}.corrupt-${Date.now()}`;
    fs.copyFileSync(file, backup);
    console.error(`[db] Could not read ${file}; saved a copy to ${backup} and started fresh.`);
    return {};
  }
}

// Picks the data file and migrates an old db.json automatically.
function openDefault(dir, explicit) {
  if (explicit) return new DB(explicit);
  const sqliteFile = path.join(dir, 'salesboard.db');
  const legacy = path.join(dir, 'db.json');
  const fresh = !fs.existsSync(sqliteFile);
  const db = new DB(sqliteFile);
  if (fresh && db.kind === 'sqlite' && fs.existsSync(legacy)) {
    db.importFrom(readJson(legacy));
    fs.renameSync(legacy, `${legacy}.migrated`);
    console.log(`[db] Moved your data from db.json to ${sqliteFile} (old file kept as db.json.migrated).`);
  }
  return db;
}

const id = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

module.exports = { DB, id, openDefault };
