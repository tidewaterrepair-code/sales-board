'use strict';

// Email drip. Any lead who gives us an email gets a short, personal
// follow-up sequence:
//   prospect: 5 emails over ~2 weeks until they buy (or unsubscribe)
//   customer: welcome + setup-form reminders until onboarding is done
//
// Sends through Brevo (free: 300/day) or Resend (free: 100/day, 3,000/mo).
// With no provider configured, emails wait in the queue until one is added.

const crypto = require('node:crypto');
const { id } = require('./db');
const { getIndustry } = require('./industries');
const { getWorkflow } = require('./workflows');

const HOUR = 3600000;
const MAX_FAILS = 3;

// delayHours = wait after the previous email before sending this one.
const SEQUENCES = {
  prospect: [
    {
      delayHours: 0,
      subject: '{{business}} + {{wfName}}: the info you asked for',
      body: `Hi {{name}},

Thanks for taking a minute to chat today. As promised, here's the quick version.

{{wfEmoji}} {{wfName}}
{{wfPromise}}

How it works:
{{wfBullets}}

Price: {{setup}} one-time setup + {{monthly}}/month. Most agencies charge around {{marketSetup}} + {{marketMonthly}}/month for the same thing. No long-term contract.

Want it turned on? Just reply "yes" and we'll take care of everything. Setup takes about a day on our end.

{{rep}}
{{company}}`,
    },
    {
      delayHours: 48,
      subject: 'The math for {{business}}',
      body: `Hi {{name}},

Quick follow-up on {{wfName}}.

The problem it fixes: {{wfPain}}

{{wfProof}}

Here's the simple math: if it brings in just one extra job a month, it pays for itself. Everything after that is profit for {{business}}.

Want me to get it started? Reply "yes" and you'll be live this week.

{{rep}}`,
    },
    {
      delayHours: 72,
      subject: 'Quick answers, {{name}}',
      body: `Hi {{name}},

Here are the questions {{trade}} owners usually ask us:

{{wfFaq}}

Is there a contract?
No. It's month to month. We keep you because it works.

Anything else you'd like to know? Just hit reply.

{{rep}}`,
    },
    {
      delayHours: 96,
      subject: 'What other {{trade}} businesses are adding',
      body: `Hi {{name}},

Besides {{wfName}}, here's what other {{trade}} businesses near {{city}} are pairing it with:

{{extras}}

Bundle two or more and we set them all up together. Reply with the ones you like and I'll put together a quote for {{business}}.

{{rep}}`,
    },
    {
      delayHours: 120,
      subject: 'Should I close your file?',
      body: `Hi {{name}},

I haven't heard back, so I'll assume the timing isn't right, and that's totally fine.

If you'd like to pick this back up, just reply to this email and we'll get {{business}} set up the same day.

Wishing you a great season!

{{rep}}
{{company}}`,
    },
  ],
  customer: [
    {
      delayHours: 0,
      subject: 'Welcome aboard, {{name}}! One quick step for {{business}}',
      body: `Hi {{name}},

Welcome to {{company}}! We're excited to get {{business}} set up with:
{{dealItems}}

One quick step (about 3 minutes): fill in your setup form so we can finish everything for you.
{{onboardingUrl}}
{{payLine}}{{billingLine}}{{loginLine}}
Questions? Just reply to this email.

{{rep}}
{{company}}`,
    },
    {
      delayHours: 24,
      onlyIfPending: true,
      subject: 'Reminder: your setup form for {{business}}',
      body: `Hi {{name}},

Just a friendly nudge: we're ready to build your workflows as soon as your setup form is in. It takes about 3 minutes.
{{onboardingUrl}}
{{payLine}}{{billingLine}}
{{rep}}`,
    },
    {
      delayHours: 48,
      onlyIfPending: true,
      subject: 'Still want us to set up {{business}}?',
      body: `Hi {{name}},

We still haven't received your setup form, so nothing is live yet. Here's the link one more time:
{{onboardingUrl}}
{{payLine}}{{billingLine}}
If you've hit a snag, just reply and we'll help.

{{rep}}`,
    },
  ],
};

const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim());
const norm = (e) => String(e || '').trim().toLowerCase();
const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);

function provider(env) {
  if (env.BREVO_API_KEY) return { name: 'brevo', defaultCap: 280 };
  if (env.RESEND_API_KEY) return { name: 'resend', defaultCap: 95 };
  return null;
}

function readiness(db, settings, env) {
  const p = provider(env);
  const missing = [];
  if (!p) missing.push('an email provider key (BREVO_API_KEY or RESEND_API_KEY)');
  if (!settings.fromEmail) missing.push('a sender email (Manager → Email Drip)');
  if (!settings.businessAddress) missing.push('your business mailing address (required by anti-spam law)');
  const cap = Number(settings.emailDailyCap) || p?.defaultCap || 0;
  return { provider: p?.name || null, ready: missing.length === 0, missing, cap, sentToday: db.data.usage?.email?.[dayKey(Date.now())] || 0 };
}

function isSuppressed(db, email) {
  return db.data.suppressed.includes(norm(email));
}

// Adds (or refreshes) a drip enrollment. Returns the enrollment or a reason.
function enroll(db, { email, name, lead, deal, sequence, by, now = Date.now() }) {
  if (!validEmail(email)) return { error: 'That email doesn\'t look right.' };
  const e = norm(email);
  if (isSuppressed(db, e)) return { suppressed: true };
  if (sequence === 'customer') {
    for (const d of db.data.drips) {
      if (d.status === 'active' && d.sequence === 'prospect' && (d.email === e || (lead && d.leadId === lead.id))) {
        d.status = 'completed';
        d.endedReason = 'Became a customer 🎉';
      }
    }
  }
  const existing = db.data.drips.find((d) => d.email === e && d.sequence === sequence && (d.status === 'active' || (deal && d.dealId === deal.id)));
  if (existing) {
    existing.name = name || existing.name;
    if (deal) existing.dealId = deal.id;
    return { enrollment: existing, existing: true };
  }
  // Never restart a finished prospect sequence for the same lead.
  if (sequence === 'prospect' && db.data.drips.some((d) => d.email === e && d.sequence === 'prospect' && d.leadId === lead?.id)) {
    return { alreadyDone: true };
  }
  const enrollment = {
    id: id('drip'),
    email: e,
    name: String(name || '').trim().slice(0, 80),
    leadId: lead?.id || null,
    dealId: deal?.id || null,
    sequence,
    step: 0,
    nextAt: now,
    status: 'active',
    token: crypto.randomBytes(16).toString('hex'),
    enrolledBy: by || null,
    fails: 0,
    sent: [],
    createdAt: now,
  };
  db.data.drips.push(enrollment);
  return { enrollment };
}

function stopFor(db, predicate, reason) {
  let n = 0;
  for (const d of db.data.drips) if (d.status === 'active' && predicate(d)) { d.status = 'stopped'; d.endedReason = reason; n++; }
  return n;
}

function unsubscribe(db, token) {
  const d = db.data.drips.find((x) => x.token === token);
  if (!d) return null;
  if (!db.data.suppressed.includes(d.email)) db.data.suppressed.push(d.email);
  for (const x of db.data.drips) if (x.email === d.email && x.status === 'active') { x.status = 'unsubscribed'; x.endedReason = 'Unsubscribed'; }
  d.status = 'unsubscribed';
  return d;
}

const money = (n) => `$${Number(n || 0).toLocaleString('en-US')}`;

function buildContext(db, d, { settings, catalog, publicUrl, hydrate }) {
  const found = db.leads.find((l) => l.id === d.leadId);
  const lead = (found && hydrate ? hydrate(found) : found) || {};
  const deal = db.deals.find((x) => x.id === d.dealId) || null;
  const rep = db.users.find((u) => u.id === (deal?.repId || lead.repId || d.enrolledBy));
  const ind = getIndustry(lead.industry);
  const cat = (wid) => catalog.find((w) => w.id === wid) || getWorkflow(wid);
  const recIds = (lead.analysis?.recommended || []).filter(cat);
  const primary = cat(lead.pitchedWorkflow) || cat(recIds[0]) || catalog[0];
  const extras = (recIds.length ? recIds : catalog.map((w) => w.id)).filter((x) => x !== primary.id).slice(0, 2).map(cat);
  return {
    name: (d.name || '').split(' ')[0] || 'there',
    business: lead.name || deal?.business.name || 'your business',
    city: (lead.city || '').split(',')[0] || 'you',
    trade: ind.trade,
    customer: ind.customer,
    rep: rep?.name || settings.fromName || settings.companyName,
    company: settings.companyName,
    wfName: primary.name,
    wfEmoji: primary.emoji,
    wfPromise: primary.promise,
    wfPain: primary.pain,
    wfProof: primary.proof,
    wfBullets: primary.bullets.map((b) => `• ${b}`).join('\n'),
    wfFaq: primary.objections.map((o) => `${o.q}\n${o.a.replace(/\{\{customer\}\}/g, ind.customer)}`).join('\n\n'),
    extras: extras.map((w) => `${w.emoji} ${w.name}: ${w.tagline}`).join('\n'),
    setup: money(primary.setupFee),
    monthly: money(primary.monthlyFee),
    marketSetup: money(primary.market?.setup),
    marketMonthly: money(primary.market?.monthly),
    dealItems: deal ? deal.workflows.map((w) => `• ${w.emoji} ${w.name}`).join('\n') : '',
    onboardingUrl: deal ? `${publicUrl}/onboard/${deal.onboardingToken}` : '',
    payLine: deal && deal.paymentUrl && !deal.paidAt ? `\nSecure your spot by paying the setup fee here:\n${deal.paymentUrl}\n${deal.monthlyTotal ? `After that, your plan is paid automatically every ${deal.billing === 'yearly' ? 'year' : 'month'} with the same card, so there's nothing to remember. Cancel anytime.\n` : ''}` : '',
    billingLine: deal && deal.stripe?.customerId ? `\nManage your auto-pay (update card, receipts, or cancel): ${publicUrl}/billing/${deal.onboardingToken}\n` : '',
    loginLine: deal && deal.ghl?.userId && settings.clientLoginUrl ? `\nYour account (see your leads, texts and reviews): ${settings.clientLoginUrl}\nFirst time? Click "Forgot password" and use this email to set your password.\n` : '',
    _deal: deal,
  };
}

const fillText = (tpl, ctx) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (ctx[k] != null ? String(ctx[k]) : ''));
const escHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render(step, ctx, { settings, unsubscribeUrl }) {
  const subject = fillText(step.subject, ctx);
  const text = fillText(step.body, ctx).replace(/\n{3,}/g, '\n\n').trim();
  const footer = `${settings.companyName} · ${settings.businessAddress}\nDon't want these emails? Unsubscribe: ${unsubscribeUrl}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1d2340;max-width:560px">${
    text.split(/\n{2,}/).map((p) => `<p>${escHtml(p).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`).join('')
  }<hr style="border:0;border-top:1px solid #e1e5f0;margin:24px 0"><p style="font-size:12px;color:#6b7290">${escHtml(settings.companyName)} · ${escHtml(settings.businessAddress)}<br><a href="${escHtml(unsubscribeUrl)}" style="color:#6b7290">Unsubscribe</a></p></div>`;
  return { subject, text: `${text}\n\n--\n${footer}`, html };
}

async function sendEmail({ env, settings, to, toName, subject, html, text, unsubscribeUrl, oneClickUrl, fetchImpl }) {
  const p = provider(env);
  if (!p) throw new Error('No email provider configured');
  const headers = { 'List-Unsubscribe': `<${oneClickUrl || unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  const replyTo = settings.replyTo || settings.fromEmail;
  let res;
  if (p.name === 'brevo') {
    res = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: settings.fromName || settings.companyName, email: settings.fromEmail }, to: [{ email: to, ...(toName ? { name: toName } : {}) }], replyTo: { email: replyTo }, subject, htmlContent: html, textContent: text, headers }),
      signal: AbortSignal.timeout(10000),
    });
  } else {
    res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${settings.fromName || settings.companyName} <${settings.fromEmail}>`, to: [to], reply_to: replyTo, subject, html, text, headers }),
      signal: AbortSignal.timeout(10000),
    });
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.message || j.error?.message || `${p.name} error ${res.status}`);
  }
}

// Sends every email that's due, within today's cap. Safe to call often.
async function tick(db, { settings, env, catalog, publicUrl, hydrate, fetchImpl = fetch, now = Date.now() }) {
  const status = readiness(db, settings, env);
  if (!status.ready) return { sent: 0, reason: status.missing.join(', ') };
  db.data.usage.email = db.data.usage.email || {};
  const today = dayKey(now);
  let sent = 0;
  const due = db.data.drips.filter((d) => d.status === 'active' && d.nextAt <= now).sort((a, b) => a.nextAt - b.nextAt);
  for (const d of due) {
    if ((db.data.usage.email[today] || 0) >= status.cap) break;
    if (isSuppressed(db, d.email)) { d.status = 'unsubscribed'; continue; }
    const seq = SEQUENCES[d.sequence];
    const step = seq[d.step];
    if (!step) { d.status = 'completed'; continue; }
    const ctx = buildContext(db, d, { settings, catalog, publicUrl, hydrate });
    const deal = ctx._deal;
    if (d.sequence === 'customer') {
      if (!deal || deal.status === 'cancelled') { d.status = 'stopped'; d.endedReason = 'Deal cancelled'; continue; }
      const pending = !deal.onboarding || (deal.paymentUrl && !deal.paidAt);
      if (step.onlyIfPending && !pending) { d.status = 'completed'; d.endedReason = 'Client finished setup ✅'; continue; }
    }
    const unsubscribeUrl = `${publicUrl}/unsubscribe/${d.token}`;
    const email = render(step, ctx, { settings, unsubscribeUrl });
    try {
      await sendEmail({ env, settings, to: d.email, toName: d.name, ...email, unsubscribeUrl, oneClickUrl: `${publicUrl}/api/unsubscribe/${d.token}`, fetchImpl });
      db.data.usage.email[today] = (db.data.usage.email[today] || 0) + 1;
      d.sent.push({ step: d.step, at: now, subject: email.subject });
      d.fails = 0;
      d.step++;
      sent++;
      if (d.step >= seq.length) { d.status = 'completed'; d.endedReason = 'Sequence finished'; } else d.nextAt = now + seq[d.step].delayHours * HOUR;
    } catch (err) {
      d.fails = (d.fails || 0) + 1;
      d.lastError = err.message;
      if (d.fails >= MAX_FAILS) { d.status = 'failed'; d.endedReason = err.message; } else d.nextAt = now + HOUR;
    }
  }
  db.save();
  return { sent };
}

function summaryFor(db, leadId) {
  const d = db.data.drips.filter((x) => x.leadId === leadId).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!d) return null;
  return { id: d.id, email: d.email, sequence: d.sequence, status: d.status, step: d.step, total: SEQUENCES[d.sequence].length, nextAt: d.status === 'active' ? d.nextAt : null, endedReason: d.endedReason || '' };
}

module.exports = { SEQUENCES, enroll, tick, unsubscribe, stopFor, readiness, summaryFor, sendEmail, render, buildContext, validEmail, isSuppressed };
