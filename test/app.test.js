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

test('google searches stop at the free monthly limit and repeat searches use the cache', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, json: async () => ({ places: [] }) }; };
  const { call } = setup({ GOOGLE_PLACES_API_KEY: 'k', GOOGLE_MONTHLY_LIMIT: '2' }, fetchImpl);
  const { rep } = await managerAndRep(call);
  const q = (city) => call('GET', `/api/leads/search?industry=hvac&city=${encodeURIComponent(city)}`, { token: rep });
  assert.strictEqual((await q('Norfolk, VA')).status, 200);
  assert.strictEqual((await q('Norfolk, VA')).status, 200); // cached
  assert.strictEqual(calls, 1);
  assert.strictEqual((await q('Suffolk, VA')).status, 200);
  const blocked = await q('Hampton, VA');
  assert.strictEqual(blocked.status, 429);
  assert.strictEqual(calls, 2);
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
      if (ghlFails-- > 0) return { ok: false, status: 503, json: async () => ({ message: 'Service busy' }) };
      return ok({ id: 'loc_123' });
    }
    if (url.endsWith('/oauth/locationToken')) return ok({ access_token: 'loc_token' });
    if (url.includes('/customValues') && opts.method === 'GET') return ok({ customValues });
    if (url.includes('/customValues')) return ok({ customValue: { id: 'cvX' } });
    if (url.endsWith('/users/')) return ok({ id: 'user_1' });
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
  assert.deepStrictEqual(st, { deal: 'done', payment: 'done', account: 'done', settings: 'done', login: 'done', ai: 'done', welcome: 'practice', automation: 'skipped' });
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
