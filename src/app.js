'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { id } = require('./db');
const auth = require('./auth');
const { INDUSTRIES, getIndustry } = require('./industries');
const { WORKFLOWS, UNIVERSAL_OBJECTIONS, OPENER, BUNDLES } = require('./workflows');
const leadsLib = require('./leads');
const game = require('./game');
const setup = require('./setup');
const demo = require('./demo');
const drip = require('./drip');
const { profitFor } = require('./pricing');
const provision = require('./provision');
const ai = require('./ai');
const payouts = require('./payouts');
const push = require('./push');
const backup = require('./backup');
const { AI_ADDON, TASK_OWNERS } = require('./workflows');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

const DEFAULT_SETTINGS = {
  companyName: 'SalesBoard',
  commissionRate: 0.10,
  dailyCallGoal: 40,
  dailyCloseGoal: 1,
  defaultCity: '',
  contestTitle: 'Weekly Showdown',
  contestPrize: 'Top points this week wins a $100 bonus 🏆',
  webhookUrl: '',
  claimDays: 7,
  // Email drip (anti-spam law needs a real sender + mailing address)
  fromName: '',
  fromEmail: '',
  replyTo: '',
  businessAddress: '',
  emailDailyCap: 0, // 0 = provider's free-tier default
  timezone: 'America/New_York', // used for new client accounts
  aiMinutesIncluded: 600, // AI receptionist minutes included in the monthly price
  ghlSnapshotId: '', // your GoHighLevel template (picked in Manager → 🚀 Launch)
  clientLoginUrl: '', // where clients log in, e.g. https://app.yourdomain.com
  refundPolicy: 'All sales are final. No refunds.', // shown before the client pays
  autoPayouts: true, // pay reps automatically through Stripe when the client pays
  payoutHoldDays: 0, // wait this many days after the client pays (0 = right away)
};

const GENERIC_SIGNALS = { no_website: '🚫 No website', few_reviews: '📉 Few reviews', low_rating: '⚠️ Low rating', no_rating: '❔ No rating yet', busy: '🔥 Busy & loved', no_phone: '📵 No phone', closed: '⛔ Not operating' };

const AVATARS = ['🦊', '🐺', '🦄', '🐯', '🐼', '🦁', '🐸', '🐙', '🦅', '🐲', '🦈', '🐻', '🐵', '🦉', '🐬', '🚀'];
const COLORS = ['#ff7a59', '#4f8cff', '#c065ff', '#ffb020', '#21c38b', '#ff4f8b', '#00b8d9', '#8bc34a'];
const OUTCOMES = ['no_answer', 'not_interested', 'callback', 'interested'];

// Retell signs webhooks as "v=<timestamp>,d=<hex HMAC-SHA256(apiKey, body + timestamp)>".
function verifyRetell(rawBody, header, apiKey, nowMs = Date.now()) {
  const m = /^v=(\d+),d=([0-9a-f]{64})$/i.exec(String(header || ''));
  if (!m) return false;
  const ts = Number(m[1]);
  if (Math.abs(nowMs - ts) > 5 * 60000) return false;
  const expected = crypto.createHmac('sha256', apiKey).update(rawBody + m[1]).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[2].toLowerCase()));
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createApp({ db, env = process.env, fetchImpl = fetch, now = () => Date.now(), sleep, dataDir = path.join(__dirname, '..', 'data') }) {
  const settings = () => ({ ...DEFAULT_SETTINGS, ...db.settings });
  const publicUrl = () => (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, '');
  const googleKey = () => env.GOOGLE_PLACES_API_KEY || '';
  const webhookUrl = () => settings().webhookUrl || env.SETUP_WEBHOOK_URL || '';
  // Google gives 1,000 free Text Search (Enterprise) calls a month. We count
  // every call and stop at the limit so nobody gets a surprise bill.
  const googleLimit = () => (env.GOOGLE_MONTHLY_LIMIT === undefined ? 1000 : Number(env.GOOGLE_MONTHLY_LIMIT) || 0);
  const monthKey = () => new Date(now()).toISOString().slice(0, 7);
  const googleUsed = () => db.data.usage.google?.[monthKey()] || 0;
  const dripOpts = () => ({ settings: settings(), env, catalog: catalog(), publicUrl: publicUrl(), fetchImpl, hydrate: (l) => hydrate(l) });
  const runDrips = () => drip.tick(db, { ...dripOpts(), now: now() });
  const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

  // One-button setup runs in the background; the rep's screen polls progress.
  const inflight = new Map();
  const provisionCtx = (deal) => ({ db, deal, env, settings: settings(), catalog: catalog(), publicUrl: publicUrl(), fetchImpl, webhookUrl: webhookUrl(), save: () => db.save(), sleep });
  function startProvisioning(deal) {
    if (inflight.has(deal.id)) return inflight.get(deal.id);
    const p = provision.run(provisionCtx(deal))
      .then(() => runDrips())
      .catch((err) => console.error('[provision]', err.message))
      .finally(() => inflight.delete(deal.id));
    inflight.set(deal.id, p);
    return p;
  }
  const dealOut = (d) => ({ ...setup.publicDeal(d), onboardingUrl: `${publicUrl()}/onboard/${d.onboardingToken}` });

  // ---- Google data: kept in memory only, never written to disk ----
  // Google's terms let us store place IDs, not business details. So for Google
  // leads we save the place ID + our own notes, and look details up again when
  // needed. Once a rep has actually talked to the business, what they confirmed
  // (name, phone, website) is saved as our own CRM data (lead.confirmed).
  const PLACE_TTL = 12 * 3600000;
  const placeCache = new Map();
  const remember = (l) => { if (l.source === 'google') placeCache.set(l.placeId, { data: l, at: now() }); };
  const live = (lead) => { const c = placeCache.get(lead.placeId); return c && now() - c.at < PLACE_TTL ? c.data : null; };
  const detailsLimit = () => (env.GOOGLE_DETAILS_MONTHLY_LIMIT === undefined ? 1000 : Number(env.GOOGLE_DETAILS_MONTHLY_LIMIT) || 0);
  const detailsUsed = () => db.data.usage.googleDetails?.[monthKey()] || 0;
  function hydrate(lead) {
    if (!lead || lead.source !== 'google') return lead;
    const l = live(lead);
    if (l) return { ...lead, ...l, analysis: leadsLib.analyzeLead(l), id: lead.id, city: lead.city || l.city };
    const c = lead.confirmed || {};
    return { ...lead, name: c.name || 'Google business (details loading)', phone: c.phone || '', website: c.website || '', address: c.address || '', rating: null, reviews: 0, mapsUrl: '', category: getIndustry(lead.industry).label, detailsMissing: !lead.confirmed };
  }
  async function fetchDetails(lead, { withReviews = false } = {}) {
    if (!googleKey() || lead.source !== 'google') return null;
    if (detailsUsed() >= detailsLimit()) return null;
    db.data.usage.googleDetails = db.data.usage.googleDetails || {};
    db.data.usage.googleDetails[monthKey()] = detailsUsed() + 1;
    db.save();
    const r = await leadsLib.getPlaceDetails({ apiKey: googleKey(), placeId: lead.placeId, industryKey: lead.industry, city: lead.city, withReviews, fetchImpl });
    remember(r.lead);
    return r;
  }
  async function ensureDetails(leads, max = 25) {
    const missing = leads.filter((l) => l.source === 'google' && !live(l) && !l.confirmed).slice(0, max);
    for (let i = 0; i < missing.length; i += 5) {
      await Promise.all(missing.slice(i, i + 5).map((l) => fetchDetails(l).catch((err) => console.error('[places]', err.message))));
    }
  }
  // The rep spoke with them, so the business details are now our own records.
  function confirmLead(lead) {
    const h = hydrate(lead);
    if (lead.source === 'google' && h.name && !h.detailsMissing) lead.confirmed = { name: h.name, phone: h.phone, website: h.website, address: h.address, at: now() };
  }

  // ---- Do-not-call list (stored as one-way hashes, not raw numbers) ----
  const phoneKey = (p) => { const d = String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length >= 7 ? crypto.createHash('sha256').update(`dnc:${d}`).digest('hex').slice(0, 32) : null; };
  const isDnc = (l) => db.data.dnc.some((x) => (x.placeId && x.placeId === l.placeId) || (x.phone && x.phone === phoneKey(l.phone)));

  function catalog() {
    return WORKFLOWS.map((w) => {
      const o = db.workflowOverrides[w.id] || {};
      return {
        ...w,
        setupFee: o.setupFee ?? w.setupFee,
        monthlyFee: o.monthlyFee ?? w.monthlyFee,
        cost: { setup: o.costSetup ?? w.cost.setup, monthly: o.costMonthly ?? w.cost.monthly },
        enabled: o.enabled ?? true,
      };
    });
  }

  const safeUser = (u) => u && { id: u.id, name: u.name, avatar: u.avatar, color: u.color, role: u.role, active: u.active !== false };

  function claimExpired(lead) {
    if (lead.status === 'won') return false;
    if (!lead.repId) return true;
    return now() - (lead.lastActivityAt || lead.claimedAt || 0) > settings().claimDays * 86400000;
  }

  function addEvent(user, type, points, extra = {}) {
    const e = { id: id('evt'), userId: user.id, type, points, label: '', createdAt: now(), ...extra };
    db.events.push(e);
    return e;
  }

  async function markPaid(deal) {
    if (deal.status === 'cancelled' || deal.paidAt) return deal;
    deal.status = deal.workflows.every((w) => w.status === 'live') ? 'live' : 'paid';
    deal.paidAt = now();
    if (deal.commissionStatus === 'pending') deal.commissionStatus = 'earned';
    db.save();
    deal.webhook = await setup.sendWebhook({ url: webhookUrl(), secret: env.WEBHOOK_SECRET, event: 'deal.paid', deal, publicUrl: publicUrl(), fetchImpl });
    db.save();
    await attemptPayout(deal).catch((err) => console.error('[payout]', err.message));
    return deal;
  }

  // ---- Rep commission payouts (one time, from the setup fee) ----
  const payCtx = () => ({ env, fetchImpl, publicUrl: publicUrl() });
  async function refreshRepStripe(rep) {
    if (!rep.stripeAccountId || !env.STRIPE_SECRET_KEY) return rep;
    const st = await payouts.accountStatus(payCtx(), rep.stripeAccountId);
    rep.payoutsEnabled = st.payoutsEnabled && st.transfers;
    rep.stripeDetailsSubmitted = st.detailsSubmitted;
    db.save();
    return rep;
  }
  async function attemptPayout(deal, { force = false } = {}) {
    if (deal.commissionStatus !== 'earned' || !env.STRIPE_SECRET_KEY) return null;
    if (!force && settings().autoPayouts === false) return null;
    const holdMs = (Number(settings().payoutHoldDays) || 0) * 86400000;
    if (!force && deal.paidAt && now() - deal.paidAt < holdMs) return null;
    const rep = db.users.find((u) => u.id === deal.repId);
    if (!rep?.stripeAccountId) return null;
    if (!rep.payoutsEnabled) await refreshRepStripe(rep).catch(() => null);
    if (!rep.payoutsEnabled) return null;
    const r = await payouts.payCommission(payCtx(), deal, rep).catch((err) => ({ status: 'failed', detail: err.message }));
    deal.commissionPayout = { ...(deal.commissionPayout || {}), method: 'stripe', status: r.status, instant: Boolean(r.instant), detail: r.detail, at: now() };
    if (r.status === 'sent') {
      deal.commissionStatus = 'paid_out';
      deal.paidOutAt = now();
      notify(rep, { title: '⚡ You got paid!', body: `${money(deal.commission)} commission for ${deal.business.name} is on its way to your card.`, url: '/#/money' });
    }
    db.save();
    return r;
  }

  // ---- Phone notifications ----
  const pushSubject = () => (/^https:\/\//.test(publicUrl()) ? publicUrl() : `mailto:${settings().fromEmail || 'admin@example.com'}`);
  const notify = (user, payload) => push.notifyUser({ db, user, payload, subject: pushSubject(), fetchImpl }).catch((err) => console.error('[push]', err.message));
  async function runReminders() {
    let n = 0;
    for (const lead of db.leads) {
      if (lead.status !== 'callback' || !lead.callbackAt || lead.callbackAt > now()) continue;
      if (lead.callbackNotifiedAt && lead.callbackNotifiedAt >= lead.callbackAt) continue;
      const rep = db.users.find((u) => u.id === lead.repId);
      lead.callbackNotifiedAt = now();
      if (rep?.pushSubs?.length) { await notify(rep, { title: '⏰ Callback time!', body: `Call back ${hydrate(lead).name} now.`, url: `/#/call/${lead.id}` }); n++; }
    }
    if (n) db.save();
    return n;
  }
  async function sweepPayouts() {
    let n = 0;
    for (const d of db.deals.filter((x) => x.commissionStatus === 'earned' && x.status !== 'cancelled')) {
      const r = await attemptPayout(d);
      if (r?.status === 'sent') n++;
    }
    return n;
  }

  function refreshDealStatus(deal) {
    if (deal.status === 'cancelled') return;
    if (deal.workflows.every((w) => w.status === 'live') && deal.paidAt) deal.status = 'live';
    else if (deal.paidAt) deal.status = 'paid';
  }

  // ---------------- Routes ----------------
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, handler, opts });
  };

  // ---- public ----
  route('GET', '/api/bootstrap', () => ({
    needsSetup: db.users.length === 0,
    companyName: settings().companyName,
    team: db.users.filter((u) => u.active !== false).map(safeUser),
    demoMode: !googleKey(),
  }), { public: true });

  route('POST', '/api/setup-first', ({ body }) => {
    if (db.users.length) throw new HttpError(400, 'Setup already done. Log in instead.');
    const name = String(body.name || '').trim();
    if (!name) throw new HttpError(400, 'Enter your name.');
    if (!auth.validPin(body.pin)) throw new HttpError(400, 'PIN must be 4–8 digits.');
    const user = { id: id('usr'), name, avatar: body.avatar || '👑', color: COLORS[0], role: 'manager', pinHash: auth.hashPin(body.pin), active: true, createdAt: now() };
    db.users.push(user);
    if (body.companyName) db.settings.companyName = String(body.companyName).slice(0, 60);
    db.save();
    return { token: auth.createSession(db, user.id), user: safeUser(user) };
  }, { public: true });

  route('POST', '/api/login', ({ body }) => {
    const user = db.users.find((u) => u.id === body.userId && u.active !== false);
    if (!user) throw new HttpError(404, 'Pick your name first.');
    const locked = auth.checkLock(user.id, now());
    if (locked) throw new HttpError(429, `Too many wrong PINs. Try again in ${locked} min.`);
    if (!auth.verifyPin(body.pin, user.pinHash)) { auth.recordFail(user.id, now()); throw new HttpError(401, 'Wrong PIN. Try again.'); }
    auth.clearFails(user.id);
    return { token: auth.createSession(db, user.id), user: safeUser(user) };
  }, { public: true });

  route('POST', '/api/logout', ({ token }) => { auth.destroySession(db, token); return { ok: true }; }, { public: true });

  // Client-facing onboarding (no login, token in URL).
  const dealByToken = (token) => {
    const deal = db.deals.find((d) => d.onboardingToken === token && d.status !== 'cancelled');
    if (!deal) throw new HttpError(404, 'This setup link is not valid. Please contact your rep.');
    return deal;
  };

  route('GET', '/api/onboard/:token', ({ params }) => {
    const deal = dealByToken(params.token);
    const cat = catalog();
    const prefill = { phone: deal.business.phone, email: deal.contact.email, website: deal.business.website, reviewLink: deal.business.reviewLink };
    const fields = [];
    const seen = new Set();
    for (const dw of deal.workflows) {
      const w = cat.find((x) => x.id === dw.id);
      for (const f of w?.onboarding || []) {
        if (seen.has(f.key)) continue;
        seen.add(f.key);
        fields.push({ ...f, workflow: w.name, value: deal.onboarding?.answers?.[f.key] ?? prefill[f.prefill] ?? (f.default || '').replace('{{business}}', deal.business.name) });
      }
    }
    return {
      companyName: settings().companyName,
      business: deal.business.name,
      repName: deal.repName,
      contact: deal.contact,
      workflows: deal.workflows.map((w) => ({ name: w.name, emoji: w.emoji })),
      setupTotal: deal.setupTotal,
      monthlyTotal: deal.monthlyTotal,
      paymentUrl: deal.paidAt ? '' : deal.paymentUrl,
      paid: Boolean(deal.paidAt),
      submitted: Boolean(deal.onboarding),
      loginUrl: deal.ghl?.userId && settings().clientLoginUrl ? settings().clientLoginUrl : '',
      refundPolicy: settings().refundPolicy,
      billing: deal.billing || 'monthly',
      yearlyTotal: deal.yearlyTotal || 0,
      fields,
    };
  }, { public: true });

  route('POST', '/api/onboard/:token', async ({ params, body }) => {
    const deal = dealByToken(params.token);
    const answers = {};
    for (const [k, v] of Object.entries(body.answers || {})) answers[String(k).slice(0, 60)] = String(v ?? '').slice(0, 5000);
    if (body.contact) {
      deal.contact.name = String(body.contact.name || deal.contact.name).slice(0, 120);
      deal.contact.email = String(body.contact.email || deal.contact.email).slice(0, 200);
      deal.contact.phone = String(body.contact.phone || deal.contact.phone).slice(0, 40);
    }
    deal.onboarding = { submittedAt: now(), answers };
    if (drip.validEmail(deal.contact.email)) {
      const lead = db.leads.find((l) => l.id === deal.leadId);
      // Setup is done, so the customer drip just completes on its next check.
      drip.enroll(db, { email: deal.contact.email, name: deal.contact.name, lead, deal, sequence: 'customer', by: deal.repId, now: now() });
    }
    db.save();
    deal.webhook = await setup.sendWebhook({ url: webhookUrl(), secret: env.WEBHOOK_SECRET, event: 'onboarding.completed', deal, publicUrl: publicUrl(), fetchImpl });
    // Push their answers into their GoHighLevel account + AI receptionist.
    if (deal.provisioning) await provision.syncOnboarding(provisionCtx(deal)).catch((err) => console.error('[onboarding sync]', err.message));
    db.save();
    return { ok: true };
  }, { public: true });

  // Stripe tells us when the client paid.
  route('POST', '/api/hooks/stripe', async ({ raw, headers }) => {
    if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(400, 'Stripe webhook secret not configured');
    if (!setup.verifyStripeSignature(raw, headers['stripe-signature'], env.STRIPE_WEBHOOK_SECRET, 300, now())) throw new HttpError(400, 'Bad signature');
    const evt = JSON.parse(raw);
    if (evt.type === 'checkout.session.completed') {
      const dealId = evt.data?.object?.metadata?.deal_id || evt.data?.object?.client_reference_id;
      const deal = db.deals.find((d) => d.id === dealId);
      if (deal) await markPaid(deal);
    }
    return { received: true };
  }, { public: true });

  // Retell reports every finished AI receptionist call, so we can track the
  // minutes each client uses against what their plan includes.
  route('POST', '/api/hooks/retell', ({ raw, headers }) => {
    if (!env.RETELL_API_KEY) throw new HttpError(400, 'Retell not configured');
    if (!verifyRetell(raw, headers['x-retell-signature'], env.RETELL_API_KEY, now())) throw new HttpError(401, 'Bad signature');
    const evt = JSON.parse(raw);
    if (evt.event !== 'call_ended') return { ok: true };
    const deal = db.deals.find((d) => d.retell?.agentId && d.retell.agentId === evt.call?.agent_id);
    if (!deal) return { ok: true };
    const month = monthKey();
    const u = deal.aiUsage && deal.aiUsage.month === month ? deal.aiUsage : { month, seconds: 0, calls: 0, alerted: false };
    u.seconds += Math.round((Number(evt.call.duration_ms) || 0) / 1000);
    u.calls += 1;
    const included = Number(settings().aiMinutesIncluded) || 600;
    if (!u.alerted && u.seconds / 60 >= included * 0.8) {
      u.alerted = true;
      u.alertedAt = now();
    }
    deal.aiUsage = u;
    db.save();
    return { ok: true };
  }, { public: true });

  // Your automation platform reports back when a workflow is live.
  route('POST', '/api/hooks/provisioning', ({ body, headers }) => {
    if (!env.WEBHOOK_SECRET || headers['x-salesboard-secret'] !== env.WEBHOOK_SECRET) throw new HttpError(401, 'Bad secret');
    const deal = db.deals.find((d) => d.id === body.dealId);
    if (!deal) throw new HttpError(404, 'Deal not found');
    const wfs = body.workflowId ? deal.workflows.filter((w) => w.id === body.workflowId) : deal.workflows;
    for (const w of wfs) {
      if (body.status === 'live') { w.status = 'live'; w.tasks.forEach((t) => { t.done = true; }); } else if (body.status) w.status = String(body.status).slice(0, 20);
    }
    if (body.paid) deal.paidAt = deal.paidAt || now();
    if (deal.paidAt && deal.commissionStatus === 'pending') deal.commissionStatus = 'earned';
    refreshDealStatus(deal);
    db.save();
    return { ok: true, status: deal.status };
  }, { public: true });

  // ---- logged in ----
  route('GET', '/api/me', ({ user }) => ({ user: safeUser(user), stats: game.repStats(db, user.id, settings(), now()), settings: publicSettings() }));

  // ---- Notifications ----
  route('GET', '/api/push/key', () => ({ publicKey: push.vapidKeys(db).publicKey }));
  route('POST', '/api/push/subscribe', ({ body, user }) => {
    const sub = body.subscription || {};
    if (!/^https:\/\//.test(sub.endpoint || '') || !sub.keys?.p256dh || !sub.keys?.auth) throw new HttpError(400, 'That notification subscription looks wrong.');
    user.pushSubs = (user.pushSubs || []).filter((x) => x.endpoint !== sub.endpoint);
    user.pushSubs.push({ endpoint: String(sub.endpoint).slice(0, 1000), keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, at: now() });
    user.pushSubs = user.pushSubs.slice(-5);
    db.save();
    return { ok: true, devices: user.pushSubs.length };
  });
  route('POST', '/api/push/test', async ({ user }) => {
    const sent = await notify(user, { title: '🔔 Notifications are on!', body: 'You\'ll get a buzz for callbacks and payouts.', url: '/#/home' });
    if (!sent) throw new HttpError(400, 'No device is set up for notifications yet.');
    return { sent };
  });

  // ---- How I get paid ----
  const payoutInfo = (u) => ({
    cashtag: u.cashtag || '',
    stripeAvailable: Boolean(env.STRIPE_SECRET_KEY),
    stripe: { started: Boolean(u.stripeAccountId), ready: Boolean(u.payoutsEnabled), detailsSubmitted: Boolean(u.stripeDetailsSubmitted) },
    autoPayouts: settings().autoPayouts !== false,
    holdDays: Number(settings().payoutHoldDays) || 0,
  });
  route('GET', '/api/me/payout', async ({ user }) => {
    if (user.stripeAccountId && !user.payoutsEnabled) await refreshRepStripe(user).catch(() => null);
    return payoutInfo(user);
  });
  route('PATCH', '/api/me/payout', ({ body, user }) => {
    const tag = payouts.normalizeCashtag(body.cashtag);
    if (tag === null) throw new HttpError(400, 'A $cashtag is letters, numbers, - or _ (like $MariaSells).');
    user.cashtag = tag;
    db.save();
    return payoutInfo(user);
  });
  route('POST', '/api/me/payout/stripe', async ({ user }) => {
    if (!env.STRIPE_SECRET_KEY) throw new HttpError(400, 'Instant pay isn\'t turned on yet. Ask your manager to connect Stripe.');
    try {
      if (!user.stripeAccountId) { user.stripeAccountId = await payouts.createRepAccount(payCtx(), user); db.save(); }
      return { url: await payouts.onboardingLink(payCtx(), user.stripeAccountId) };
    } catch (err) {
      throw new HttpError(502, /connect/i.test(err.message) ? 'Your manager needs to turn on Stripe Connect first (guide Part 7b).' : `Stripe said: ${err.message}`);
    }
  });
  route('POST', '/api/me/payout/dashboard', async ({ user }) => {
    if (!user.stripeAccountId || !env.STRIPE_SECRET_KEY) throw new HttpError(400, 'Set up instant pay first.');
    return { url: await payouts.dashboardLink(payCtx(), user.stripeAccountId) };
  });

  const publicSettings = () => {
    const s = settings();
    return { companyName: s.companyName, commissionRate: s.commissionRate, dailyCallGoal: s.dailyCallGoal, dailyCloseGoal: s.dailyCloseGoal, defaultCity: s.defaultCity, contestTitle: s.contestTitle, contestPrize: s.contestPrize, claimDays: s.claimDays };
  };

  route('GET', '/api/catalog', () => ({
    // Reps see market prices (to show the savings) but not our internal costs.
    workflows: catalog().filter((w) => w.enabled).map(({ cost, ...w }) => w),
    bundles: BUNDLES,
    aiAddon: { monthly: AI_ADDON.monthly },
    taskOwners: TASK_OWNERS,
    connected: provision.connected(env, settings()),
    aiOpeners: Boolean(ai.client(env)),
    refundPolicy: settings().refundPolicy,
    objections: UNIVERSAL_OBJECTIONS,
    opener: OPENER,
    industries: INDUSTRIES,
    points: game.POINTS,
    levels: game.LEVELS,
    badges: game.BADGES,
    commissionRate: settings().commissionRate,
    demoMode: !googleKey(),
  }));

  route('GET', '/api/leads/search', async ({ query, user }) => {
    const industry = String(query.industry || '');
    const city = String(query.city || '').trim();
    if (!industry) throw new HttpError(400, 'Pick a business type.');
    if (!city) throw new HttpError(400, 'Type a city, like "Norfolk, VA".');
    let result;
    if (googleKey() && !String(query.pageToken || '').startsWith('demo:')) {
      if (googleUsed() >= googleLimit()) {
        throw new HttpError(429, `This month's ${googleLimit()} free Google searches are used up. Work your current leads, add leads by hand, or ask your manager to raise GOOGLE_MONTHLY_LIMIT.`);
      }
      db.data.usage.google = db.data.usage.google || {};
      db.data.usage.google[monthKey()] = googleUsed() + 1;
      db.save();
      result = await leadsLib.searchGoogle({ apiKey: googleKey(), industryKey: industry, city, pageToken: query.pageToken, fetchImpl });
      result.leads.forEach(remember); // in memory only
    } else {
      const page = Number(String(query.pageToken || 'demo:0').split(':')[1]) || 0;
      result = leadsLib.demoLeads({ industryKey: industry, city, page });
    }
    const leads = result.leads.map((l) => {
      const existing = db.leads.find((x) => x.placeId === l.placeId);
      let claim = null;
      if (existing && !claimExpired(existing)) {
        const owner = db.users.find((u) => u.id === existing.repId);
        claim = { mine: existing.repId === user.id, by: owner?.name || 'someone', leadId: existing.id, status: existing.status };
      }
      return { ...l, analysis: leadsLib.analyzeLead(l), claim, dnc: isDnc(l) };
    }).sort((a, b) => b.analysis.score - a.analysis.score);
    return { leads, nextPageToken: result.nextPageToken, demo: !googleKey() };
  });

  route('POST', '/api/leads/claim', async ({ body, user }) => {
    const raw = body.lead || {};
    const manual = !raw.placeId;
    const name = String(raw.name || '').trim().slice(0, 120);
    if (!name) throw new HttpError(400, 'Business name is required.');
    const placeId = manual ? `manual_${id('m')}` : String(raw.placeId).slice(0, 200);
    if (isDnc({ placeId, phone: raw.phone })) throw new HttpError(409, '🚫 This business asked not to be called again.');
    let lead = db.leads.find((l) => l.placeId === placeId);
    if (lead && !claimExpired(lead) && lead.repId !== user.id) {
      const owner = db.users.find((u) => u.id === lead.repId);
      throw new HttpError(409, `${owner?.name || 'Another rep'} already claimed this lead.`);
    }
    if (lead && lead.repId === user.id && !claimExpired(lead)) return { lead: hydrate(lead) };
    const isGoogle = !manual && raw.source === 'google';
    if (isGoogle && !placeCache.has(placeId)) await fetchDetails({ placeId, source: 'google', industry: getIndustry(raw.industry).key, city: String(raw.city || '') }).catch(() => null);
    const clean = {
      placeId,
      name,
      address: String(raw.address || '').slice(0, 300),
      phone: String(raw.phone || '').slice(0, 40),
      website: String(raw.website || '').slice(0, 300),
      rating: raw.rating == null || raw.rating === '' ? null : Math.max(0, Math.min(5, Number(raw.rating) || 0)),
      reviews: Math.max(0, Number.parseInt(raw.reviews, 10) || 0),
      mapsUrl: String(raw.mapsUrl || '').slice(0, 500),
      businessStatus: raw.businessStatus || 'OPERATIONAL',
      category: String(raw.category || getIndustry(raw.industry).label).slice(0, 80),
      industry: getIndustry(raw.industry).key,
      city: String(raw.city || '').slice(0, 120),
      source: manual ? 'manual' : raw.source === 'google' ? 'google' : 'demo',
    };
    if (lead) {
      Object.assign(lead, { repId: user.id, status: 'new', claimedAt: now(), lastActivityAt: now() });
    } else if (isGoogle) {
      // Save only the place ID + our own scoring. Details live in memory.
      const fresh = placeCache.get(placeId)?.data || clean;
      lead = { id: id('lead'), placeId, source: 'google', industry: clean.industry, city: clean.city, analysis: leadsLib.storableAnalysis(leadsLib.analyzeLead(fresh)), repId: user.id, status: 'new', claimedAt: now(), lastActivityAt: now(), callbackAt: null, history: [] };
      db.leads.push(lead);
    } else {
      lead = { id: id('lead'), ...clean, analysis: leadsLib.analyzeLead(clean), repId: user.id, status: 'new', claimedAt: now(), lastActivityAt: now(), callbackAt: null, history: [] };
      db.leads.push(lead);
    }
    lead.history.push({ at: now(), by: user.name, text: 'Claimed lead' });
    db.save();
    return { lead: hydrate(lead) };
  });

  const myLead = (user, leadId) => {
    const lead = db.leads.find((l) => l.id === leadId);
    if (!lead) throw new HttpError(404, 'Lead not found.');
    if (lead.repId !== user.id && user.role !== 'manager') throw new HttpError(403, 'That lead belongs to another rep.');
    return lead;
  };

  route('GET', '/api/leads/mine', async ({ user }) => {
    const mine = db.leads.filter((l) => l.repId === user.id && (l.status === 'won' || !claimExpired(l))).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
    await ensureDetails(mine.filter((l) => l.status !== 'won' && l.status !== 'lost'));
    return { leads: mine.map(hydrate) };
  });

  route('GET', '/api/leads/:id', async ({ params, user }) => {
    const raw = myLead(user, params.id);
    await ensureDetails([raw]);
    const lead = hydrate(raw);
    return { lead, deals: db.deals.filter((d) => d.leadId === lead.id).map(setup.publicDeal), drip: drip.summaryFor(db, lead.id) };
  });

  route('POST', '/api/leads/:id/outcome', ({ params, body, user }) => {
    const lead = myLead(user, params.id);
    const outcome = String(body.outcome || '');
    if (!OUTCOMES.includes(outcome)) throw new HttpError(400, 'Unknown outcome.');
    if (lead.status === 'won') throw new HttpError(400, 'This lead is already a customer. 🎉');
    // Call points count once per lead per day so nobody can spam the button.
    const today = game.periodStart('today', now());
    const already = db.events.some((e) => e.leadId === lead.id && e.userId === user.id && game.CALL_TYPES.includes(e.type) && e.createdAt >= today && !e.voided);
    const points = already ? 0 : game.POINTS[outcome];
    const labels = { no_answer: 'No answer', not_interested: 'Not interested', callback: 'Call back later', interested: 'Interested!' };
    addEvent(user, outcome, points, { leadId: lead.id, label: outcome === 'interested' ? `got a ${getIndustry(lead.industry).trade} lead interested` : '' });
    if (outcome === 'interested' || outcome === 'callback') confirmLead(lead);
    if (outcome === 'not_interested' && body.dnc) {
      const h = hydrate(lead);
      db.data.dnc.push({ placeId: lead.placeId, phone: phoneKey(h.phone), at: now(), by: user.name });
      lead.history.push({ at: now(), by: user.name, text: '🚫 Added to the do-not-call list' });
    }
    lead.status = { no_answer: 'called', not_interested: 'lost', callback: 'callback', interested: 'interested' }[outcome];
    lead.callbackAt = outcome === 'callback' && body.callbackAt ? Number(new Date(body.callbackAt)) || null : null;
    lead.lastActivityAt = now();
    lead.history.push({ at: now(), by: user.name, text: labels[outcome] + (body.note ? `: ${String(body.note).slice(0, 500)}` : '') });
    db.save();
    return { lead: hydrate(lead), pointsEarned: points, stats: game.repStats(db, user.id, settings(), now()) };
  });

  route('POST', '/api/leads/:id/note', ({ params, body, user }) => {
    const lead = myLead(user, params.id);
    const text = String(body.note || '').trim().slice(0, 1000);
    if (!text) throw new HttpError(400, 'Note is empty.');
    lead.history.push({ at: now(), by: user.name, text: `📝 ${text}` });
    lead.lastActivityAt = now();
    db.save();
    return { lead: hydrate(lead) };
  });

  // They gave us their email → save it and start the drip.
  route('POST', '/api/leads/:id/email', ({ params, body, user }) => {
    const lead = myLead(user, params.id);
    const email = String(body.email || '').trim().slice(0, 200);
    if (!drip.validEmail(email)) throw new HttpError(400, 'That email doesn\'t look right. Double-check it with them.');
    const firstTime = !lead.email;
    lead.email = email;
    confirmLead(lead); // they talked to us and shared an email
    if (body.name) lead.contactName = String(body.name).trim().slice(0, 80);
    if (Array.isArray(body.pitched) && body.pitched[0]) lead.pitchedWorkflow = String(body.pitched[0]).slice(0, 60);
    lead.lastActivityAt = now();
    const won = lead.status === 'won';
    const deal = won ? db.deals.find((d) => d.leadId === lead.id && d.status !== 'cancelled') : null;
    const r = drip.enroll(db, { email, name: lead.contactName, lead, deal, sequence: won && deal ? 'customer' : 'prospect', by: user.id, now: now() });
    if (r.error) throw new HttpError(400, r.error);
    let pointsEarned = 0;
    if (firstTime && !db.events.some((e) => e.leadId === lead.id && e.type === 'email' && !e.voided)) {
      pointsEarned = game.POINTS.email;
      addEvent(user, 'email', pointsEarned, { leadId: lead.id });
    }
    lead.history.push({ at: now(), by: user.name, text: r.suppressed ? `📧 Saved ${email} (they unsubscribed before, so no emails)` : `📧 Added ${email} to the email drip` });
    db.save();
    return { lead: hydrate(lead), drip: drip.summaryFor(db, lead.id), suppressed: Boolean(r.suppressed), pointsEarned, stats: game.repStats(db, user.id, settings(), now()) };
  });

  // ✨ AI-written opener based on the business's Google reviews.
  route('POST', '/api/leads/:id/opener', async ({ params, body, user }) => {
    const raw = myLead(user, params.id);
    const c = ai.client(env, fetchImpl);
    if (!c) throw new HttpError(400, 'AI openers are off. Your manager can add ANTHROPIC_API_KEY to turn them on.');
    const limit = env.AI_OPENER_MONTHLY_LIMIT === undefined ? 1000 : Number(env.AI_OPENER_MONTHLY_LIMIT) || 0;
    const used = db.data.usage.aiOpeners?.[monthKey()] || 0;
    if (used >= limit) throw new HttpError(429, `This month's ${limit} AI openers are used up.`);
    const workflow = catalog().find((w) => w.id === body.workflowId) || catalog().find((w) => w.id === raw.analysis?.recommended?.[0]) || catalog()[0];
    let reviews = [];
    if (raw.source === 'google') {
      const r = await fetchDetails(raw, { withReviews: true }).catch(() => null);
      reviews = r?.reviews || []; // used once for the prompt, never saved
    }
    const lead = hydrate(raw);
    db.data.usage.aiOpeners = db.data.usage.aiOpeners || {};
    db.data.usage.aiOpeners[monthKey()] = used + 1;
    const text = await ai.writeOpener(c, { business: lead.name, trade: getIndustry(lead.industry).trade, city: (lead.city || '').split(',')[0], rating: lead.rating, reviewCount: lead.reviews, website: lead.website, reviews, workflow, rep: user.name });
    raw.opener = { text, workflowId: workflow.id, at: now() };
    db.save();
    return { opener: raw.opener };
  });

  route('POST', '/api/leads/:id/drip/stop', ({ params, user }) => {
    const lead = myLead(user, params.id);
    const n = drip.stopFor(db, (d) => d.leadId === lead.id, `Stopped by ${user.name}`);
    lead.history.push({ at: now(), by: user.name, text: '🛑 Stopped the email drip' });
    db.save();
    return { stopped: n, drip: drip.summaryFor(db, lead.id) };
  });

  route('POST', '/api/leads/:id/release', ({ params, user }) => {
    const lead = myLead(user, params.id);
    if (lead.status === 'won') throw new HttpError(400, 'Won leads stay with the rep who closed them.');
    lead.repId = null;
    lead.history.push({ at: now(), by: user.name, text: 'Released lead back to the pool' });
    db.save();
    return { ok: true };
  });

  // ⭐ THE ONE BUTTON ⭐
  route('POST', '/api/deals', async ({ body, user }) => {
    const rawLead = myLead(user, body.leadId);
    await ensureDetails([rawLead]);
    confirmLead(rawLead); // they said yes, so these details are now our customer records
    const lead = hydrate(rawLead);
    if (lead.status === 'won' && db.deals.some((d) => d.leadId === lead.id && d.status !== 'cancelled')) {
      throw new HttpError(400, 'This lead already has an active deal.');
    }
    const cat = catalog();
    const ids = [...new Set(Array.isArray(body.workflowIds) ? body.workflowIds : [])];
    const workflows = ids.map((wid) => cat.find((w) => w.id === wid && w.enabled)).filter(Boolean);
    if (!workflows.length) throw new HttpError(400, 'Pick at least one workflow they said yes to.');
    const email = String(body.contact?.email || '').trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'That email doesn\'t look right.');
    const rep = db.users.find((u) => u.id === lead.repId) || user;
    const o = body.options || {};
    const options = {
      aiAddons: Array.isArray(o.aiAddons) ? o.aiAddons.map(String) : [],
      areaCode: String(o.areaCode || '').replace(/\D/g, '').slice(0, 3),
      createLogin: o.createLogin !== false,
      paymentLink: o.paymentLink !== false,
      billing: o.billing === 'yearly' ? 'yearly' : 'monthly',
    };
    const deal = setup.buildDeal({ lead, rep, workflows, contact: body.contact, notes: body.notes, commissionRate: settings().commissionRate, options, now: now() });
    db.deals.push(deal);
    rawLead.status = 'won';
    rawLead.lastActivityAt = now();
    rawLead.history.push({ at: now(), by: user.name, text: `🎉 CLOSED: ${workflows.map((w) => w.name).join(', ')} ($${deal.setupTotal} setup)` });
    addEvent(rep, 'deal', deal.points, { dealId: deal.id, leadId: lead.id, label: `closed ${workflows.map((w) => w.name).join(' + ')} for ${lead.name}` });
    if (deal.contact.email && drip.validEmail(deal.contact.email)) {
      rawLead.email = deal.contact.email;
      if (deal.contact.name) rawLead.contactName = deal.contact.name;
      drip.enroll(db, { email: deal.contact.email, name: deal.contact.name, lead: rawLead, deal, sequence: 'customer', by: rep.id, now: now() });
    }
    db.save();
    startProvisioning(deal); // builds everything for the client; the screen shows live progress
    return { deal: dealOut(deal), onboardingUrl: `${publicUrl()}/onboard/${deal.onboardingToken}`, stats: game.repStats(db, rep.id, settings(), now()) };
  });

  route('GET', '/api/deals/mine', ({ user }) => ({
    deals: db.deals.filter((d) => d.repId === user.id).sort((a, b) => b.createdAt - a.createdAt).map((d) => ({ ...setup.publicDeal(d), onboardingUrl: `${publicUrl()}/onboard/${d.onboardingToken}` })),
  }));

  // Live progress of the one-button setup.
  route('GET', '/api/deals/:id', ({ params, user }) => {
    const d = db.deals.find((x) => x.id === params.id);
    if (!d || (d.repId !== user.id && user.role !== 'manager')) throw new HttpError(404, 'Deal not found.');
    return { deal: dealOut(d), running: inflight.has(d.id) };
  });

  route('GET', '/api/leaderboard', ({ query }) => {
    const period = ['today', 'week', 'month', 'all'].includes(query.period) ? query.period : 'week';
    return { period, rows: game.leaderboard(db, period, now()), contest: { title: settings().contestTitle, prize: settings().contestPrize } };
  });

  route('GET', '/api/feed', ({ query }) => {
    const since = Number(query.since) || 0;
    const items = db.events
      .filter((e) => !e.voided && e.createdAt > since && (e.type === 'deal' || e.type === 'interested'))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 25)
      .map((e) => {
        const u = db.users.find((x) => x.id === e.userId);
        return { id: e.id, type: e.type, userId: e.userId, name: u?.name || '?', avatar: u?.avatar || '🙂', label: e.label, points: e.points, at: e.createdAt };
      });
    return { items, serverTime: now() };
  });

  // ---- manager ----
  const integrations = () => ({
    google: Boolean(googleKey()),
    stripe: Boolean(env.STRIPE_SECRET_KEY),
    stripeWebhook: Boolean(env.STRIPE_WEBHOOK_SECRET),
    webhook: Boolean(webhookUrl()),
    webhookSecret: Boolean(env.WEBHOOK_SECRET),
    publicUrl: publicUrl(),
    googleUsed: googleUsed(),
    googleLimit: googleLimit(),
    email: drip.readiness(db, settings(), env),
    ...Object.fromEntries(Object.entries(provision.connected(env, settings())).map(([k, v]) => [`p_${k}`, v])),
    reps: db.users.filter((u) => u.role === 'rep' && u.active !== false && !u.demo).length,
    backup: { last: db.data.system.backup || null, bucket: env.BACKUP_BUCKET || '' },
    storage: db.kind,
    realDeals: db.deals.filter((d) => !d.demo).length,
    httpsUrl: /^https:\/\//.test(publicUrl()) && !/localhost|127\.0\.0\.1/.test(publicUrl()),
  });

  route('GET', '/api/admin/overview', () => {
    const deals = db.deals.slice().sort((a, b) => b.createdAt - a.createdAt).map((d) => ({ ...setup.publicDeal(d), onboardingUrl: `${publicUrl()}/onboard/${d.onboardingToken}` }));
    const live = deals.filter((d) => d.status !== 'cancelled');
    const owed = {};
    for (const d of live.filter((x) => x.commissionStatus === 'earned')) owed[d.repId] = game.round2((owed[d.repId] || 0) + d.commission);
    return {
      users: db.users.map((u) => ({ ...safeUser(u), demo: Boolean(u.demo), cashtag: u.cashtag || '', instantReady: Boolean(u.payoutsEnabled) })),
      deals,
      settings: settings(),
      integrations: integrations(),
      workflows: catalog().map((w) => ({ id: w.id, name: w.name, emoji: w.emoji, setupFee: w.setupFee, monthlyFee: w.monthlyFee, market: w.market, cost: w.cost, enabled: w.enabled, profit: profitFor(w, settings().commissionRate) })),
      totals: {
        setupSold: live.reduce((s, d) => s + d.setupTotal, 0),
        mrr: live.reduce((s, d) => s + d.monthlyTotal, 0),
        commissionOwed: game.round2(Object.values(owed).reduce((s, v) => s + v, 0)),
        commissionPending: game.round2(live.filter((d) => d.commissionStatus === 'pending').reduce((s, d) => s + d.commission, 0)),
        deals: live.length,
      },
      owed,
      alerts: db.deals.filter((d) => d.status !== 'cancelled' && d.aiUsage?.month === monthKey() && d.aiUsage.alerted).map((d) => ({ dealId: d.id, business: d.business.name, minutes: Math.round(d.aiUsage.seconds / 60), included: Number(settings().aiMinutesIncluded) || 600 })),
    };
  }, { admin: true });

  route('POST', '/api/admin/users', ({ body }) => {
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) throw new HttpError(400, 'Name is required.');
    if (!auth.validPin(body.pin)) throw new HttpError(400, 'PIN must be 4–8 digits.');
    if (db.users.some((u) => u.name.toLowerCase() === name.toLowerCase() && u.active !== false)) throw new HttpError(400, 'Someone already has that name. Add a last initial.');
    const n = db.users.length;
    const user = { id: id('usr'), name, avatar: AVATARS.includes(body.avatar) ? body.avatar : AVATARS[n % AVATARS.length], color: COLORS[n % COLORS.length], role: body.role === 'manager' ? 'manager' : 'rep', pinHash: auth.hashPin(body.pin), active: true, createdAt: now() };
    db.users.push(user);
    db.save();
    return { user: safeUser(user) };
  }, { admin: true });

  route('PATCH', '/api/admin/users/:id', ({ params, body, user: me }) => {
    const u = db.users.find((x) => x.id === params.id);
    if (!u) throw new HttpError(404, 'User not found.');
    if (body.name) u.name = String(body.name).trim().slice(0, 40);
    if (body.avatar && AVATARS.includes(body.avatar)) u.avatar = body.avatar;
    if (body.pin) { if (!auth.validPin(body.pin)) throw new HttpError(400, 'PIN must be 4–8 digits.'); u.pinHash = auth.hashPin(body.pin); }
    if (body.role && u.id !== me.id) u.role = body.role === 'manager' ? 'manager' : 'rep';
    if (typeof body.active === 'boolean') {
      if (u.id === me.id && !body.active) throw new HttpError(400, 'You can\'t deactivate yourself.');
      u.active = body.active;
      if (!body.active) db.data.sessions = db.sessions.filter((s) => s.userId !== u.id);
    }
    db.save();
    return { user: safeUser(u) };
  }, { admin: true });

  const dealById = (dealId) => {
    const d = db.deals.find((x) => x.id === dealId);
    if (!d) throw new HttpError(404, 'Deal not found.');
    return d;
  };

  route('POST', '/api/admin/deals/:id/paid', async ({ params }) => ({ deal: setup.publicDeal(await markPaid(dealById(params.id))) }), { admin: true });

  route('POST', '/api/admin/deals/:id/payout', ({ params }) => {
    const d = dealById(params.id);
    if (d.commissionStatus !== 'earned') throw new HttpError(400, 'Commission can be paid out once the client has paid.');
    d.commissionStatus = 'paid_out';
    d.paidOutAt = now();
    db.save();
    return { deal: setup.publicDeal(d) };
  }, { admin: true });

  route('POST', '/api/admin/reps/:id/payout', ({ params, body, user: me }) => {
    const method = ['cashapp', 'manual'].includes(body.method) ? body.method : 'manual';
    const deals = db.deals.filter((d) => d.repId === params.id && d.status !== 'cancelled' && d.commissionStatus === 'earned');
    deals.forEach((d) => { d.commissionStatus = 'paid_out'; d.paidOutAt = now(); d.commissionPayout = { method, status: 'sent', detail: method === 'cashapp' ? 'Paid with Cash App' : 'Paid by manager', by: me.name, at: now() }; });
    db.save();
    return { count: deals.length, amount: game.round2(deals.reduce((s, d) => s + d.commission, 0)) };
  }, { admin: true });

  route('POST', '/api/admin/deals/:id/pay-now', async ({ params }) => {
    const d = dealById(params.id);
    if (d.commissionStatus !== 'earned') throw new HttpError(400, 'Commission can be paid once the client has paid.');
    const r = await attemptPayout(d, { force: true });
    if (!r) throw new HttpError(400, 'This rep hasn\'t finished instant-pay setup. Use Cash App or mark it paid instead.');
    return { result: r, deal: dealOut(d) };
  }, { admin: true });

  route('POST', '/api/admin/deals/:id/cancel', ({ params }) => {
    const d = dealById(params.id);
    if (d.commissionStatus === 'paid_out') throw new HttpError(400, 'Commission was already paid out on this deal. Sort it out with the rep before cancelling.');
    d.status = 'cancelled';
    d.commissionStatus = 'cancelled';
    drip.stopFor(db, (x) => x.dealId === d.id, 'Deal cancelled');
    db.events.forEach((e) => { if (e.dealId === d.id) { e.voided = true; db.markDirty('events', e); } });
    const lead = db.leads.find((l) => l.id === d.leadId);
    if (lead) { lead.status = 'interested'; lead.history.push({ at: now(), by: 'Manager', text: 'Deal cancelled' }); }
    db.save();
    return { deal: setup.publicDeal(d) };
  }, { admin: true });

  route('POST', '/api/admin/deals/:id/workflow/:wid', ({ params, body }) => {
    const d = dealById(params.id);
    const w = d.workflows.find((x) => x.id === params.wid);
    if (!w) throw new HttpError(404, 'Workflow not on this deal.');
    if (Number.isInteger(body.taskIndex) && w.tasks[body.taskIndex]) w.tasks[body.taskIndex].done = Boolean(body.done);
    if (body.status === 'live') { w.status = 'live'; w.tasks.forEach((t) => { t.done = true; }); } else if (body.status === 'queued') w.status = 'queued';
    else if (w.tasks.every((t) => t.done)) w.status = 'live';
    else if (w.status === 'live') w.status = 'queued';
    refreshDealStatus(d);
    db.save();
    return { deal: setup.publicDeal(d) };
  }, { admin: true });

  // Re-runs any setup step that failed or was in practice mode (skips finished ones).
  route('POST', '/api/admin/deals/:id/retry', async ({ params }) => {
    const d = dealById(params.id);
    if (d.status === 'cancelled') throw new HttpError(400, 'This deal was cancelled.');
    d.provisioning = d.provisioning || { steps: [] };
    await startProvisioning(d);
    return { deal: dealOut(d) };
  }, { admin: true });

  route('PATCH', '/api/admin/settings', ({ body }) => {
    const s = db.settings;
    if (body.companyName != null) s.companyName = String(body.companyName).slice(0, 60);
    if (body.commissionRate != null) {
      const r = Number(body.commissionRate);
      if (!(r >= 0 && r <= 1)) throw new HttpError(400, 'Commission rate must be between 0% and 100%.');
      // Profit check: the new rate must still leave every workflow profitable on setup.
      const losers = catalog().filter((w) => w.enabled && !profitFor(w, r).ok);
      if (losers.length) throw new HttpError(400, `At ${Math.round(r * 1000) / 10}% commission these workflows would lose money on setup: ${losers.map((w) => w.name).join(', ')}.`);
      s.commissionRate = r;
    }
    for (const k of ['dailyCallGoal', 'dailyCloseGoal', 'claimDays', 'aiMinutesIncluded']) if (body[k] != null) s[k] = Math.max(0, Number.parseInt(body[k], 10) || 0);
    for (const k of ['defaultCity', 'contestTitle', 'contestPrize', 'fromName', 'businessAddress']) if (body[k] != null) s[k] = String(body[k]).trim().slice(0, 200);
    for (const k of ['fromEmail', 'replyTo']) {
      if (body[k] == null) continue;
      const v = String(body[k]).trim();
      if (v && !drip.validEmail(v)) throw new HttpError(400, `${k === 'fromEmail' ? 'Sender' : 'Reply-to'} email doesn't look right.`);
      s[k] = v;
    }
    if (body.clientLoginUrl != null) {
      const u = String(body.clientLoginUrl).trim();
      if (u && !/^https?:\/\//.test(u)) throw new HttpError(400, 'Client login link must start with https://');
      s.clientLoginUrl = u;
    }
    if (body.refundPolicy != null) s.refundPolicy = String(body.refundPolicy).trim().slice(0, 500);
    if (body.autoPayouts != null) s.autoPayouts = body.autoPayouts === true || body.autoPayouts === 'on' || body.autoPayouts === 'true';
    if (body.payoutHoldDays != null) s.payoutHoldDays = Math.max(0, Math.min(120, Number.parseInt(body.payoutHoldDays, 10) || 0));
    if (body.ghlSnapshotId != null) s.ghlSnapshotId = String(body.ghlSnapshotId).trim().slice(0, 100);
    if (body.timezone != null) {
      const tz = String(body.timezone).trim();
      try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { throw new HttpError(400, 'Time zone should look like America/New_York.'); }
      s.timezone = tz;
    }
    if (body.emailDailyCap != null) s.emailDailyCap = Math.max(0, Number.parseInt(body.emailDailyCap, 10) || 0);

    if (body.webhookUrl != null) {
      const u = String(body.webhookUrl).trim();
      if (u && !/^https?:\/\//.test(u)) throw new HttpError(400, 'Webhook URL must start with https://');
      s.webhookUrl = u;
    }
    db.save();
    return { settings: settings() };
  }, { admin: true });

  route('PATCH', '/api/admin/workflows/:id', ({ params, body }) => {
    if (!WORKFLOWS.some((w) => w.id === params.id)) throw new HttpError(404, 'Workflow not found.');
    const o = { ...(db.workflowOverrides[params.id] || {}) };
    for (const k of ['setupFee', 'monthlyFee', 'costSetup', 'costMonthly']) if (body[k] != null) o[k] = Math.max(0, Number(body[k]) || 0);
    if (typeof body.enabled === 'boolean') o.enabled = body.enabled;
    // Never let a price change turn a workflow into a money-loser.
    const base = WORKFLOWS.find((w) => w.id === params.id);
    const next = { ...base, setupFee: o.setupFee ?? base.setupFee, monthlyFee: o.monthlyFee ?? base.monthlyFee, cost: { setup: o.costSetup ?? base.cost.setup, monthly: o.costMonthly ?? base.cost.monthly } };
    const profit = profitFor(next, settings().commissionRate);
    if (!profit.ok) throw new HttpError(400, `That price would lose money: ${profit.problems.join('; ')}.`);
    db.workflowOverrides[params.id] = o;
    db.save();
    return { ok: true, profit };
  }, { admin: true });

  route('POST', '/api/admin/test-webhook', async ({ user }) => {
    if (!webhookUrl()) throw new HttpError(400, 'Add a webhook URL first.');
    const fake = setup.buildDeal({ lead: { id: 'lead_test', name: 'Test Business (ignore)', phone: '(757) 555-0100', city: 'Test City', industry: 'plumber', source: 'demo' }, rep: user, workflows: [catalog()[0]], contact: { name: 'Test Owner', email: 'test@example.com' }, commissionRate: settings().commissionRate, now: now() });
    return setup.sendWebhook({ url: webhookUrl(), secret: env.WEBHOOK_SECRET, event: 'test', deal: fake, publicUrl: publicUrl(), fetchImpl });
  }, { admin: true });

  // ---- Backups ----
  route('POST', '/api/admin/backup/run', async () => backup.runBackup({ db, dir: path.join(dataDir, 'backups'), bucket: env.BACKUP_BUCKET, fetchImpl, now: now() }), { admin: true });
  route('GET', '/api/admin/backup/download', () => {
    const { sessions, ...data } = db.data; // never export login sessions
    return { __download: { filename: `salesboard-backup-${new Date(now()).toISOString().slice(0, 10)}.json`, contentType: 'application/json', body: JSON.stringify(data, null, 2) } };
  }, { admin: true });

  route('POST', '/api/admin/demo', () => ({ reps: demo.seedDemo(db, catalog(), settings(), now()) }), { admin: true });

  // "Test connection" buttons: one cheap, read-only call per tool.
  const TESTS = {
    google: async () => {
      if (!googleKey()) return { ok: false, detail: 'No GOOGLE_PLACES_API_KEY yet' };
      const res = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        // IDs-only requests are Google's free tier, so testing costs nothing.
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey(), 'X-Goog-FieldMask': 'places.id' },
        body: JSON.stringify({ textQuery: 'coffee in Norfolk, VA', pageSize: 1 }),
      });
      const j = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, detail: 'Google key works' } : { ok: false, detail: j.error?.message || `HTTP ${res.status}` };
    },
    stripe: async () => {
      if (!env.STRIPE_SECRET_KEY) return { ok: false, detail: 'No STRIPE_SECRET_KEY yet' };
      const res = await fetchImpl('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, detail: j.error?.message || `HTTP ${res.status}` };
      const avail = (j.available || []).find((b) => b.currency === 'usd')?.amount || 0;
      return { ok: true, detail: `${env.STRIPE_SECRET_KEY.includes('_test_') ? 'Test mode' : 'LIVE mode'} · $${(avail / 100).toFixed(2)} available for instant rep payouts` };
    },
    email: async () => {
      if (env.BREVO_API_KEY) {
        const res = await fetchImpl('https://api.brevo.com/v3/account', { headers: { 'api-key': env.BREVO_API_KEY, Accept: 'application/json' } });
        const j = await res.json().catch(() => ({}));
        return res.ok ? { ok: true, detail: `Brevo account: ${j.email || 'connected'}` } : { ok: false, detail: j.message || `HTTP ${res.status}` };
      }
      if (env.RESEND_API_KEY) {
        const res = await fetchImpl('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
        const j = await res.json().catch(() => ({}));
        return res.ok ? { ok: true, detail: `Resend: ${(j.data || []).length} domain(s)` } : { ok: false, detail: j.message || `HTTP ${res.status}` };
      }
      return { ok: false, detail: 'No BREVO_API_KEY or RESEND_API_KEY yet' };
    },
    ghl: async () => {
      if (!provision.connected(env, settings()).ghl) return { ok: false, detail: 'Needs GHL_API_KEY + GHL_COMPANY_ID' };
      const list = await provision.listSnapshots({ env, fetchImpl, settings: settings() });
      return { ok: true, detail: `Connected · ${list.length} template${list.length === 1 ? '' : 's'} found` };
    },
    retell: async () => {
      if (!env.RETELL_API_KEY) return { ok: false, detail: 'No RETELL_API_KEY yet' };
      const res = await fetchImpl('https://api.retellai.com/get-concurrency', { headers: { Authorization: `Bearer ${env.RETELL_API_KEY}` } });
      const j = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, detail: 'Retell key works' } : { ok: false, detail: j.message || j.error_message || `HTTP ${res.status}` };
    },
    ai: async () => {
      if (!env.ANTHROPIC_API_KEY) return { ok: false, detail: 'No ANTHROPIC_API_KEY yet (optional: AI-written openers)' };
      const client = ai.client(env, fetchImpl);
      if (!client) return { ok: false, detail: 'Run "npm install" to add the Anthropic SDK' };
      const m = await client.models.retrieve(ai.MODEL);
      return { ok: true, detail: `Claude ready (${m.display_name || ai.MODEL})` };
    },
  };
  route('POST', '/api/admin/test/:service', async ({ params }) => {
    const t = TESTS[params.service];
    if (!t) throw new HttpError(404, 'Unknown service');
    try { return await t(); } catch (err) { return { ok: false, detail: err.message }; }
  }, { admin: true });

  // 📈 What's actually working: close rates by business type and lead signal,
  // best hours to call, and the bundles that sell.
  function insights() {
    const tz = settings().timezone || 'America/New_York';
    const hourOf = (ts) => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date(ts))) % 24;
    const won = new Set(db.deals.filter((d) => d.status !== 'cancelled').map((d) => d.leadId));
    const rate = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    const byIndustry = {};
    const bySignal = {};
    for (const l of db.leads) {
      const ind = (byIndustry[l.industry] ||= { leads: 0, won: 0 });
      ind.leads++;
      if (won.has(l.id)) ind.won++;
      for (const sig of l.analysis?.signals || []) {
        const sg = (bySignal[sig.key] ||= { leads: 0, won: 0, label: GENERIC_SIGNALS[sig.key] || sig.key });
        sg.leads++;
        if (won.has(l.id)) sg.won++;
      }
    }
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, calls: 0, good: 0 }));
    for (const e of db.events) {
      if (e.voided || !game.CALL_TYPES.includes(e.type)) continue;
      const h = hours[hourOf(e.createdAt)];
      h.calls++;
      if (e.type === 'interested' || e.type === 'callback') h.good++;
    }
    const scoredHours = hours.filter((h) => h.calls >= 10).map((h) => ({ ...h, rate: rate(h.good, h.calls) })).sort((a, b) => b.rate - a.rate);
    const bundles = {};
    for (const d of db.deals.filter((x) => x.status !== 'cancelled')) {
      const key = d.workflows.map((w) => w.id).sort().join('+');
      const b = (bundles[key] ||= { names: d.workflows.map((w) => `${w.emoji} ${w.name}`).join(' + '), deals: 0, setup: 0 });
      b.deals++;
      b.setup += d.setupTotal;
    }
    return {
      byIndustry: Object.entries(byIndustry).map(([k, v]) => ({ key: k, label: getIndustry(k).label, emoji: getIndustry(k).emoji, ...v, rate: rate(v.won, v.leads) })).sort((a, b) => b.rate - a.rate || b.leads - a.leads),
      bySignal: Object.entries(bySignal).map(([k, v]) => ({ key: k, ...v, rate: rate(v.won, v.leads) })).sort((a, b) => b.rate - a.rate),
      bestHours: scoredHours.slice(0, 3),
      hours,
      bundles: Object.values(bundles).sort((a, b) => b.deals - a.deals).slice(0, 8),
    };
  }
  route('GET', '/api/admin/insights', () => insights(), { admin: true });
  route('GET', '/api/insights/best-time', () => ({ bestHours: insights().bestHours.slice(0, 2) }));

  route('GET', '/api/admin/ghl/snapshots', async () => {
    if (!provision.connected(env, settings()).ghl) throw new HttpError(400, 'Connect GoHighLevel first (GHL_API_KEY + GHL_COMPANY_ID).');
    try {
      return { snapshots: await provision.listSnapshots({ env, fetchImpl, settings: settings() }), selected: env.GHL_SNAPSHOT_ID || settings().ghlSnapshotId };
    } catch (err) {
      throw new HttpError(502, `GoHighLevel said: ${err.message}`);
    }
  }, { admin: true });

  // ---- email drip (manager) ----
  route('GET', '/api/admin/drips', () => {
    const rows = db.data.drips.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 300).map((d) => {
      const lead = db.leads.find((l) => l.id === d.leadId);
      return { id: d.id, email: d.email, name: d.name, business: lead?.name || '', sequence: d.sequence, status: d.status, step: d.step, total: drip.SEQUENCES[d.sequence].length, nextAt: d.status === 'active' ? d.nextAt : null, lastError: d.lastError || '', endedReason: d.endedReason || '', sent: d.sent };
    });
    const active = db.data.drips.filter((d) => d.status === 'active').length;
    return { rows, active, suppressed: db.data.suppressed.length, status: drip.readiness(db, settings(), env) };
  }, { admin: true });

  route('POST', '/api/admin/drips/:id/stop', ({ params, user }) => {
    const n = drip.stopFor(db, (d) => d.id === params.id, `Stopped by ${user.name}`);
    db.save();
    return { stopped: n };
  }, { admin: true });

  route('POST', '/api/admin/drips/run', async () => runDrips(), { admin: true });

  route('POST', '/api/admin/test-email', async ({ body, user }) => {
    const to = String(body.to || '').trim();
    if (!drip.validEmail(to)) throw new HttpError(400, 'Enter the email to send the test to.');
    const st = drip.readiness(db, settings(), env);
    if (!st.ready) throw new HttpError(400, `Email isn't ready yet. Still need: ${st.missing.join(', ')}.`);
    const fakeLead = { id: 'lead_test', name: 'Test Plumbing Co', city: 'Norfolk, VA', industry: 'plumber', repId: user.id, analysis: { recommended: ['missed_call_textback', 'review_engine', 'ai_receptionist'] } };
    db.leads.push(fakeLead);
    try {
      const ctx = drip.buildContext(db, { leadId: fakeLead.id, name: user.name, enrolledBy: user.id }, dripOpts());
      const email = drip.render(drip.SEQUENCES.prospect[0], ctx, { settings: settings(), unsubscribeUrl: `${publicUrl()}/unsubscribe/test` });
      await drip.sendEmail({ env, settings: settings(), to, toName: user.name, ...email, subject: `[TEST] ${email.subject}`, unsubscribeUrl: `${publicUrl()}/unsubscribe/test`, fetchImpl });
    } catch (err) {
      throw new HttpError(502, `Email provider said: ${err.message}`);
    } finally {
      db.data.leads = db.leads.filter((l) => l !== fakeLead);
    }
    return { ok: true };
  }, { admin: true });

  // ---- unsubscribe (public, from the email footer) ----
  route('GET', '/api/unsubscribe/:token', ({ params }) => {
    const d = db.data.drips.find((x) => x.token === params.token);
    if (!d) throw new HttpError(404, 'This unsubscribe link is not valid.');
    const masked = d.email.replace(/^(.).*(@.*)$/, '$1•••$2');
    return { company: settings().companyName, email: masked, unsubscribed: drip.isSuppressed(db, d.email) };
  }, { public: true });

  route('POST', '/api/unsubscribe/:token', ({ params }) => {
    const d = drip.unsubscribe(db, params.token);
    if (!d) throw new HttpError(404, 'This unsubscribe link is not valid.');
    db.save();
    return { ok: true };
  }, { public: true });
  route('DELETE', '/api/admin/demo', () => { demo.clearDemo(db); return { ok: true }; }, { admin: true });

  // ---------------- HTTP plumbing ----------------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'Bad URL'); }
      if (!pathname.startsWith('/api/')) return serveStatic(pathname, res);
      const match = routes.find((r) => r.method === req.method && r.re.test(pathname));
      if (!match) throw new HttpError(404, 'Not found');
      const m = pathname.match(match.re);
      const params = Object.fromEntries(match.keys.map((k, i) => [k, m[i + 1]]));
      const raw = await readBody(req);
      let body = {};
      if (raw && (req.headers['content-type'] || '').includes('application/json')) {
        try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Bad JSON'); }
      }
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = auth.userFromToken(db, token, now());
      if (!match.opts.public && !user) throw new HttpError(401, 'Please log in.');
      if (match.opts.admin && user.role !== 'manager') throw new HttpError(403, 'Managers only.');
      const result = await match.handler({ req, params, query: Object.fromEntries(url.searchParams), body, raw, headers: req.headers, token, user });
      if (result && result.__download) {
        const d = result.__download;
        res.writeHead(200, { 'Content-Type': d.contentType, 'Content-Disposition': `attachment; filename="${d.filename}"`, 'Cache-Control': 'no-store' });
        return res.end(d.body);
      }
      send(res, 200, result);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      send(res, status, { error: status === 500 ? 'Something went wrong. Try again.' : err.message });
    }
  }

  function serveStatic(pathname, res) {
    let file = pathname === '/' ? '/index.html' : pathname;
    if (/^\/onboard\/[a-f0-9]+\/?$/.test(pathname)) file = '/onboard.html';
    if (/^\/unsubscribe\/[a-z0-9]+\/?$/.test(pathname)) file = '/unsubscribe.html';
    const full = path.normalize(path.join(PUBLIC_DIR, file));
    if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Forbidden' });
    fs.readFile(full, (err, data) => {
      if (err) {
        // SPA fallback
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) return send(res, 404, { error: 'Not found' });
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(html);
        });
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
    });
  }

  // After a restart, finish any setup that was interrupted mid-way.
  function resumeProvisioning() {
    const stuck = db.deals.filter((d) => d.provisioning?.status === 'running' && d.status !== 'cancelled' && !inflight.has(d.id));
    stuck.forEach((d) => startProvisioning(d));
    return stuck.length;
  }

  const runBackupIfDue = () => (backup.due(db, now()) ? backup.runBackup({ db, dir: path.join(dataDir, 'backups'), bucket: env.BACKUP_BUCKET, fetchImpl, now: now() }) : null);

  return { handle, catalog, settings, runDrips, resumeProvisioning, sweepPayouts, runReminders, runBackupIfDue, waitForProvisioning: (dealId) => inflight.get(dealId) || Promise.resolve() };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve('');
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(obj));
}

module.exports = { createApp, DEFAULT_SETTINGS, AVATARS };
