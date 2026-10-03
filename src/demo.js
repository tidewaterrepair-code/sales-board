'use strict';

// Seeds a demo sales team with two weeks of realistic activity so the
// leaderboard and dashboards look alive during training.

const { id } = require('./db');
const { hashPin } = require('./auth');
const { demoLeads, analyzeLead } = require('./leads');
const { buildDeal } = require('./setup');
const { POINTS } = require('./game');

const TEAM = [
  { name: 'Maria', avatar: '🦊', color: '#ff7a59' },
  { name: 'Jordan', avatar: '🐺', color: '#4f8cff' },
  { name: 'Tasha', avatar: '🦄', color: '#c065ff' },
  { name: 'Devon', avatar: '🐯', color: '#ffb020' },
  { name: 'Kenji', avatar: '🐼', color: '#21c38b' },
];

function seedDemo(db, catalog, settings, now = Date.now()) {
  let rnd = 42;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  const reps = TEAM.map((t) => {
    const existing = db.users.find((u) => u.name === t.name && u.demo);
    if (existing) return existing;
    const u = { id: id('usr'), ...t, role: 'rep', pinHash: hashPin('1234'), active: true, demo: true, createdAt: now };
    db.users.push(u);
    return u;
  });

  const industries = ['hvac', 'plumber', 'dentist', 'roofer', 'med_spa', 'auto_repair', 'salon', 'lawyer'];
  const skill = [1.0, 0.8, 0.65, 0.5, 0.35];
  const outcomes = ['no_answer', 'no_answer', 'no_answer', 'not_interested', 'callback', 'interested'];

  reps.forEach((rep, ri) => {
    for (let day = 13; day >= 0; day--) {
      if (rand() < 0.15) continue; // day off
      const dayStart = now - day * 86400000;
      const calls = Math.floor(10 + rand() * 25 * skill[ri]);
      for (let c = 0; c < calls; c++) {
        const type = pick(outcomes);
        db.events.push({ id: id('evt'), userId: rep.id, type, points: POINTS[type], label: '', createdAt: dayStart - Math.floor(rand() * 8 * 3600000), demo: true });
      }
      if (rand() < 0.35 * skill[ri] + 0.05) {
        const industry = pick(industries);
        const { leads } = demoLeads({ industryKey: industry, city: 'Virginia Beach, VA', page: Math.floor(rand() * 3) });
        const raw = pick(leads);
        if (db.leads.some((l) => l.placeId === raw.placeId)) continue;
        const createdAt = dayStart - Math.floor(rand() * 6 * 3600000);
        const analysis = analyzeLead(raw);
        const lead = { id: id('lead'), ...raw, analysis, repId: rep.id, status: 'won', claimedAt: createdAt - Math.floor(rand() * 2 * 86400000), lastActivityAt: createdAt, history: [], demo: true };
        db.leads.push(lead);
        const count = rand() < 0.3 ? 3 : rand() < 0.5 ? 2 : 1;
        const wfs = analysis.recommended.slice(0, count).map((wid) => catalog.find((w) => w.id === wid)).filter(Boolean);
        const deal = buildDeal({ lead, rep, workflows: wfs, contact: { name: 'Owner', email: '', phone: raw.phone }, notes: 'Demo deal', commissionRate: settings.commissionRate, now: createdAt });
        deal.demo = true;
        if (day > 2 && rand() < 0.8) { deal.status = 'paid'; deal.commissionStatus = 'earned'; deal.paidAt = createdAt + 86400000; }
        if (day > 8 && rand() < 0.5) { deal.commissionStatus = 'paid_out'; deal.status = 'live'; deal.workflows.forEach((w) => { w.status = 'live'; w.tasks.forEach((t) => { t.done = true; }); }); }
        db.deals.push(deal);
        db.events.push({ id: id('evt'), userId: rep.id, type: 'deal', points: deal.points, dealId: deal.id, leadId: lead.id, label: `closed ${wfs.map((w) => w.name).join(' + ')} for ${lead.name}`, createdAt, demo: true });
      }
    }
  });
  db.save();
  return reps.length;
}

function clearDemo(db) {
  db.data.users = db.users.filter((u) => !u.demo);
  db.data.leads = db.leads.filter((l) => !l.demo);
  db.data.deals = db.deals.filter((d) => !d.demo);
  db.data.events = db.events.filter((e) => !e.demo);
  db.save();
}

module.exports = { seedDemo, clearDemo };
