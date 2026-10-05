'use strict';

// The "SET IT ALL UP" engine. Runs right after a rep presses the button and
// builds everything for the new client, step by step:
//
//   1. deal       deal saved, commission locked in
//   2. payment    Stripe payment link (setup fee + monthly plan)
//   3. account    GoHighLevel sub-account created from your template snapshot
//   4. settings   business details filled in + purchased workflows switched ON
//   5. login      owner gets their own login
//   6. ai         AI receptionist built in Retell + local phone number bought
//   7. welcome    welcome email with their setup form
//   8. automation optional extra webhook (Make / Zapier)
//
// Every step is safe to re-run ("Retry" in the manager screen skips what's done).
// Missing keys = "practice" status, so reps can train before you connect tools.

const crypto = require('node:crypto');
const { getIndustry } = require('./industries');
const { WORKFLOWS } = require('./workflows');
const setup = require('./setup');
const drip = require('./drip');

const GHL_BASE = 'https://services.leadconnectorhq.com';
const RETELL_BASE = 'https://api.retellai.com';

const STEPS = [
  ['deal', 'Deal saved + your commission locked in'],
  ['payment', 'Payment link created'],
  ['account', 'Client account built from your template'],
  ['settings', 'Business details filled in + workflows switched on'],
  ['login', 'Owner login created'],
  ['ai', 'AI receptionist built + phone number bought'],
  ['welcome', 'Welcome email with their setup form'],
  ['automation', 'Extra automation notified'],
];

// ---------------------------------------------------------------- helpers

function toE164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return '';
}

function splitAddress(address, fallbackCity) {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (/^(USA|United States)$/i.test(parts.at(-1) || '')) parts.pop();
  const m = (parts.at(-1) || '').match(/^([A-Z]{2})\s*(\d{5})?/);
  if (m && parts.length >= 2) return { address: parts.slice(0, -2).join(', '), city: parts.at(-2), state: m[1], postalCode: m[2] || '' };
  const [city, state] = String(fallbackCity || '').split(',').map((x) => x.trim());
  return { address: parts[0] || '', city: city || '', state: (state || '').slice(0, 2).toUpperCase(), postalCode: '' };
}

function apiError(service, res, json) {
  const msg = Array.isArray(json?.message) ? json.message.join(', ') : json?.message || json?.error?.message || json?.error || `HTTP ${res.status}`;
  const err = new Error(`${service}: ${msg}`);
  err.status = res.status;
  return err;
}

async function ghl(ctx, method, path, { token, body, form } = {}) {
  const headers = {
    Authorization: `Bearer ${token || ctx.env.GHL_API_KEY}`,
    Version: ctx.env.GHL_API_VERSION || '2021-07-28',
    Accept: 'application/json',
  };
  let payload;
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); } else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await ctx.fetchImpl(`${GHL_BASE}${path}`, { method, headers, body: payload, signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError('GoHighLevel', res, json);
  return json;
}

async function retell(ctx, method, path, body) {
  const res = await ctx.fetchImpl(`${RETELL_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ctx.env.RETELL_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError('Retell', res, json);
  return json;
}

// A sub-account token works for every sub-account endpoint. If your token
// can't mint one, we fall back to the agency token itself.
async function locationToken(ctx, locationId) {
  try {
    const r = await ghl(ctx, 'POST', '/oauth/locationToken', { form: { companyId: ctx.env.GHL_COMPANY_ID, locationId } });
    return r.access_token || ctx.env.GHL_API_KEY;
  } catch {
    return ctx.env.GHL_API_KEY;
  }
}

async function upsertCustomValues(ctx, locationId, values) {
  const token = await locationToken(ctx, locationId);
  const existing = (await ghl(ctx, 'GET', `/locations/${locationId}/customValues`, { token })).customValues || [];
  const byName = new Map(existing.map((c) => [String(c.name).toLowerCase(), c]));
  let n = 0;
  for (const [name, value] of Object.entries(values)) {
    const v = String(value ?? '');
    const found = byName.get(name.toLowerCase());
    if (found) {
      if (found.value !== v) await ghl(ctx, 'PUT', `/locations/${locationId}/customValues/${found.id}`, { token, body: { name: found.name, value: v } });
    } else {
      await ghl(ctx, 'POST', `/locations/${locationId}/customValues`, { token, body: { name, value: v } });
    }
    n++;
  }
  return n;
}

// The values your snapshot's workflows read, e.g. {{custom_values.sb_business_name}}.
// Each workflow checks its own switch: sb_wf_missed_call_textback = on/off.
function customValuesFor(deal, settings, publicUrl) {
  const bought = new Set(deal.workflows.map((w) => w.id));
  const ai = new Set(deal.workflows.filter((w) => w.aiAddon).map((w) => w.id));
  const v = {
    sb_business_name: deal.business.name,
    sb_business_phone: deal.business.phone,
    sb_business_website: deal.business.website,
    sb_business_address: deal.business.address,
    sb_city: (deal.business.city || '').split(',')[0],
    sb_industry: getIndustry(deal.business.industry).trade,
    sb_owner_first_name: (deal.contact.name || '').split(' ')[0],
    sb_owner_email: deal.contact.email,
    sb_owner_cell: deal.contact.phone,
    sb_review_link: deal.business.reviewLink,
    sb_onboarding_link: `${publicUrl}/onboard/${deal.onboardingToken}`,
    sb_agency_name: settings.companyName,
  };
  for (const w of WORKFLOWS) {
    v[`sb_wf_${w.id}`] = bought.has(w.id) ? 'on' : 'off';
    if (w.ai === 'optional') v[`sb_ai_${w.id}`] = ai.has(w.id) ? 'on' : 'off';
  }
  if (deal.retell?.phoneNumber) v.sb_ai_receptionist_number = deal.retell.phoneNumber;
  for (const [k, val] of Object.entries(deal.onboarding?.answers || {})) v[`sb_${k}`] = val;
  return v;
}

function receptionistPrompt(deal, settings) {
  const a = deal.onboarding?.answers || {};
  const ind = getIndustry(deal.business.industry);
  const lines = [
    `You are the friendly, professional phone receptionist for ${deal.business.name}, a ${ind.trade} business in ${(deal.business.city || '').split(',')[0] || 'the area'}.`,
    `Business phone: ${deal.business.phone || 'n/a'}. Website: ${deal.business.website || 'n/a'}. Address: ${deal.business.address || 'n/a'}.`,
    `Hours: ${a.hours || 'not provided yet. Say the team will call back as soon as possible.'}`,
    `Services and prices: ${a.services || 'not provided yet. Do not quote prices; say the team will follow up with pricing.'}`,
    a.faqs ? `Frequently asked questions:\n${a.faqs}` : '',
    'How to handle every call:',
    '1. Greet warmly, find out what the caller needs.',
    '2. Answer only from the information above. Never invent prices, availability or promises.',
    '3. Collect the caller\'s name, phone number, what they need and the best time to reach them. Repeat the phone number back.',
    '4. If it is an emergency or the caller asks for a person, use the transfer tool.',
    `5. Tell them someone from ${deal.business.name} will follow up shortly, thank them, and end the call.`,
    'Keep answers short (1–2 sentences) and sound like a real person.',
  ];
  return lines.filter(Boolean).join('\n');
}

function retellTools(deal) {
  const tools = [{ type: 'end_call', name: 'end_call', description: 'End the call politely once the caller is helped.' }];
  const transfer = toE164(deal.onboarding?.answers?.transfer_number || deal.contact.phone || deal.business.phone);
  if (transfer) {
    tools.push({
      type: 'transfer_call',
      name: 'transfer_to_owner',
      description: 'Transfer emergencies or callers who ask to speak with a person.',
      transfer_destination: { type: 'predefined', number: transfer },
      transfer_option: { type: 'cold_transfer' },
    });
  }
  return tools;
}

// ---------------------------------------------------------------- steps

const has = (env, ...keys) => keys.every((k) => env[k]);
const snapshotId = (ctx) => ctx.env.GHL_SNAPSHOT_ID || ctx.settings.ghlSnapshotId || '';

const RUNNERS = {
  async deal(ctx) {
    return { status: 'done', detail: `${money(ctx.deal.commission)} commission for ${ctx.deal.repName}` };
  },

  async payment(ctx) {
    const { deal, env } = ctx;
    if (!deal.options.paymentLink) return { status: 'skipped', detail: 'You chose to bill them another way' };
    if (deal.paymentUrl) return { status: 'done', detail: 'Link ready' };
    if (!env.STRIPE_SECRET_KEY) return { status: 'practice', detail: 'Connect Stripe to send real payment links' };
    deal.paymentUrl = await setup.createStripeCheckout({ deal, secretKey: env.STRIPE_SECRET_KEY, publicUrl: ctx.publicUrl, fetchImpl: ctx.fetchImpl });
    deal.paymentError = '';
    return { status: 'done', detail: 'Link ready to text/email' };
  },

  async account(ctx) {
    const { deal, env, settings } = ctx;
    if (deal.ghl.locationId) return { status: 'done', detail: `Sub-account ${deal.ghl.locationId}` };
    if (!has(env, 'GHL_API_KEY', 'GHL_COMPANY_ID')) return { status: 'practice', detail: 'Connect GoHighLevel to build real client accounts' };
    const addr = splitAddress(deal.business.address, deal.business.city);
    const [firstName, ...rest] = (deal.contact.name || 'Owner').split(' ');
    const body = {
      name: deal.business.name,
      companyId: env.GHL_COMPANY_ID,
      phone: toE164(deal.business.phone) || undefined,
      address: addr.address || undefined,
      city: addr.city || undefined,
      state: addr.state || undefined,
      postalCode: addr.postalCode || undefined,
      country: 'US',
      website: deal.business.website || undefined,
      timezone: settings.timezone || 'America/New_York',
      prospectInfo: { firstName, lastName: rest.join(' ') || deal.business.name, email: deal.contact.email || undefined },
      snapshotId: snapshotId(ctx) || undefined,
    };
    const r = await ghl(ctx, 'POST', '/locations/', { body });
    deal.ghl.locationId = r.id || r.location?.id;
    if (!deal.ghl.locationId) throw new Error('GoHighLevel did not return a sub-account id');
    return { status: 'done', detail: snapshotId(ctx) ? 'Built from your template snapshot' : 'Built, but no template picked yet (Manager → 🚀 Launch → pick your snapshot)' };
  },

  async settings(ctx) {
    const { deal } = ctx;
    if (!deal.ghl.locationId) return { status: ctx.status('account') === 'practice' ? 'practice' : 'skipped', detail: 'Needs the client account first' };
    const n = await upsertCustomValues(ctx, deal.ghl.locationId, customValuesFor(deal, ctx.settings, ctx.publicUrl));
    deal.ghl.valuesSynced = Date.now();
    return { status: 'done', detail: `${deal.workflows.length} workflow${deal.workflows.length === 1 ? '' : 's'} switched on · ${n} details filled in` };
  },

  async login(ctx) {
    const { deal, env } = ctx;
    if (!deal.options.createLogin) return { status: 'skipped', detail: 'You chose no login for now' };
    if (!deal.contact.email) return { status: 'skipped', detail: 'No owner email, so no login (add one on the setup form)' };
    if (deal.ghl.userId) return { status: 'done', detail: deal.contact.email };
    if (!deal.ghl.locationId) return { status: ctx.status('account') === 'practice' ? 'practice' : 'skipped', detail: 'Needs the client account first' };
    const [firstName, ...rest] = (deal.contact.name || 'Owner').split(' ');
    try {
      const r = await ghl(ctx, 'POST', '/users/', {
        body: {
          companyId: env.GHL_COMPANY_ID,
          firstName,
          lastName: rest.join(' ') || '-',
          email: deal.contact.email,
          password: `${crypto.randomBytes(12).toString('base64url')}!9a`, // random; they set their own with "Forgot password"
          phone: toE164(deal.contact.phone) || undefined,
          type: 'account',
          role: 'admin',
          locationIds: [deal.ghl.locationId],
        },
      });
      deal.ghl.userId = r.id || r.user?.id || 'created';
    } catch (err) {
      if (/exist/i.test(err.message)) { deal.ghl.userId = 'existing'; return { status: 'done', detail: 'They already had a login' }; }
      throw err;
    }
    return { status: 'done', detail: `${deal.contact.email} (they click "Forgot password" to set theirs)` };
  },

  async ai(ctx) {
    const { deal, env, settings } = ctx;
    if (!deal.workflows.some((w) => w.id === 'ai_receptionist')) return { status: 'skipped', detail: 'Not purchased' };
    if (!env.RETELL_API_KEY) return { status: 'practice', detail: 'Connect Retell to build real AI receptionists' };
    const r = deal.retell;
    if (!r.llmId) {
      const llm = await retell(ctx, 'POST', '/create-retell-llm', {
        general_prompt: receptionistPrompt(deal, settings),
        begin_message: `Thanks for calling ${deal.business.name}! How can I help you today?`,
        general_tools: retellTools(deal),
        ...(env.RETELL_MODEL ? { model: env.RETELL_MODEL } : {}),
      });
      r.llmId = llm.llm_id;
    }
    if (!r.agentId) {
      const agent = await retell(ctx, 'POST', '/create-agent', {
        response_engine: { type: 'retell-llm', llm_id: r.llmId },
        voice_id: env.RETELL_VOICE_ID || 'retell-Cimo',
        agent_name: `${deal.business.name} Receptionist`.slice(0, 80),
      });
      r.agentId = agent.agent_id;
    }
    if (!r.phoneNumber) {
      const base = { inbound_agents: [{ agent_id: r.agentId, weight: 1 }], nickname: deal.business.name.slice(0, 60) };
      let num;
      try {
        num = await retell(ctx, 'POST', '/create-phone-number', deal.options.areaCode ? { ...base, area_code: Number(deal.options.areaCode) } : base);
      } catch (err) {
        if (!deal.options.areaCode) throw err;
        num = await retell(ctx, 'POST', '/create-phone-number', base); // that area code was sold out
      }
      r.phoneNumber = num.phone_number;
    }
    // Put the AI number into their GoHighLevel account too.
    if (deal.ghl.locationId) await upsertCustomValues(ctx, deal.ghl.locationId, { sb_ai_receptionist_number: r.phoneNumber }).catch(() => {});
    return { status: 'done', detail: `AI answers at ${r.phoneNumber}` };
  },

  async welcome(ctx) {
    const { deal, db, env, settings } = ctx;
    if (!deal.contact.email) return { status: 'skipped', detail: 'No email, so text them the setup link instead' };
    const enrolled = db.data.drips.some((d) => d.dealId === deal.id && d.sequence === 'customer');
    if (!enrolled) return { status: 'skipped', detail: 'They unsubscribed earlier. Text them the link instead' };
    const st = drip.readiness(db, settings, env);
    if (!st.ready) return { status: 'practice', detail: 'Queued. Sends once email is connected' };
    return { status: 'done', detail: `Sending to ${deal.contact.email}` };
  },

  async automation(ctx) {
    const { deal } = ctx;
    if (!ctx.webhookUrl) return { status: 'skipped', detail: 'Optional, not set up' };
    deal.webhook = await setup.sendWebhook({ url: ctx.webhookUrl, secret: ctx.env.WEBHOOK_SECRET, event: 'deal.created', deal, publicUrl: ctx.publicUrl, fetchImpl: ctx.fetchImpl });
    if (deal.webhook.status !== 'sent') throw new Error(`Webhook ${deal.webhook.error}`);
    return { status: 'done', detail: 'Sent' };
  },
};

const money = (n) => { const v = Number(n || 0); return `$${v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`; };

// Tick off the checklist items automation just finished.
function applyAutoTasks(deal) {
  const st = (k) => deal.provisioning.steps.find((s) => s.key === k)?.status;
  const ghlDone = st('settings') === 'done';
  const aiDone = st('ai') === 'done';
  for (const w of deal.workflows) {
    for (const t of w.tasks) {
      if (t.by === 'ghl' && ghlDone) t.done = true;
      if (t.by === 'retell' && aiDone) t.done = true;
      if (t.by === 'onboarding' && deal.onboarding) t.done = true;
    }
    if (w.tasks.every((t) => t.done)) w.status = 'live';
  }
}

async function run(ctx) {
  const { deal } = ctx;
  const prov = deal.provisioning;
  prov.status = 'running';
  prov.finishedAt = null;
  ctx.status = (k) => prov.steps.find((s) => s.key === k)?.status;
  for (const [key, label] of STEPS) {
    let step = prov.steps.find((s) => s.key === key);
    if (!step) { step = { key, label, status: 'pending', detail: '' }; prov.steps.push(step); }
    if (step.status === 'done') continue;
    step.status = 'working';
    ctx.save();
    try {
      Object.assign(step, await RUNNERS[key](ctx), { at: Date.now(), error: '' });
    } catch (err) {
      Object.assign(step, { status: 'failed', detail: err.message.slice(0, 300), error: err.message.slice(0, 300), at: Date.now() });
    }
    ctx.save();
  }
  applyAutoTasks(deal);
  const failed = prov.steps.filter((s) => s.status === 'failed');
  prov.status = failed.length ? 'needs_attention' : prov.steps.some((s) => s.status === 'practice') ? 'practice' : 'done';
  prov.finishedAt = Date.now();
  ctx.save();
  return prov;
}

// Client sent their setup form → push their answers everywhere.
async function syncOnboarding(ctx) {
  const { deal } = ctx;
  const results = [];
  if (deal.ghl.locationId && ctx.env.GHL_API_KEY) {
    try { await upsertCustomValues(ctx, deal.ghl.locationId, customValuesFor(deal, ctx.settings, ctx.publicUrl)); results.push('GoHighLevel updated'); } catch (err) { results.push(`GoHighLevel: ${err.message}`); }
  }
  if (deal.retell.llmId && ctx.env.RETELL_API_KEY) {
    try {
      await retell(ctx, 'PATCH', `/update-retell-llm/${deal.retell.llmId}`, { general_prompt: receptionistPrompt(deal, ctx.settings), general_tools: retellTools(deal) });
      results.push('AI receptionist updated with their hours, services and FAQs');
    } catch (err) { results.push(`Retell: ${err.message}`); }
  }
  applyAutoTasks(deal);
  deal.provisioning.onboardingSync = { at: Date.now(), results };
  ctx.save();
  return results;
}

function connected(env, settings = {}) {
  return {
    stripe: Boolean(env.STRIPE_SECRET_KEY),
    ghl: has(env, 'GHL_API_KEY', 'GHL_COMPANY_ID'),
    ghlSnapshot: Boolean(env.GHL_SNAPSHOT_ID || settings.ghlSnapshotId),
    retell: Boolean(env.RETELL_API_KEY),
  };
}

// Lets the manager pick their template from a list instead of hunting for an ID.
async function listSnapshots(ctx) {
  const r = await ghl(ctx, 'GET', `/snapshots/?companyId=${encodeURIComponent(ctx.env.GHL_COMPANY_ID)}`);
  return (r.snapshots || []).map((x) => ({ id: x.id, name: x.name, type: x.type }));
}

module.exports = { STEPS, run, syncOnboarding, applyAutoTasks, customValuesFor, receptionistPrompt, splitAddress, toE164, connected, listSnapshots };
