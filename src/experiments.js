'use strict';

// Self-learning script tests (A/B testing that runs itself).
//
// Each script "slot" (the opener, and each workflow's pitch and close) can
// have several versions. For every lead, one version per slot is picked with
// Thompson sampling: versions that work better get picked more often, while
// weaker ones still get a little traffic so we keep learning. When one version
// is very likely the best (95% by default, after enough calls), it's promoted
// to the winner, the others are retired, and optionally the AI writes a new
// challenger to try to beat it. The loop never stops improving.

const crypto = require('node:crypto');
const { WORKFLOWS, OPENER, getWorkflow } = require('./workflows');

// What counts as a "win" for each kind of slot.
const KINDS = {
  opener: { label: 'Opener', goal: 'turned into a real conversation (callback, interested or sale)', wins: ['callback', 'interested', 'won'] },
  pitch: { label: 'Pitch', goal: 'got them interested (or sold)', wins: ['interested', 'won'] },
  close: { label: 'Close', goal: 'closed the sale', wins: ['won'] },
};
// Outcomes that mean the rep actually got to say their script.
const HEARD = ['not_interested', 'callback', 'interested', 'won'];

const kindOf = (slot) => slot.split(':')[0];
const workflowOf = (slot) => slot.split(':')[1];

function slotLabel(slot) {
  const w = getWorkflow(workflowOf(slot));
  return w ? `${KINDS[kindOf(slot)].label}: ${w.emoji} ${w.name}` : KINDS[kindOf(slot)].label;
}

function defaultText(slot) {
  if (slot === 'opener') return OPENER;
  const w = getWorkflow(workflowOf(slot));
  if (!w) return '';
  return kindOf(slot) === 'pitch' ? w.pitch : w.close;
}

const ALL_SLOTS = ['opener', ...WORKFLOWS.flatMap((w) => [`pitch:${w.id}`, `close:${w.id}`])];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// A ready-made challenger so the system starts learning on day one.
const SEED_CHALLENGERS = {
  opener: 'Hi, is this {{business}}? This is {{rep}}. Quick question, then I\'ll let you go: when you\'re on a job and miss a call, what usually happens to that customer?',
};

function variantsFor(db, slot) {
  return db.data.variants.filter((v) => v.slot === slot && v.status !== 'deleted');
}

function newVariant(db, { slot, text, origin, label }) {
  const existing = variantsFor(db, slot);
  const v = {
    id: `var_${crypto.randomBytes(5).toString('hex')}`,
    slot,
    label: label || `Version ${LETTERS[existing.length] || existing.length + 1}`,
    text: String(text).trim().slice(0, 1200),
    origin, // built-in | seed | manager | ai
    status: 'active', // active | paused | winner | retired
    shown: 0,
    wins: 0,
    createdAt: Date.now(),
  };
  db.data.variants.push(v);
  return v;
}

// The original script becomes "Version A" the first time a slot is tested.
function ensureOriginal(db, slot) {
  if (!variantsFor(db, slot).some((v) => v.origin === 'built-in')) {
    newVariant(db, { slot, text: defaultText(slot), origin: 'built-in', label: 'Version A (original)' });
  }
}

function seed(db) {
  if (db.data.system.experimentsSeeded) return;
  for (const [slot, text] of Object.entries(SEED_CHALLENGERS)) {
    ensureOriginal(db, slot);
    newVariant(db, { slot, text, origin: 'seed', label: 'Version B (question first)' });
  }
  db.data.system.experimentsSeeded = true;
  db.save();
}

// ---------- statistics ----------

// Random draws from a Beta distribution (via two Gamma draws).
function gamma(k, rand) {
  if (k < 1) return gamma(k + 1, rand) * rand() ** (1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x; let v;
    do {
      // Standard normal via Box-Muller.
      x = Math.sqrt(-2 * Math.log(rand() || 1e-12)) * Math.cos(2 * Math.PI * rand());
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function beta(a, b, rand) {
  const x = gamma(a, rand);
  return x / (x + gamma(b, rand));
}

// Chance each version is truly the best, estimated by simulation.
function probBest(variants, rand = Math.random, draws = 4000) {
  const wins = new Array(variants.length).fill(0);
  for (let i = 0; i < draws; i++) {
    let best = -1; let bestVal = -1;
    variants.forEach((v, j) => {
      const val = beta(1 + v.wins, 1 + Math.max(0, v.shown - v.wins), rand);
      if (val > bestVal) { bestVal = val; best = j; }
    });
    wins[best]++;
  }
  return wins.map((w) => w / draws);
}

// ---------- assignment + recording ----------

const live = (db, slot) => variantsFor(db, slot).filter((v) => v.status === 'active' || v.status === 'winner');

// Picks (once per lead, then sticky) which version of each tested slot the rep reads.
function assign(db, lead, rand = Math.random) {
  lead.variants = lead.variants || {};
  const out = {};
  for (const slot of ALL_SLOTS) {
    const options = live(db, slot);
    if (!options.length) continue;
    let chosen = options.find((v) => v.id === lead.variants[slot]);
    if (!chosen) {
      const winner = options.find((v) => v.status === 'winner');
      const testing = options.filter((v) => v.status === 'active');
      if (winner && !testing.length) chosen = winner;
      else {
        // Thompson sampling: draw a plausible success rate for each version, use the best draw.
        const pool = winner ? [winner, ...testing] : testing;
        let bestVal = -1;
        for (const v of pool) {
          const val = beta(1 + v.wins, 1 + Math.max(0, v.shown - v.wins), rand);
          if (val > bestVal) { bestVal = val; chosen = v; }
        }
      }
      lead.variants[slot] = chosen.id;
    }
    out[slot] = { variantId: chosen.id, label: chosen.label, text: chosen.text, testing: options.length > 1 };
  }
  return out;
}

// Records what happened on a call against the versions this lead heard.
// pitched = the workflows the rep pitched (pitch/close only count for those).
function record(db, lead, outcome, pitched = []) {
  if (!HEARD.includes(outcome) || !lead.variants) return [];
  lead.abResults = lead.abResults || {};
  const primary = pitched[0];
  const touched = [];
  for (const [slot, variantId] of Object.entries(lead.variants)) {
    const kind = kindOf(slot);
    if (kind !== 'opener') {
      if (outcome === 'won' ? !pitched.includes(workflowOf(slot)) : workflowOf(slot) !== primary) continue;
      if (kind === 'close' && pitched.length > 1 && outcome !== 'won') continue; // multi-workflow close uses a combined script
    }
    const v = db.data.variants.find((x) => x.id === variantId);
    if (!v) continue;
    const state = lead.abResults[slot];
    if (!state) { v.shown++; lead.abResults[slot] = 'shown'; touched.push(slot); }
    if (KINDS[kind].wins.includes(outcome) && lead.abResults[slot] !== 'win') {
      v.wins++;
      lead.abResults[slot] = 'win';
      if (!touched.includes(slot)) touched.push(slot);
    }
  }
  return touched;
}

// Decides whether a slot has a clear winner. Returns a log line if it promoted one.
function evaluate(db, slot, { minTrials = 30, confidence = 0.95, autoPromote = true, rand = Math.random } = {}) {
  const testing = live(db, slot).filter((v) => v.status === 'active' || v.status === 'winner');
  if (testing.length < 2 || !autoPromote) return null;
  if (testing.some((v) => v.shown < minTrials)) return null;
  const p = probBest(testing, rand);
  const i = p.findIndex((x) => x >= confidence);
  if (i < 0) return null;
  const winner = testing[i];
  if (winner.status === 'winner' && testing.length === 1) return null;
  for (const v of testing) {
    if (v === winner) { v.status = 'winner'; v.promotedAt = Date.now(); } else { v.status = 'retired'; v.retiredAt = Date.now(); }
  }
  const rate = (v) => (v.shown ? Math.round((v.wins / v.shown) * 100) : 0);
  const losers = testing.filter((v) => v !== winner).map((v) => `${v.label} (${rate(v)}%)`).join(', ');
  const line = `🏆 ${slotLabel(slot)}: "${winner.label}" won with ${rate(winner)}% vs ${losers}, after ${testing.reduce((s, v) => s + v.shown, 0)} calls. Everyone now uses it.`;
  log(db, line, { slot, winnerId: winner.id });
  return { winner, line };
}

function log(db, text, extra = {}) {
  db.data.system.learningLog = [{ at: Date.now(), text, ...extra }, ...(db.data.system.learningLog || [])].slice(0, 100);
  db.save();
}

function summary(db, slot, rand = Math.random) {
  const all = variantsFor(db, slot);
  const competing = all.filter((v) => v.status === 'active' || v.status === 'winner');
  const p = competing.length > 1 ? probBest(competing, rand, 3000) : competing.map(() => 1);
  return {
    slot,
    label: slotLabel(slot),
    kind: kindOf(slot),
    goal: KINDS[kindOf(slot)].goal,
    defaultText: defaultText(slot),
    variants: all.map((v) => {
      const idx = competing.indexOf(v);
      return { ...v, rate: v.shown ? Math.round((v.wins / v.shown) * 1000) / 10 : 0, chanceBest: idx >= 0 ? Math.round(p[idx] * 100) : null };
    }),
    totalCalls: all.reduce((s, v) => s + v.shown, 0),
  };
}

// Allowed fill-in fields in scripts; anything else is stripped from AI text.
const PLACEHOLDERS = ['business', 'rep', 'city', 'trade', 'customer', 'rating', 'reviews', 'setup', 'monthly', 'marketSetup', 'marketMonthly'];
function cleanText(text) {
  return String(text || '')
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (PLACEHOLDERS.includes(k) ? `{{${k}}}` : ''))
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .slice(0, 1200);
}

module.exports = { KINDS, HEARD, ALL_SLOTS, PLACEHOLDERS, slotLabel, defaultText, variantsFor, newVariant, ensureOriginal, seed, assign, record, evaluate, summary, probBest, beta, log, cleanText, kindOf, workflowOf };
