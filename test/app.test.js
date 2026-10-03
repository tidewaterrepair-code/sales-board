'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { DB } = require('../src/db');
const { createApp } = require('../src/app');
const { analyzeLead, demoLeads } = require('../src/leads');
const { dealPoints, levelFor } = require('../src/game');
const { verifyStripeSignature } = require('../src/setup');
const { WORKFLOWS } = require('../src/workflows');

// Calls the app's request handler without opening a socket.
function client(app) {
  return async (method, path, { body, token, headers = {} } = {}) => {
    const raw = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const req = require('node:stream').Readable.from(raw ? [Buffer.from(raw)] : []);
    Object.assign(req, { method, url: path, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
    return new Promise((resolve) => {
      const res = {
        headersSent: false,
        writeHead(status) { this.status = status; this.headersSent = true; },
        end(data) { resolve({ status: this.status, body: JSON.parse(data) }); },
      };
      app.handle(req, res);
    });
  };
}

function setup(env = {}, fetchImpl) {
  const db = new DB(null);
  const app = createApp({ db, env: { PORT: 3000, ...env }, fetchImpl: fetchImpl || (async () => ({ ok: true, json: async () => ({}) })) });
  return { db, call: client(app) };
}

async function managerAndRep(call) {
  const m = await call('POST', '/api/setup-first', { body: { name: 'Boss', pin: '9999' } });
  const r = await call('POST', '/api/admin/users', { token: m.body.token, body: { name: 'Maria', pin: '1234' } });
  const login = await call('POST', '/api/login', { body: { userId: r.body.user.id, pin: '1234' } });
  return { manager: m.body.token, rep: login.body.token, repId: r.body.user.id };
}

test('catalog has exactly 10 complete workflows', () => {
  assert.strictEqual(WORKFLOWS.length, 10);
  for (const w of WORKFLOWS) {
    for (const k of ['id', 'name', 'pitch', 'close', 'setupFee', 'monthlyFee']) assert.ok(w[k] != null, `${w.id} missing ${k}`);
    assert.ok(w.discovery.length && w.objections.length && w.onboarding.length && w.setupTasks.length, w.id);
    assert.ok(['none', 'optional', 'ai'].includes(w.ai));
  }
});

test('lead scoring rewards missing website and few reviews', () => {
  const hot = analyzeLead({ name: 'A', phone: '1', website: '', rating: 3.8, reviews: 5, industry: 'plumber' });
  const cold = analyzeLead({ name: 'B', phone: '1', website: 'https://x', rating: 4.8, reviews: 500, industry: 'plumber' });
  assert.ok(hot.score > cold.score);
  assert.strictEqual(hot.temperature, 'hot');
  assert.ok(hot.recommended.includes('review_engine'));
  assert.strictEqual(analyzeLead({ name: 'C', phone: '1', businessStatus: 'CLOSED_PERMANENTLY', reviews: 0 }).score, 0);
});

test('demo leads are deterministic and use fictional numbers', () => {
  const a = demoLeads({ industryKey: 'hvac', city: 'Norfolk, VA' });
  const b = demoLeads({ industryKey: 'hvac', city: 'Norfolk, VA' });
  assert.deepStrictEqual(a, b);
  for (const l of a.leads) assert.match(l.phone, /555-01\d\d$/);
});

test('points and levels', () => {
  assert.deepStrictEqual(dealPoints({ setupTotal: 1094, workflowCount: 2, speed: true }), { base: 109, bundle: 25, fast: 20, total: 154 });
  assert.strictEqual(levelFor(0).name, 'Rookie');
  assert.strictEqual(levelFor(800).name, 'Closer');
});

test('full flow: claim → call → one-button close → commission → payout', async () => {
  const hooks = [];
  const { db, call } = setup({ SETUP_WEBHOOK_URL: 'https://hooks.example/x', WEBHOOK_SECRET: 's3cret' }, async (url, opts) => {
    hooks.push({ url, body: JSON.parse(opts.body), sig: opts.headers['X-SalesBoard-Signature'] });
    return { ok: true, json: async () => ({}) };
  });
  const { manager, rep, repId } = await managerAndRep(call);

  const search = await call('GET', '/api/leads/search?industry=plumber&city=Norfolk%2C%20VA', { token: rep });
  assert.strictEqual(search.status, 200);
  assert.ok(search.body.demo);
  const raw = search.body.leads[0];
  const claim = await call('POST', '/api/leads/claim', { token: rep, body: { lead: raw } });
  const leadId = claim.body.lead.id;

  // A second rep can't steal it.
  const r2 = await call('POST', '/api/admin/users', { token: manager, body: { name: 'Jordan', pin: '5555' } });
  const jordan = (await call('POST', '/api/login', { body: { userId: r2.body.user.id, pin: '5555' } })).body.token;
  assert.strictEqual((await call('POST', '/api/leads/claim', { token: jordan, body: { lead: raw } })).status, 409);
  assert.strictEqual((await call('GET', `/api/leads/${leadId}`, { token: jordan })).status, 403);

  const o1 = await call('POST', `/api/leads/${leadId}/outcome`, { token: rep, body: { outcome: 'no_answer' } });
  assert.strictEqual(o1.body.pointsEarned, 1);
  const o2 = await call('POST', `/api/leads/${leadId}/outcome`, { token: rep, body: { outcome: 'interested' } });
  assert.strictEqual(o2.body.pointsEarned, 0, 'call points only once per lead per day');

  const deal = await call('POST', '/api/deals', { token: rep, body: { leadId, workflowIds: ['missed_call_textback', 'review_engine'], contact: { name: 'Mike', email: 'mike@example.com' } } });
  assert.strictEqual(deal.status, 200);
  assert.strictEqual(deal.body.deal.setupTotal, 497 + 597);
  assert.strictEqual(deal.body.deal.commission, 109.4, '10% of setup fees');
  assert.strictEqual(deal.body.deal.commissionStatus, 'pending');
  assert.strictEqual(deal.body.deal.onboardingToken, undefined, 'token never leaks in API responses');
  assert.strictEqual(deal.body.deal.webhook.status, 'sent');
  assert.strictEqual(hooks[0].body.event, 'deal.created');
  const expectedSig = `sha256=${crypto.createHmac('sha256', 's3cret').update(JSON.stringify(hooks[0].body)).digest('hex')}`;
  assert.strictEqual(hooks[0].sig, expectedSig);

  // No duplicate deal on the same lead.
  assert.strictEqual((await call('POST', '/api/deals', { token: rep, body: { leadId, workflowIds: ['missed_call_textback'] } })).status, 400);

  // Client onboarding.
  const token = deal.body.onboardingUrl.split('/').pop();
  const ob = await call('GET', `/api/onboard/${token}`);
  assert.ok(ob.body.fields.some((f) => f.key === 'business_phone' && f.value === raw.phone));
  assert.strictEqual((await call('POST', `/api/onboard/${token}`, { body: { answers: { alert_cell: '555' } } })).status, 200);
  assert.ok(db.deals[0].onboarding.answers.alert_cell);

  // Leaderboard.
  const board = await call('GET', '/api/leaderboard?period=today', { token: rep });
  const me = board.body.rows.find((r) => r.userId === repId);
  assert.strictEqual(me.rank, 1);
  assert.strictEqual(me.commission, 109.4);

  // Reps can't use manager endpoints.
  assert.strictEqual((await call('POST', `/api/admin/deals/${db.deals[0].id}/paid`, { token: rep })).status, 403);

  // Payout only after client pays.
  assert.strictEqual((await call('POST', `/api/admin/deals/${db.deals[0].id}/payout`, { token: manager })).status, 400);
  await call('POST', `/api/admin/deals/${db.deals[0].id}/paid`, { token: manager });
  let stats = (await call('GET', '/api/me', { token: rep })).body.stats;
  assert.strictEqual(stats.commission.earned, 109.4);
  const payout = await call('POST', `/api/admin/reps/${repId}/payout`, { token: manager });
  assert.strictEqual(payout.body.amount, 109.4);
  stats = (await call('GET', '/api/me', { token: rep })).body.stats;
  assert.strictEqual(stats.commission.paidOut, 109.4);
});

test('cancelling a deal removes points and commission', async () => {
  const { db, call } = setup();
  const { manager, rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Walk-in Salon', phone: '555', industry: 'salon' } } })).body.lead;
  const before = (await call('GET', '/api/me', { token: rep })).body.stats.points;
  await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['booking_noshow'] } });
  assert.ok((await call('GET', '/api/me', { token: rep })).body.stats.points > before);
  await call('POST', `/api/admin/deals/${db.deals[0].id}/cancel`, { token: manager });
  const after = (await call('GET', '/api/me', { token: rep })).body.stats;
  assert.strictEqual(after.points, before);
  assert.strictEqual(after.commission.lifetime, 0);
});

test('PIN lockout after repeated failures', async () => {
  const { db, call } = setup();
  await managerAndRep(call);
  const maria = db.users.find((u) => u.name === 'Maria');
  for (let i = 0; i < 5; i++) assert.strictEqual((await call('POST', '/api/login', { body: { userId: maria.id, pin: '0000' } })).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { body: { userId: maria.id, pin: '1234' } })).status, 429);
});

test('stripe signature verification', () => {
  const secret = 'whsec_test';
  const body = '{"type":"checkout.session.completed"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  assert.ok(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret));
  assert.ok(!verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)}`, secret));
  assert.ok(!verifyStripeSignature(body, `t=${t - 10000},v1=${sig}`, secret));
});

test('stripe webhook marks deal paid', async () => {
  const secret = 'whsec_x';
  const { db, call } = setup({ STRIPE_WEBHOOK_SECRET: secret });
  const { rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Dent Co', phone: '555', industry: 'dentist' } } })).body.lead;
  await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['review_engine'] } });
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { metadata: { deal_id: db.deals[0].id } } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const res = await call('POST', '/api/hooks/stripe', { body, headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(db.deals[0].commissionStatus, 'earned');
});

test('google places results are mapped into leads', async () => {
  let sent;
  const fetchImpl = async (url, opts) => {
    sent = { url, opts };
    return { ok: true, json: async () => ({ places: [{ id: 'ChIJ1', displayName: { text: 'Real Plumbing' }, formattedAddress: '1 Main St', nationalPhoneNumber: '(757) 555-0100', rating: 4.1, userRatingCount: 22, businessStatus: 'OPERATIONAL' }], nextPageToken: 'abc' }) };
  };
  const { call } = setup({ GOOGLE_PLACES_API_KEY: 'k' }, fetchImpl);
  const { rep } = await managerAndRep(call);
  const r = await call('GET', '/api/leads/search?industry=plumber&city=Norfolk%2C%20VA', { token: rep });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(JSON.parse(sent.opts.body).textQuery, 'plumber in Norfolk, VA');
  assert.strictEqual(sent.opts.headers['X-Goog-Api-Key'], 'k');
  assert.strictEqual(r.body.leads[0].source, 'google');
  assert.strictEqual(r.body.leads[0].name, 'Real Plumbing');
  assert.strictEqual(r.body.nextPageToken, 'abc');
});
