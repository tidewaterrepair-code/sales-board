'use strict';

// One-button setup. When a lead says YES, the rep hits one button and this
// module does everything else:
//   1. builds the deal (prices, commission, points)
//   2. creates a fulfillment checklist for every workflow sold
//   3. creates a Stripe checkout link (if STRIPE_SECRET_KEY is set)
//   4. creates a client onboarding link so the client fills in the details
//   5. fires a signed webhook (Zapier / Make / n8n / GoHighLevel) so your
//      automation platform can provision everything automatically

const crypto = require('node:crypto');
const { id } = require('./db');
const { dealPoints, round2 } = require('./game');
const { reviewLinkFor } = require('./leads');
const { AI_ADDON } = require('./workflows');

const DAY = 86400000;

// options (picked by the rep in the YES screen):
//   aiAddons:    workflow ids where the client added the AI upgrade
//   areaCode:    area code for any new phone number we buy for them
//   createLogin: give the owner their own login to the client app
//   paymentLink: send a Stripe payment link (otherwise billed another way)
function buildDeal({ lead, rep, workflows, contact, notes, commissionRate, options = {}, now = Date.now() }) {
  const aiAddons = new Set((options.aiAddons || []).filter((wid) => workflows.some((w) => w.id === wid && w.ai === 'optional')));
  const monthlyOf = (w) => w.monthlyFee + (aiAddons.has(w.id) ? AI_ADDON.monthly : 0);
  const setupTotal = workflows.reduce((s, w) => s + w.setupFee, 0);
  const monthlyTotal = workflows.reduce((s, w) => s + monthlyOf(w), 0);
  const digits = String(contact?.phone || lead.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const areaCode = /^\d{3}$/.test(String(options.areaCode || '')) ? String(options.areaCode) : digits.slice(0, 3);
  const speed = Boolean(lead.claimedAt && now - lead.claimedAt <= DAY);
  const points = dealPoints({ setupTotal, workflowCount: workflows.length, speed });
  return {
    id: id('deal'),
    leadId: lead.id,
    repId: rep.id,
    repName: rep.name,
    business: {
      name: lead.name,
      phone: lead.phone,
      address: lead.address,
      website: lead.website,
      city: lead.city,
      industry: lead.industry,
      placeId: lead.placeId,
      reviewLink: reviewLinkFor(lead),
      source: lead.source,
    },
    contact: {
      name: (contact?.name || '').trim(),
      email: (contact?.email || '').trim(),
      phone: (contact?.phone || lead.phone || '').trim(),
    },
    workflows: workflows.map((w) => ({
      id: w.id,
      name: w.name,
      emoji: w.emoji,
      setupFee: w.setupFee,
      monthlyFee: monthlyOf(w),
      aiAddon: aiAddons.has(w.id),
      status: 'queued',
      tasks: w.setupTasks.map((t) => ({ label: t.label, by: t.by, done: false })),
    })),
    billing: options.billing === 'yearly' ? 'yearly' : 'monthly',
    yearlyTotal: monthlyTotal * 10, // pay yearly = 2 months free
    options: {
      areaCode: /^\d{3}$/.test(areaCode) ? areaCode : '',
      createLogin: options.createLogin !== false,
      paymentLink: options.paymentLink !== false,
    },
    provisioning: { status: 'running', steps: [], startedAt: now, finishedAt: null },
    ghl: {},
    retell: {},
    setupTotal,
    monthlyTotal,
    commissionRate,
    commission: round2(setupTotal * commissionRate),
    commissionStatus: 'pending', // pending -> earned (client paid) -> paid_out
    points: points.total,
    pointsBreakdown: points,
    speedBonus: speed,
    status: 'awaiting_payment', // awaiting_payment -> paid -> live | cancelled
    paymentUrl: '',
    paymentError: '',
    onboardingToken: crypto.randomBytes(16).toString('hex'),
    onboarding: null,
    webhook: { status: 'not_configured', at: null, error: '' },
    notes: (notes || '').slice(0, 2000),
    createdAt: now,
    paidAt: null,
  };
}

async function createStripeCheckout({ deal, secretKey, publicUrl, policy, fetchImpl = fetch }) {
  const p = new URLSearchParams();
  const recurring = deal.monthlyTotal > 0;
  p.set('mode', recurring ? 'subscription' : 'payment');
  p.set('client_reference_id', deal.id);
  p.set('metadata[deal_id]', deal.id);
  if (recurring) p.set('subscription_data[metadata][deal_id]', deal.id);
  if (deal.contact.email) p.set('customer_email', deal.contact.email);
  const onboard = `${publicUrl}/onboard/${deal.onboardingToken}`;
  p.set('success_url', `${onboard}?paid=1`);
  // Shown right above the Pay button so auto-renew and the policy are clear before they buy.
  const terms = [];
  if (recurring) {
    const yearly = deal.billing === 'yearly';
    const plan = yearly ? deal.yearlyTotal : deal.monthlyTotal;
    terms.push(`Auto-pay: your card is charged $${plan.toLocaleString('en-US')} every ${yearly ? 'year' : 'month'} automatically, so you never have to pay by hand. Cancel anytime from your billing link; cancelling stops the next charge.`);
  }
  if (policy) terms.push(policy);
  if (terms.length) p.set('custom_text[submit][message]', terms.join(' ').slice(0, 1000));
  p.set('cancel_url', onboard);
  let i = 0;
  const names = deal.workflows.map((w) => w.name).join(', ');
  p.set(`line_items[${i}][quantity]`, '1');
  p.set(`line_items[${i}][price_data][currency]`, 'usd');
  p.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(deal.setupTotal * 100)));
  p.set(`line_items[${i}][price_data][product_data][name]`, `One-time setup: ${names}`.slice(0, 250));
  if (recurring) {
    i++;
    p.set(`line_items[${i}][quantity]`, '1');
    p.set(`line_items[${i}][price_data][currency]`, 'usd');
    const yearly = deal.billing === 'yearly';
    p.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round((yearly ? deal.yearlyTotal : deal.monthlyTotal) * 100)));
    p.set(`line_items[${i}][price_data][recurring][interval]`, yearly ? 'year' : 'month');
    p.set(`line_items[${i}][price_data][product_data][name]`, `${yearly ? 'Yearly service (2 months free)' : 'Monthly service'}: ${names}`.slice(0, 250));
  }
  const res = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: p.toString(),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Stripe error ${res.status}`);
  return json.url;
}

function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const sigs = header.split(',').filter((kv) => kv.startsWith('v1=')).map((kv) => kv.slice(3));
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

function signPayload(body, secret) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function sendWebhook({ url, secret, event, deal, publicUrl, fetchImpl = fetch }) {
  if (!url) return { status: 'not_configured', at: null, error: '' };
  const body = JSON.stringify({
    event,
    sentAt: new Date().toISOString(),
    onboardingUrl: `${publicUrl}/onboard/${deal.onboardingToken}`,
    deal: publicDeal(deal),
  });
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'SalesBoard/1.0' };
  if (secret) headers['X-SalesBoard-Signature'] = signPayload(body, secret);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { status: 'failed', at: Date.now(), error: `HTTP ${res.status}` };
    return { status: 'sent', at: Date.now(), error: '' };
  } catch (err) {
    return { status: 'failed', at: Date.now(), error: err.message };
  }
}

// What leaves the building: everything except internal tokens.
function publicDeal(deal) {
  const { onboardingToken, ...rest } = deal;
  return rest;
}

module.exports = { buildDeal, createStripeCheckout, verifyStripeSignature, sendWebhook, signPayload, publicDeal };
