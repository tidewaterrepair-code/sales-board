'use strict';

// Points, levels, badges, streaks and leaderboards.

const POINTS = {
  no_answer: 1,
  not_interested: 1,
  callback: 2,
  interested: 5,
  email: 3, // got their email (they go into the drip)
  perSetupDollars: 10, // 1 point per $10 of setup fees sold
  bundleBonus: 25, // per extra workflow in the same deal
  speedBonus: 20, // closed within 24h of claiming the lead
};

const CALL_TYPES = ['no_answer', 'not_interested', 'callback', 'interested'];

const LEVELS = [
  { name: 'Rookie', emoji: '🐣', min: 0 },
  { name: 'Hustler', emoji: '💪', min: 250 },
  { name: 'Closer', emoji: '🎯', min: 750 },
  { name: 'Shark', emoji: '🦈', min: 2000 },
  { name: 'Legend', emoji: '👑', min: 5000 },
];

const BADGES = [
  { id: 'first_close', name: 'First Close', emoji: '🎯', desc: 'Close your first deal' },
  { id: 'hat_trick', name: 'Hat Trick', emoji: '🎩', desc: '3 closes in one day' },
  { id: 'dialer', name: 'Dial Machine', emoji: '📞', desc: 'Log 50 calls' },
  { id: 'bundle_boss', name: 'Bundle Boss', emoji: '📦', desc: 'Sell 3+ workflows in one deal' },
  { id: 'speed_demon', name: 'Speed Demon', emoji: '⚡', desc: 'Close a lead within 24h of claiming it' },
  { id: 'on_fire', name: 'On Fire', emoji: '🔥', desc: '5-day activity streak' },
  { id: 'big_earner', name: 'Big Earner', emoji: '💰', desc: 'Earn $1,000+ in commission' },
];

function dealPoints({ setupTotal, workflowCount, speed }) {
  const base = Math.round(setupTotal / POINTS.perSetupDollars);
  const bundle = Math.max(0, workflowCount - 1) * POINTS.bundleBonus;
  const fast = speed ? POINTS.speedBonus : 0;
  return { base, bundle, fast, total: base + bundle + fast };
}

function levelFor(points) {
  let current = LEVELS[0];
  for (const l of LEVELS) if (points >= l.min) current = l;
  const next = LEVELS[LEVELS.indexOf(current) + 1] || null;
  const progress = next ? (points - current.min) / (next.min - current.min) : 1;
  return { ...current, next, progress: Math.max(0, Math.min(1, progress)) };
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function periodStart(period, now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'today') return d.getTime();
  if (period === 'week') {
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - dow);
    return d.getTime();
  }
  if (period === 'month') {
    d.setDate(1);
    return d.getTime();
  }
  return 0;
}

const liveDeals = (deals) => deals.filter((d) => d.status !== 'cancelled');
const liveEvents = (events) => events.filter((e) => !e.voided);

function streakFor(events, userId, now = Date.now()) {
  const days = new Set(liveEvents(events).filter((e) => e.userId === userId).map((e) => dayKey(e.createdAt)));
  let streak = 0;
  const d = new Date(now);
  // A streak survives until the end of today even if you haven't dialed yet.
  if (!days.has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d.getTime()))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function maxStreak(events, userId) {
  const days = [...new Set(liveEvents(events).filter((e) => e.userId === userId).map((e) => {
    const d = new Date(e.createdAt); d.setHours(0, 0, 0, 0); return d.getTime();
  }))].sort((a, b) => a - b);
  let best = 0; let run = 0; let prev = null;
  for (const t of days) {
    run = prev != null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

function badgesFor(db, userId) {
  const deals = liveDeals(db.deals).filter((d) => d.repId === userId);
  const events = liveEvents(db.events).filter((e) => e.userId === userId);
  const earned = new Set();
  if (deals.length) earned.add('first_close');
  const perDay = {};
  for (const d of deals) perDay[dayKey(d.createdAt)] = (perDay[dayKey(d.createdAt)] || 0) + 1;
  if (Object.values(perDay).some((n) => n >= 3)) earned.add('hat_trick');
  if (events.filter((e) => CALL_TYPES.includes(e.type)).length >= 50) earned.add('dialer');
  if (deals.some((d) => d.workflows.length >= 3)) earned.add('bundle_boss');
  if (deals.some((d) => d.speedBonus)) earned.add('speed_demon');
  if (maxStreak(db.events, userId) >= 5) earned.add('on_fire');
  if (deals.reduce((s, d) => s + d.commission, 0) >= 1000) earned.add('big_earner');
  return BADGES.map((b) => ({ ...b, earned: earned.has(b.id) }));
}

// Leaderboard is computed in one pass over events/deals and memoized until
// the next save (db.version) or the next minute, so polling stays cheap.
const boardCaches = new WeakMap();
function leaderboard(db, period = 'week', now = Date.now()) {
  if (!boardCaches.has(db)) boardCaches.set(db, new Map());
  const boardCache = boardCaches.get(db);
  const key = `${db.version}|${period}|${Math.floor(now / 60000)}`;
  const hit = boardCache.get(key);
  if (hit) return hit.map((r) => ({ ...r }));
  const start = periodStart(period, now);
  const per = new Map();
  const bucket = (uid) => {
    if (!per.has(uid)) per.set(uid, { points: 0, calls: 0, allTime: 0, deals: 0, setupRevenue: 0, commission: 0, any: false });
    return per.get(uid);
  };
  for (const e of db.events) {
    if (e.voided) continue;
    const b = bucket(e.userId);
    b.any = true;
    b.allTime += e.points;
    if (e.createdAt >= start) {
      b.points += e.points;
      if (CALL_TYPES.includes(e.type)) b.calls++;
    }
  }
  for (const d of db.deals) {
    if (d.status === 'cancelled' || d.createdAt < start) continue;
    const b = bucket(d.repId);
    b.deals++;
    b.setupRevenue += d.setupTotal;
    b.commission += d.commission;
  }
  // Reps always show; managers only show once they've logged activity themselves.
  const onBoard = (u) => u.active !== false && (u.role === 'rep' || per.get(u.id)?.any);
  const rows = db.users.filter(onBoard).map((u) => {
    const b = per.get(u.id) || bucket(u.id);
    return {
      userId: u.id,
      name: u.name,
      avatar: u.avatar,
      color: u.color,
      points: b.points,
      calls: b.calls,
      deals: b.deals,
      setupRevenue: b.setupRevenue,
      commission: round2(b.commission),
      level: levelFor(b.allTime),
      streak: streakFor(db.events, u.id, now),
    };
  });
  rows.sort((a, b) => b.points - a.points || b.commission - a.commission || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  if (boardCache.size > 50) boardCache.clear();
  boardCache.set(key, rows);
  return rows.map((r) => ({ ...r }));
}

function repStats(db, userId, settings, now = Date.now()) {
  const todayStart = periodStart('today', now);
  const events = liveEvents(db.events).filter((e) => e.userId === userId);
  const deals = liveDeals(db.deals).filter((d) => d.repId === userId);
  const allTimePoints = events.reduce((s, e) => s + e.points, 0);
  const sum = (arr) => round2(arr.reduce((s, d) => s + d.commission, 0));
  const board = leaderboard(db, 'week', now);
  return {
    points: allTimePoints,
    level: levelFor(allTimePoints),
    streak: streakFor(db.events, userId, now),
    weekRank: board.find((r) => r.userId === userId)?.rank || null,
    weekPoints: board.find((r) => r.userId === userId)?.points || 0,
    teamSize: board.length,
    today: {
      calls: events.filter((e) => e.createdAt >= todayStart && CALL_TYPES.includes(e.type)).length,
      closes: deals.filter((d) => d.createdAt >= todayStart).length,
      points: events.filter((e) => e.createdAt >= todayStart).reduce((s, e) => s + e.points, 0),
      callGoal: settings.dailyCallGoal,
      closeGoal: settings.dailyCloseGoal,
    },
    commission: {
      pending: sum(deals.filter((d) => d.commissionStatus === 'pending')),
      earned: sum(deals.filter((d) => d.commissionStatus === 'earned')),
      paidOut: sum(deals.filter((d) => d.commissionStatus === 'paid_out')),
      lifetime: sum(deals),
    },
    badges: badgesFor(db, userId),
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { POINTS, CALL_TYPES, LEVELS, BADGES, dealPoints, levelFor, leaderboard, repStats, badgesFor, streakFor, periodStart, round2 };
