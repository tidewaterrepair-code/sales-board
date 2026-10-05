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
  return { db, app, call: client(app) };
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
  const { db, app, call } = setup({ SETUP_WEBHOOK_URL: 'https://hooks.example/x', WEBHOOK_SECRET: 's3cret' }, async (url, opts) => {
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
  assert.strictEqual(deal.body.deal.setupTotal, 447 + 347);
  assert.strictEqual(deal.body.deal.commission, 79.4, '10% of setup fees');
  assert.strictEqual(deal.body.deal.commissionStatus, 'pending');
  assert.strictEqual(deal.body.deal.onboardingToken, undefined, 'token never leaks in API responses');
  await app.waitForProvisioning(deal.body.deal.id);
  assert.strictEqual(db.deals[0].webhook.status, 'sent');
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
  assert.strictEqual(me.commission, 79.4);

  // Reps can't use manager endpoints.
  assert.strictEqual((await call('POST', `/api/admin/deals/${db.deals[0].id}/paid`, { token: rep })).status, 403);

  // Payout only after client pays.
  assert.strictEqual((await call('POST', `/api/admin/deals/${db.deals[0].id}/payout`, { token: manager })).status, 400);
  await call('POST', `/api/admin/deals/${db.deals[0].id}/paid`, { token: manager });
  let stats = (await call('GET', '/api/me', { token: rep })).body.stats;
  assert.strictEqual(stats.commission.earned, 79.4);
  const payout = await call('POST', `/api/admin/reps/${repId}/payout`, { token: manager });
  assert.strictEqual(payout.body.amount, 79.4);
  stats = (await call('GET', '/api/me', { token: rep })).body.stats;
  assert.strictEqual(stats.commission.paidOut, 79.4);
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

test('every workflow is priced under market and profitable after commission', () => {
  const { profitFor } = require('../src/pricing');
  for (const w of WORKFLOWS) {
    assert.ok(w.setupFee < w.market.setup && w.monthlyFee < w.market.monthly, `${w.id} must be under market`);
    const p = profitFor(w, 0.10);
    assert.ok(p.ok && p.setupProfit > 0 && p.monthlyProfit > 0, `${w.id} must be profitable`);
  }
});

test('price edits that lose money are rejected', async () => {
  const { call } = setup();
  const { manager } = await managerAndRep(call);
  const bad = await call('PATCH', '/api/admin/workflows/missed_call_textback', { token: manager, body: { setupFee: 100 } });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.body.error, /lose money/);
  const badMonthly = await call('PATCH', '/api/admin/workflows/ai_receptionist', { token: manager, body: { monthlyFee: 99 } });
  assert.strictEqual(badMonthly.status, 400);
  const good = await call('PATCH', '/api/admin/workflows/missed_call_textback', { token: manager, body: { setupFee: 397 } });
  assert.strictEqual(good.status, 200);
  assert.ok(good.body.profit.setupProfit > 0);
  assert.strictEqual((await call('PATCH', '/api/admin/settings', { token: manager, body: { commissionRate: 0.9 } })).status, 400);
});

test('commission is a one-time 10% of setup only (never on monthly fees)', async () => {
  const { db, call } = setup();
  const { manager, rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Big Social Co', phone: '555', industry: 'gym' } } })).body.lead;
  const d = (await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['social_autopilot'] } })).body.deal;
  assert.strictEqual(d.commission, 39.7); // 10% of $397 setup, not of the $447/mo
  await call('POST', `/api/admin/deals/${d.id}/paid`, { token: manager });
  await call('POST', `/api/admin/deals/${d.id}/paid`, { token: manager }); // paying twice changes nothing
  const stats = (await call('GET', '/api/me', { token: rep })).body.stats;
  assert.strictEqual(stats.commission.lifetime, 39.7);
  assert.strictEqual(db.deals.length, 1);
});

test('email drip: lead email enrolls, sends via Brevo, stops on purchase, unsubscribe works', async () => {
  const sent = [];
  let clock = Date.parse('2026-10-05T14:00:00Z');
  const fetchImpl = async (url, opts) => {
    if (url.includes('brevo')) sent.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({}) };
  };
  const db = new DB(null);
  const app = createApp({ db, env: { BREVO_API_KEY: 'x', PUBLIC_URL: 'https://board.example' }, fetchImpl, now: () => clock });
  const call = client(app);
  const { manager, rep } = await managerAndRep(call);
  await call('PATCH', '/api/admin/settings', { token: manager, body: { fromEmail: 'hello@agency.example', businessAddress: '1 Main St, Norfolk, VA' } });
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Joe Plumbing', phone: '555', industry: 'plumber', city: 'Norfolk, VA' } } })).body.lead;

  assert.strictEqual((await call('POST', `/api/leads/${lead.id}/email`, { token: rep, body: { email: 'nope' } })).status, 400);
  const r = await call('POST', `/api/leads/${lead.id}/email`, { token: rep, body: { email: 'Joe@Plumbing.example', name: 'Joe Smith' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.pointsEarned, 3);
  assert.strictEqual(r.body.drip.sequence, 'prospect');

  await app.runDrips();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to[0].email, 'joe@plumbing.example');
  assert.match(sent[0].subject, /Joe Plumbing/);
  assert.match(sent[0].textContent, /Hi Joe,/);
  assert.match(sent[0].textContent, /1 Main St, Norfolk, VA/); // mailing address in footer
  assert.match(sent[0].textContent, /board\.example\/unsubscribe\//);
  assert.ok(sent[0].headers['List-Unsubscribe']);

  await app.runDrips(); // nothing due yet
  assert.strictEqual(sent.length, 1);
  clock += 49 * 3600000;
  await app.runDrips();
  assert.strictEqual(sent.length, 2);

  // They buy → prospect drip ends, customer welcome goes out.
  await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['missed_call_textback'], contact: { name: 'Joe', email: 'joe@plumbing.example' } } });
  await new Promise((res) => setImmediate(res));
  await app.runDrips();
  const prospect = db.data.drips.find((d) => d.sequence === 'prospect');
  const customer = db.data.drips.find((d) => d.sequence === 'customer');
  assert.strictEqual(prospect.status, 'completed');
  assert.match(sent.at(-1).subject, /Welcome aboard/);
  assert.match(sent.at(-1).textContent, /\/onboard\//);

  // Unsubscribe stops everything and blocks future enrollments.
  const un = await call('POST', `/api/unsubscribe/${customer.token}`);
  assert.strictEqual(un.status, 200);
  assert.strictEqual(customer.status, 'unsubscribed');
  clock += 5 * 86400000;
  const before = sent.length;
  await app.runDrips();
  assert.strictEqual(sent.length, before);
  const lead2 = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Joe Second Shop', phone: '556', industry: 'plumber' } } })).body.lead;
  const again = await call('POST', `/api/leads/${lead2.id}/email`, { token: rep, body: { email: 'joe@plumbing.example' } });
  assert.strictEqual(again.body.suppressed, true);
});

test('email drip waits (does not drop) until provider + sender are set up', async () => {
  const db = new DB(null);
  const app = createApp({ db, env: {}, fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  const call = client(app);
  const { rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Shop', phone: '1', industry: 'salon' } } })).body.lead;
  await call('POST', `/api/leads/${lead.id}/email`, { token: rep, body: { email: 'a@b.example' } });
  const r = await app.runDrips();
  assert.strictEqual(r.sent, 0);
  assert.match(r.reason, /email provider/);
  assert.strictEqual(db.data.drips[0].status, 'active');
});

test('google searches stop at the free monthly limit', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ places: [] }) }; };
  const { call } = setup({ GOOGLE_PLACES_API_KEY: 'k', GOOGLE_MONTHLY_LIMIT: '2' }, fetchImpl);
  const { rep } = await managerAndRep(call);
  const q = (city) => call('GET', `/api/leads/search?industry=hvac&city=${encodeURIComponent(city)}`, { token: rep });
  assert.strictEqual((await q('Norfolk, VA')).status, 200);
  assert.strictEqual((await q('Suffolk, VA')).status, 200);
  assert.strictEqual((await q('Hampton, VA')).status, 429);
  assert.strictEqual(calls, 2);
});

test('google leads: only the place ID is saved; details come back from Google; confirmed details are kept', async () => {
  const place = { id: 'ChIJ_test', displayName: { text: 'Real HVAC Co' }, formattedAddress: '9 Main St, Norfolk, VA 23510, USA', nationalPhoneNumber: '(757) 555-0177', websiteUri: '', rating: 3.9, userRatingCount: 8, businessStatus: 'OPERATIONAL' };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('searchText')) return { ok: true, json: async () => ({ places: [place] }) };
    if (url.includes('/places/ChIJ_test')) return { ok: true, json: async () => place };
    return { ok: true, json: async () => ({}) };
  };
  const db = new DB(null);
  const env = { GOOGLE_PLACES_API_KEY: 'k' };
  let call = client(createApp({ db, env, fetchImpl }));
  const { rep } = await managerAndRep(call);
  const found = (await call('GET', '/api/leads/search?industry=hvac&city=Norfolk%2C%20VA', { token: rep })).body.leads[0];
  const claimed = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: found } })).body.lead;
  assert.strictEqual(claimed.name, 'Real HVAC Co'); // shown to the rep
  const saved = db.leads[0];
  assert.strictEqual(saved.placeId, 'ChIJ_test');
  for (const k of ['name', 'phone', 'address', 'website', 'rating', 'reviews']) assert.strictEqual(saved[k], undefined, `${k} must not be stored`);
  assert.ok(!JSON.stringify(saved).includes('555-0177'));
  assert.ok(!JSON.stringify(saved.analysis).includes('8 reviews'));

  // "Restart": a new app instance has no memory, so it asks Google again.
  call = client(createApp({ db, env, fetchImpl }));
  const reopened = (await call('GET', `/api/leads/${saved.id}`, { token: rep })).body.lead;
  assert.strictEqual(reopened.phone, '(757) 555-0177');
  assert.ok(calls.some((u) => u.includes('/places/ChIJ_test')));
  assert.strictEqual(db.data.usage.googleDetails[new Date().toISOString().slice(0, 7)], 1);

  // After a real conversation, the confirmed details become our own records.
  await call('POST', `/api/leads/${saved.id}/outcome`, { token: rep, body: { outcome: 'interested' } });
  assert.strictEqual(saved.confirmed.name, 'Real HVAC Co');
});

test('do-not-call: a business that asks is never claimable again', async () => {
  const { db, call } = setup();
  const { rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Grumpy Plumbing', phone: '(757) 555-0166', industry: 'plumber' } } })).body.lead;
  await call('POST', `/api/leads/${lead.id}/outcome`, { token: rep, body: { outcome: 'not_interested', dnc: true } });
  assert.strictEqual(db.data.dnc.length, 1);
  assert.ok(!JSON.stringify(db.data.dnc).includes('555-0166'), 'stored as a hash');
  const again = await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Grumpy Plumbing (again)', phone: '757-555-0166', industry: 'plumber' } } });
  assert.strictEqual(again.status, 409);
});

// Fake GoHighLevel + Retell + Stripe for the one-button setup tests.
function fakeVendors({ failGhlTimes = 0 } = {}) {
  const calls = [];
  const customValues = [{ id: 'cv1', name: 'sb_business_name', value: '' }];
  let ghlFails = failGhlTimes;
  const fetchImpl = async (url, opts = {}) => {
    const body = opts.body && opts.headers?.['Content-Type'] === 'application/json' ? JSON.parse(opts.body) : opts.body;
    calls.push({ url, method: opts.method, body, headers: opts.headers });
    const ok = (json) => ({ ok: true, status: 200, json: async () => json });
    if (url.includes('api.stripe.com')) return ok({ url: 'https://checkout.stripe.test/s/1' });
    if (url.endsWith('/locations/')) {
      if (ghlFails-- > 0) return { ok: false, status: 422, json: async () => ({ message: 'Service busy' }) };
      return ok({ id: 'loc_123' });
    }
    if (url.endsWith('/oauth/locationToken')) return ok({ access_token: 'loc_token' });
    if (url.includes('/customValues') && opts.method === 'GET') return ok({ customValues });
    if (url.includes('/customValues')) return ok({ customValue: { id: 'cvX' } });
    if (url.endsWith('/users/')) return ok({ id: 'user_1' });
    if (url.endsWith('/contacts/upsert')) return ok({ contact: { id: 'contact_owner' } });
    if (url.endsWith('/create-retell-llm')) return ok({ llm_id: 'llm_1' });
    if (url.endsWith('/create-agent')) return ok({ agent_id: 'agent_1' });
    if (url.endsWith('/create-phone-number')) return ok({ phone_number: '+17575550142' });
    if (url.includes('/update-retell-llm/')) return ok({ llm_id: 'llm_1' });
    return ok({});
  };
  return { calls, fetchImpl };
}

const VENDOR_ENV = { STRIPE_SECRET_KEY: 'sk_test_x', GHL_API_KEY: 'pit-agency', GHL_COMPANY_ID: 'comp_1', GHL_SNAPSHOT_ID: 'snap_1', RETELL_API_KEY: 'key_r', PUBLIC_URL: 'https://board.example' };

test('one button: picks options and fully sets up the client (payment, account, workflows, login, AI phone)', async () => {
  const v = fakeVendors();
  const { db, app, call } = setup(VENDOR_ENV, v.fetchImpl);
  const { rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Bayside HVAC', phone: '(757) 555-0110', industry: 'hvac', city: 'Norfolk, VA', address: '1 Shore Dr, Norfolk, VA 23503, USA' } } })).body.lead;
  const r = await call('POST', '/api/deals', {
    token: rep,
    body: {
      leadId: lead.id,
      workflowIds: ['missed_call_textback', 'ai_receptionist'],
      contact: { name: 'Pat Lee', email: 'pat@bayside.example', phone: '(757) 555-0111' },
      options: { aiAddons: ['missed_call_textback'], areaCode: '757', createLogin: true, paymentLink: true },
    },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.deal.monthlyTotal, 167 + 47 + 257, 'AI add-on adds to monthly');
  assert.strictEqual(r.body.deal.commission, 89.4, 'commission stays 10% of setup only');
  await app.waitForProvisioning(r.body.deal.id);

  const deal = db.deals[0];
  const st = Object.fromEntries(deal.provisioning.steps.map((s) => [s.key, s.status]));
  assert.deepStrictEqual(st, { deal: 'done', payment: 'done', account: 'done', settings: 'done', login: 'done', reminders: 'done', ai: 'done', welcome: 'practice', automation: 'skipped' });
  const upsert = v.calls.find((c) => c.url.endsWith('/contacts/upsert'));
  assert.deepStrictEqual(upsert.body.tags, ['sb-setup-pending', 'sb-owner']);
  assert.strictEqual(deal.provisioning.status, 'practice'); // only the welcome email is waiting on an email provider
  assert.strictEqual(deal.paymentUrl, 'https://checkout.stripe.test/s/1');

  const loc = v.calls.find((c) => c.url.endsWith('/locations/'));
  assert.strictEqual(loc.body.snapshotId, 'snap_1');
  assert.strictEqual(loc.body.companyId, 'comp_1');
  assert.strictEqual(loc.body.city, 'Norfolk');
  assert.strictEqual(loc.body.state, 'VA');
  assert.strictEqual(loc.body.postalCode, '23503');
  assert.ok(loc.headers.Version);

  const values = Object.fromEntries(v.calls.filter((c) => c.url.includes('/customValues') && c.method !== 'GET').map((c) => [c.body.name, c.body.value]));
  assert.strictEqual(values.sb_business_name, 'Bayside HVAC'); // updated the existing one (PUT)
  assert.strictEqual(values.sb_wf_missed_call_textback, 'on');
  assert.strictEqual(values.sb_wf_review_engine, 'off');
  assert.strictEqual(values.sb_ai_missed_call_textback, 'on');
  assert.strictEqual(values.sb_ai_receptionist_number, '+17575550142');
  assert.ok(v.calls.some((c) => c.method === 'PUT' && c.url.endsWith('/customValues/cv1')));
  assert.ok(v.calls.filter((c) => c.url.includes('/customValues')).every((c) => c.headers.Authorization === 'Bearer loc_token'));

  const user = v.calls.find((c) => c.url.endsWith('/users/'));
  assert.deepStrictEqual(user.body.locationIds, ['loc_123']);
  assert.strictEqual(user.body.email, 'pat@bayside.example');

  const phone = v.calls.find((c) => c.url.endsWith('/create-phone-number'));
  assert.strictEqual(phone.body.area_code, 757);
  assert.deepStrictEqual(phone.body.inbound_agents, [{ agent_id: 'agent_1', weight: 1 }]);
  const llm = v.calls.find((c) => c.url.endsWith('/create-retell-llm'));
  assert.match(llm.body.general_prompt, /Bayside HVAC/);
  assert.strictEqual(llm.body.general_tools.find((t) => t.type === 'transfer_call').transfer_destination.number, '+17575550111');

  // Automatic checklist items are ticked; people tasks stay open.
  const ai = deal.workflows.find((w) => w.id === 'ai_receptionist');
  assert.ok(ai.tasks.filter((t) => t.by === 'retell').every((t) => t.done));
  assert.ok(ai.tasks.filter((t) => t.by === 'team').every((t) => !t.done));

  // Client fills in the setup form → AI + GoHighLevel get their answers.
  const token = r.body.onboardingUrl.split('/').pop();
  await call('POST', `/api/onboard/${token}`, { body: { answers: { hours: 'Mon-Fri 8-5', services: 'AC tune-up $89', transfer_number: '757-555-0199' } } });
  const patch = v.calls.find((c) => c.url.includes('/update-retell-llm/llm_1'));
  assert.match(patch.body.general_prompt, /Mon-Fri 8-5/);
  assert.match(patch.body.general_prompt, /AC tune-up \$89/);
  assert.strictEqual(patch.body.general_tools.find((t) => t.type === 'transfer_call').transfer_destination.number, '+17575550199');
  assert.ok(v.calls.some((c) => c.body?.name === 'sb_hours' && c.body.value === 'Mon-Fri 8-5'));
  assert.ok(ai.tasks.find((t) => t.by === 'onboarding').done);
  assert.ok(v.calls.some((c) => c.method === 'DELETE' && c.url.includes('/contacts/') && c.url.endsWith('/tags')));
});

test('one button in practice mode: no vendor calls, every step explains what to connect', async () => {
  const v = fakeVendors();
  const { db, app, call } = setup({}, v.fetchImpl);
  const { rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Practice Dental', phone: '555', industry: 'dentist' } } })).body.lead;
  const r = await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['review_engine'], contact: { email: 'doc@practice.example' } } });
  await app.waitForProvisioning(r.body.deal.id);
  const st = Object.fromEntries(db.deals[0].provisioning.steps.map((s) => [s.key, s.status]));
  assert.strictEqual(st.payment, 'practice');
  assert.strictEqual(st.account, 'practice');
  assert.strictEqual(st.settings, 'practice');
  assert.strictEqual(st.ai, 'skipped');
  assert.strictEqual(v.calls.length, 0);
});

test('a failed setup step can be retried without redoing finished steps', async () => {
  const v = fakeVendors({ failGhlTimes: 1 });
  const { db, app, call } = setup(VENDOR_ENV, v.fetchImpl);
  const { manager, rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Retry Roofing', phone: '7575550120', industry: 'roofer' } } })).body.lead;
  const r = await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['estimate_followup'] } });
  await app.waitForProvisioning(r.body.deal.id);
  const deal = db.deals[0];
  assert.strictEqual(deal.provisioning.status, 'needs_attention');
  assert.match(deal.provisioning.steps.find((s) => s.key === 'account').detail, /Service busy/);
  const stripeCalls = v.calls.filter((c) => c.url.includes('stripe')).length;

  const retry = await call('POST', `/api/admin/deals/${deal.id}/retry`, { token: manager });
  assert.strictEqual(retry.status, 200);
  assert.strictEqual(deal.provisioning.status, 'done');
  assert.strictEqual(deal.ghl.locationId, 'loc_123');
  assert.strictEqual(v.calls.filter((c) => c.url.includes('stripe')).length, stripeCalls, 'payment link not created twice');
  assert.strictEqual(deal.provisioning.steps.find((s) => s.key === 'login').status, 'skipped'); // no email given
});

test('rep can watch setup progress on their own deal only', async () => {
  const { call } = setup();
  const { manager, rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Watch Co', phone: '1', industry: 'salon' } } })).body.lead;
  const r = await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['booking_noshow'] } });
  assert.strictEqual((await call('GET', `/api/deals/${r.body.deal.id}`, { token: rep })).status, 200);
  const r2 = await call('POST', '/api/admin/users', { token: manager, body: { name: 'Other', pin: '4444' } });
  const other = (await call('POST', '/api/login', { body: { userId: r2.body.user.id, pin: '4444' } })).body.token;
  assert.strictEqual((await call('GET', `/api/deals/${r.body.deal.id}`, { token: other })).status, 404);
});

test('manager can pick the GoHighLevel template from a list', async () => {
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => (url.includes('/snapshots/') ? { snapshots: [{ id: 'snap_9', name: 'SalesBoard Master', type: 'own' }] } : {}) });
  const { db, call } = setup({ GHL_API_KEY: 'pit', GHL_COMPANY_ID: 'comp_1' }, fetchImpl);
  const { manager } = await managerAndRep(call);
  const list = await call('GET', '/api/admin/ghl/snapshots', { token: manager });
  assert.strictEqual(list.body.snapshots[0].name, 'SalesBoard Master');
  await call('PATCH', '/api/admin/settings', { token: manager, body: { ghlSnapshotId: 'snap_9' } });
  assert.strictEqual(db.settings.ghlSnapshotId, 'snap_9');
  const ov = await call('GET', '/api/admin/overview', { token: manager });
  assert.strictEqual(ov.body.integrations.p_ghlSnapshot, true);
});

test('setup never builds a second account when an earlier try already did', async () => {
  const v = fakeVendors();
  const fetchImpl = async (url, opts) => {
    if (url.includes('/locations/search')) return { ok: true, status: 200, json: async () => ({ locations: [{ id: 'loc_existing', name: `Twice Co [SB-${dealIdTail}]` }] }) };
    return v.fetchImpl(url, opts);
  };
  let dealIdTail = '';
  const { db, app, call } = setup({ ...VENDOR_ENV, RETELL_API_KEY: '' }, async (url, opts) => fetchImpl(url, opts));
  const { rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Twice Co', phone: '7575550133', industry: 'salon' } } })).body.lead;
  // Pretend the deal id is known before setup searches (tail of the id is in the account name).
  const origPush = db.deals.push.bind(db.deals);
  db.deals.push = (d) => { dealIdTail = d.id.slice(-6); return origPush(d); };
  const r = await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['booking_noshow'] } });
  await app.waitForProvisioning(r.body.deal.id);
  assert.strictEqual(db.deals[0].ghl.locationId, 'loc_existing');
  assert.ok(!v.calls.some((c) => c.url.endsWith('/locations/') && c.method === 'POST'));
});

test('temporary vendor errors (429/5xx) are retried automatically', async () => {
  let n = 0;
  const v = fakeVendors();
  const fetchImpl = async (url, opts) => {
    if (url.endsWith('/locations/') && n++ < 2) return { ok: false, status: 429, json: async () => ({ message: 'Too many requests' }) };
    return v.fetchImpl(url, opts);
  };
  const db = new DB(null);
  const app = createApp({ db, env: { ...VENDOR_ENV, RETELL_API_KEY: '' }, fetchImpl, sleep: async () => {} });
  const call = client(app);
  const { rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Busy Co', phone: '7575550144', industry: 'salon' } } })).body.lead;
  const r = await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['booking_noshow'] } });
  await app.waitForProvisioning(r.body.deal.id);
  assert.strictEqual(db.deals[0].provisioning.steps.find((st) => st.key === 'account').status, 'done');
});

test('interrupted setups resume after a restart', async () => {
  const v = fakeVendors();
  const db = new DB(null);
  let call = client(createApp({ db, env: {}, fetchImpl: v.fetchImpl }));
  const { rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Crash Co', phone: '7575550155', industry: 'hvac' } } })).body.lead;
  const r = await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['missed_call_textback'] } });
  // Simulate the server dying mid-setup.
  const deal = db.deals.find((d) => d.id === r.body.deal.id);
  await new Promise((res) => setTimeout(res, 20));
  deal.provisioning.status = 'running';
  deal.provisioning.steps = deal.provisioning.steps.slice(0, 2).map((st, i) => (i === 1 ? { ...st, status: 'working' } : st));
  const app2 = createApp({ db, env: VENDOR_ENV, fetchImpl: v.fetchImpl });
  assert.strictEqual(app2.resumeProvisioning(), 1);
  await app2.waitForProvisioning(deal.id);
  assert.notStrictEqual(deal.provisioning.status, 'running');
  assert.strictEqual(deal.provisioning.steps.find((st) => st.key === 'account').status, 'done');
});

test('test-connection buttons report clearly', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('api.stripe.com/v1/balance')) return { ok: true, status: 200, json: async () => ({ available: [{ currency: 'usd', amount: 12345 }] }) };
    if (url.includes('places:searchText')) return { ok: false, status: 403, json: async () => ({ error: { message: 'API key not valid' } }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const { call } = setup({ STRIPE_SECRET_KEY: 'sk_test_x', GOOGLE_PLACES_API_KEY: 'bad' }, fetchImpl);
  const { manager } = await managerAndRep(call);
  const stripe = await call('POST', '/api/admin/test/stripe', { token: manager });
  assert.strictEqual(stripe.body.ok, true);
  assert.match(stripe.body.detail, /\$123\.45/);
  const google = await call('POST', '/api/admin/test/google', { token: manager });
  assert.strictEqual(google.body.ok, false);
  assert.match(google.body.detail, /not valid/);
  const retell = await call('POST', '/api/admin/test/retell', { token: manager });
  assert.strictEqual(retell.body.ok, false);
});

test('AI opener: calls Claude with the right settings and saves only the opener', async () => {
  const sent = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('api.anthropic.com/v1/messages')) {
      sent.push({ body: JSON.parse(opts.body), headers: opts.headers });
      const msg = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi, is this Sunny Salon? I saw folks love you but mention it is hard to book, so I had an idea.' }], usage: { input_tokens: 10, output_tokens: 20 } };
      return new Response(JSON.stringify(msg), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const { db, call } = setup({ ANTHROPIC_API_KEY: 'sk-ant-test' }, fetchImpl);
  const { rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Sunny Salon', phone: '7575550188', industry: 'salon', reviews: 12, rating: 4.1 } } })).body.lead;
  const r = await call('POST', `/api/leads/${lead.id}/opener`, { token: rep, body: { workflowId: 'booking_noshow' } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.opener.text, /Sunny Salon/);
  const b = sent[0].body;
  assert.strictEqual(b.model, 'claude-opus-5-5');
  assert.strictEqual(b.fallbacks, 'default');
  assert.strictEqual(b.output_config.effort, 'low');
  assert.match(new Headers(sent[0].headers).get('anthropic-beta') || '', /server-side-fallback-2026-07-01/);
  assert.match(b.messages[0].content, /Online Booking/);
  assert.strictEqual(db.leads[0].opener.workflowId, 'booking_noshow');
});

function fakeStripe({ insufficientTimes = 0, instantAvailable = 100000 } = {}) {
  const calls = [];
  let insufficient = insufficientTimes;
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    const headers = opts.headers || {};
    calls.push({ url: u, method: opts.method || 'GET', body: opts.body ? new URLSearchParams(opts.body) : null, account: headers['Stripe-Account'], idem: headers['Idempotency-Key'] });
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    if (u.endsWith('/v1/accounts') && opts.method === 'POST') return ok({ id: 'acct_rep1' });
    if (u.endsWith('/v1/account_links')) return ok({ url: 'https://connect.stripe.test/onboard' });
    if (u.includes('/v1/accounts/acct_rep1') && !u.includes('login_links')) return ok({ id: 'acct_rep1', payouts_enabled: true, details_submitted: true, capabilities: { transfers: 'active' } });
    if (u.endsWith('/v1/transfers')) {
      if (insufficient-- > 0) return { ok: false, status: 400, json: async () => ({ error: { code: 'balance_insufficient', message: 'Insufficient funds' } }) };
      return ok({ id: 'tr_1' });
    }
    if (u.includes('/v1/balance')) return ok({ instant_available: [{ currency: 'usd', amount: instantAvailable }] });
    if (u.endsWith('/v1/payouts')) return ok({ id: 'po_1' });
    if (u.includes('/v1/checkout/sessions')) return ok({ url: 'https://checkout.stripe.test/s' });
    return ok({});
  };
  return { calls, fetchImpl };
}

test('instant payouts: rep links a card, client pays, commission lands instantly (once)', async () => {
  const st = fakeStripe();
  const { db, call } = setup({ STRIPE_SECRET_KEY: 'sk_test_x' }, st.fetchImpl);
  const { manager, rep, repId } = await managerAndRep(call);
  const link = await call('POST', '/api/me/payout/stripe', { token: rep });
  assert.strictEqual(link.body.url, 'https://connect.stripe.test/onboard');
  const info = await call('GET', '/api/me/payout', { token: rep });
  assert.strictEqual(info.body.stripe.ready, true);
  assert.strictEqual(db.users.find((u) => u.id === repId).stripeAccountId, 'acct_rep1');

  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Quick Pay Co', phone: '7575550191', industry: 'hvac' } } })).body.lead;
  const d = (await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['missed_call_textback'] } })).body.deal;
  await call('POST', `/api/admin/deals/${d.id}/paid`, { token: manager });
  const deal = db.deals[0];
  assert.strictEqual(deal.commissionStatus, 'paid_out');
  assert.strictEqual(deal.commissionPayout.instant, true);
  const transfer = st.calls.find((c) => c.url.endsWith('/v1/transfers'));
  assert.strictEqual(transfer.body.get('amount'), '4470'); // 10% of $447, in cents
  assert.strictEqual(transfer.body.get('destination'), 'acct_rep1');
  assert.strictEqual(transfer.idem, `sb-transfer-${deal.id}`);
  const payout = st.calls.find((c) => c.url.endsWith('/v1/payouts'));
  assert.strictEqual(payout.body.get('method'), 'instant');
  assert.strictEqual(payout.account, 'acct_rep1');
  // Paying again does nothing.
  const transfersBefore = st.calls.filter((c) => c.url.endsWith('/v1/transfers')).length;
  await call('POST', `/api/admin/deals/${d.id}/paid`, { token: manager });
  assert.strictEqual(st.calls.filter((c) => c.url.endsWith('/v1/transfers')).length, transfersBefore);
});

test('instant payouts wait for the client payment to clear, then send automatically', async () => {
  const st = fakeStripe({ insufficientTimes: 1 });
  const { db, app, call } = setup({ STRIPE_SECRET_KEY: 'sk_test_x' }, st.fetchImpl);
  const { manager, rep } = await managerAndRep(call);
  await call('POST', '/api/me/payout/stripe', { token: rep });
  await call('GET', '/api/me/payout', { token: rep });
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Slow Clear Co', phone: '7575550192', industry: 'hvac' } } })).body.lead;
  const d = (await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['review_engine'] } })).body.deal;
  await call('POST', `/api/admin/deals/${d.id}/paid`, { token: manager });
  assert.strictEqual(db.deals[0].commissionStatus, 'earned');
  assert.strictEqual(db.deals[0].commissionPayout.status, 'waiting');
  assert.strictEqual(await app.sweepPayouts(), 1);
  assert.strictEqual(db.deals[0].commissionStatus, 'paid_out');
});

test('Cash App: reps save a $cashtag and managers record a one-tap payout', async () => {
  const { db, call } = setup();
  const { manager, rep, repId } = await managerAndRep(call);
  assert.strictEqual((await call('PATCH', '/api/me/payout', { token: rep, body: { cashtag: 'bad tag!' } })).status, 400);
  assert.strictEqual((await call('PATCH', '/api/me/payout', { token: rep, body: { cashtag: 'MariaSells' } })).body.cashtag, '$MariaSells');
  const { cashAppLink } = require('../src/payouts');
  assert.strictEqual(cashAppLink('$MariaSells', 44.7), 'https://cash.app/%24MariaSells/44.70');
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Cash Co', phone: '7575550193', industry: 'hvac' } } })).body.lead;
  const d = (await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['missed_call_textback'] } })).body.deal;
  await call('POST', `/api/admin/deals/${d.id}/paid`, { token: manager });
  const ov = await call('GET', '/api/admin/overview', { token: manager });
  assert.strictEqual(ov.body.users.find((u) => u.id === repId).cashtag, '$MariaSells');
  await call('POST', `/api/admin/reps/${repId}/payout`, { token: manager, body: { method: 'cashapp' } });
  assert.strictEqual(db.deals[0].commissionPayout.method, 'cashapp');
  assert.strictEqual(db.deals[0].commissionStatus, 'paid_out');
});

test('checkout shows the no-refund policy and supports yearly billing', async () => {
  const st = fakeStripe();
  const { app, db, call } = setup({ STRIPE_SECRET_KEY: 'sk_test_x' }, st.fetchImpl);
  const { rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Yearly Co', phone: '7575550194', industry: 'hvac' } } })).body.lead;
  const r = await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['missed_call_textback'], options: { billing: 'yearly' } } });
  await app.waitForProvisioning(r.body.deal.id);
  const co = st.calls.find((c) => c.url.includes('/v1/checkout/sessions'));
  assert.strictEqual(co.body.get('custom_text[submit][message]'), 'All sales are final. No refunds.');
  assert.strictEqual(co.body.get('line_items[1][price_data][recurring][interval]'), 'year');
  assert.strictEqual(co.body.get('line_items[1][price_data][unit_amount]'), String(167 * 10 * 100));
  assert.strictEqual(db.deals[0].billing, 'yearly');
});

test('AI receptionist minutes are tracked from signed Retell webhooks, with an 80% alert', async () => {
  const cryptoMod = require('node:crypto');
  const v = fakeVendors();
  const { db, app, call } = setup({ ...VENDOR_ENV, PUBLIC_URL: 'https://board.example' }, v.fetchImpl);
  const { manager, rep } = await managerAndRep(call);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Chatty Dental', phone: '7575550199', industry: 'dentist' } } })).body.lead;
  const r = await call('POST', '/api/deals', { token: rep, body: { leadId: lead.id, workflowIds: ['ai_receptionist'] } });
  await app.waitForProvisioning(r.body.deal.id);
  assert.strictEqual(v.calls.find((c) => c.url.endsWith('/create-agent')).body.webhook_url, 'https://board.example/api/hooks/retell');
  const send = (ms, sig) => {
    const body = JSON.stringify({ event: 'call_ended', call: { agent_id: 'agent_1', duration_ms: ms } });
    const ts = String(Date.now());
    const d = cryptoMod.createHmac('sha256', 'key_r').update(body + ts).digest('hex');
    return call('POST', '/api/hooks/retell', { body, headers: { 'x-retell-signature': sig || `v=${ts},d=${d}` } });
  };
  assert.strictEqual((await send(60000, 'v=1,d=' + '0'.repeat(64))).status, 401);
  await send(400 * 60000);
  assert.strictEqual(db.deals[0].aiUsage.calls, 1);
  assert.strictEqual(db.deals[0].aiUsage.alerted, false);
  await send(100 * 60000);
  assert.strictEqual(db.deals[0].aiUsage.alerted, true); // 500 of 600 minutes
  const ov = await call('GET', '/api/admin/overview', { token: manager });
  assert.strictEqual(ov.body.alerts[0].minutes, 500);
});

test('insights show close rates and the best hours to call', async () => {
  const { db, call } = setup();
  const { manager } = await managerAndRep(call);
  await call('POST', '/api/admin/demo', { token: manager });
  const ins = (await call('GET', '/api/admin/insights', { token: manager })).body;
  assert.ok(ins.byIndustry.length > 0);
  assert.ok(ins.bestHours.length > 0);
  assert.ok(ins.bundles.length > 0);
  assert.ok(db.leads.length > 0);
});

test('web push: payload is encrypted per RFC 8291 and signed with VAPID', async () => {
  const cryptoMod = require('node:crypto');
  const push = require('../src/push');
  const db = new DB(null);
  const vapid = push.vapidKeys(db);
  // A pretend browser subscription.
  const ua = cryptoMod.createECDH('prime256v1');
  const uaPublic = ua.generateKeys();
  const auth = cryptoMod.randomBytes(16);
  const keys = { p256dh: uaPublic.toString('base64url'), auth: auth.toString('base64url') };
  const body = push.encrypt(JSON.stringify({ title: 'Hi' }), keys);
  // Decrypt like a browser would.
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const ikm = Buffer.from(cryptoMod.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32));
  const cek = Buffer.from(cryptoMod.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(cryptoMod.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = cryptoMod.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.strictEqual(plain.subarray(0, plain.length - 1).toString(), '{"title":"Hi"}');
  assert.strictEqual(plain[plain.length - 1], 2);
  // VAPID JWT verifies with the public key.
  const jwt = push.vapidJwt('https://fcm.googleapis.com/fcm/send/abc', vapid, 'mailto:a@b.co');
  const [h, c, sig] = jwt.split('.');
  const pub = Buffer.from(vapid.publicKey, 'base64url');
  const key = cryptoMod.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(cryptoMod.verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  assert.strictEqual(JSON.parse(Buffer.from(c, 'base64url')).aud, 'https://fcm.googleapis.com');
});

test('callback reminders buzz the rep once when a callback is due', async () => {
  const pushes = [];
  const fetchImpl = async (url, opts = {}) => {
    if (String(url).startsWith('https://push.example')) { pushes.push(opts.headers); return { ok: true, status: 201, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  let t = Date.now();
  const db = new DB(null);
  const app = createApp({ db, env: {}, fetchImpl, now: () => t });
  const call = client(app);
  const { rep } = await managerAndRep(call);
  const cryptoMod = require('node:crypto');
  const ua = cryptoMod.createECDH('prime256v1');
  const sub = { endpoint: 'https://push.example/sub1', keys: { p256dh: ua.generateKeys().toString('base64url'), auth: cryptoMod.randomBytes(16).toString('base64url') } };
  assert.strictEqual((await call('POST', '/api/push/subscribe', { token: rep, body: { subscription: sub } })).status, 200);
  const lead = (await call('POST', '/api/leads/claim', { token: rep, body: { lead: { name: 'Later Co', phone: '7575550111', industry: 'hvac' } } })).body.lead;
  await call('POST', `/api/leads/${lead.id}/outcome`, { token: rep, body: { outcome: 'callback', callbackAt: t + 60000 } });
  assert.strictEqual(await app.runReminders(), 0);
  t += 120000;
  assert.strictEqual(await app.runReminders(), 1);
  assert.strictEqual(await app.runReminders(), 0);
  assert.match(pushes[0].Authorization, /^vapid t=.+, k=.+/);
  assert.strictEqual(pushes[0]['Content-Encoding'], 'aes128gcm');
});

test('SQLite storage: saves only changes, survives restart, migrates old JSON, and backs up', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { openDefault } = require('../src/db');
  const backupLib = require('../src/backup');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'u1', name: 'Old Timer', role: 'manager' }], settings: { companyName: 'Legacy Co' }, events: [], searchCache: { x: 1 } }));
  let db = openDefault(dir);
  assert.strictEqual(db.kind, 'sqlite');
  assert.strictEqual(db.users[0].name, 'Old Timer');
  assert.ok(fs.existsSync(path.join(dir, 'db.json.migrated')));
  db.events.push({ id: 'e1', userId: 'u1', type: 'call', points: 1, createdAt: 1 });
  db.settings.companyName = 'New Co';
  db.users[0].name = 'Renamed';
  db.save(); db.flush();
  db.events[0].voided = true; db.markDirty('events', db.events[0]);
  db.save(); db.close();
  db = openDefault(dir);
  assert.strictEqual(db.users[0].name, 'Renamed');
  assert.strictEqual(db.settings.companyName, 'New Co');
  assert.strictEqual(db.events[0].voided, true);
  assert.strictEqual(db.data.searchCache, undefined);
  const st = await backupLib.runBackup({ db, dir: path.join(dir, 'backups'), now: Date.parse('2026-10-05T12:00:00Z') });
  assert.ok(fs.existsSync(path.join(dir, 'backups', st.file)));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('my deals list is reachable (route order)', async () => {
  const { call } = setup();
  const { rep } = await managerAndRep(call);
  const r = await call('GET', '/api/deals/mine', { token: rep });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.deals, []);
});
