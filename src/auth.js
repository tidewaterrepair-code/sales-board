'use strict';

const crypto = require('node:crypto');

const SESSION_TTL = 30 * 86400000;
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60000;

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(pin), salt, 32);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

const validPin = (pin) => /^\d{4,8}$/.test(String(pin || ''));
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function createSession(db, userId, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('hex');
  db.data.sessions = db.sessions.filter((s) => s.expiresAt > now);
  db.sessions.push({ hash: tokenHash(token), userId, expiresAt: now + SESSION_TTL });
  db.save();
  return token;
}

function userFromToken(db, token, now = Date.now()) {
  if (!token) return null;
  const h = tokenHash(token);
  const s = db.sessions.find((x) => x.hash === h && x.expiresAt > now);
  if (!s) return null;
  const user = db.users.find((u) => u.id === s.userId && u.active !== false);
  return user || null;
}

function destroySession(db, token) {
  const h = tokenHash(token || '');
  db.data.sessions = db.sessions.filter((s) => s.hash !== h);
  db.save();
}

// Brute-force protection for short PINs.
const attempts = new Map();
function checkLock(userId, now = Date.now()) {
  const a = attempts.get(userId);
  return a && a.lockedUntil > now ? Math.ceil((a.lockedUntil - now) / 60000) : 0;
}
function recordFail(userId, now = Date.now()) {
  const a = attempts.get(userId) || { fails: 0, lockedUntil: 0 };
  a.fails++;
  if (a.fails >= MAX_FAILS) { a.lockedUntil = now + LOCK_MS; a.fails = 0; }
  attempts.set(userId, a);
}
const clearFails = (userId) => attempts.delete(userId);

module.exports = { hashPin, verifyPin, validPin, createSession, userFromToken, destroySession, checkLock, recordFail, clearFails };
