'use strict';

// Paying reps their commission.
//
// ⚡ Instant (automatic): each rep links a debit card (a Cash App Card works if
//    Stripe accepts it) through Stripe Connect Express. When the client's
//    payment is in your Stripe balance, we transfer the commission to the rep
//    and trigger an Instant Payout to their card, usually within minutes.
// 💚 Cash App (one tap): reps save their $cashtag; the manager taps a button
//    that opens Cash App with the amount filled in, then marks it paid.
//
// Cash App has no public API for sending money to a $cashtag, which is why
// the automatic route goes through Stripe.

const STRIPE = 'https://api.stripe.com/v1';

// Stripe wants form-encoded bodies with bracketed keys: a[b][c]=v
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}

async function stripe(ctx, method, path, params, { account, idem } = {}) {
  const headers = { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}` };
  if (account) headers['Stripe-Account'] = account;
  if (idem) headers['Idempotency-Key'] = idem;
  let url = `${STRIPE}${path}`;
  let body;
  if (method === 'GET') { if (params) url += `?${form(params)}`; } else { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = form(params || {}).toString(); }
  const res = await ctx.fetchImpl(url, { method, headers, body, signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || `Stripe error ${res.status}`);
    err.code = json.error?.code;
    err.status = res.status;
    throw err;
  }
  return json;
}

const cents = (n) => Math.round(Number(n) * 100);

async function createRepAccount(ctx, user) {
  const acct = await stripe(ctx, 'POST', '/accounts', {
    type: 'express',
    country: 'US',
    business_type: 'individual',
    capabilities: { transfers: { requested: true } },
    settings: { payouts: { schedule: { interval: 'manual' } } }, // we trigger payouts ourselves
    metadata: { salesboard_rep_id: user.id, name: user.name },
  }, { idem: `sb-acct-${user.id}` });
  return acct.id;
}

async function onboardingLink(ctx, accountId) {
  const back = `${ctx.publicUrl}/#/money`;
  const link = await stripe(ctx, 'POST', '/account_links', { account: accountId, refresh_url: `${back}?payout=retry`, return_url: `${back}?payout=done`, type: 'account_onboarding' });
  return link.url;
}

async function accountStatus(ctx, accountId) {
  const a = await stripe(ctx, 'GET', `/accounts/${accountId}`);
  return { payoutsEnabled: Boolean(a.payouts_enabled), detailsSubmitted: Boolean(a.details_submitted), transfers: a.capabilities?.transfers === 'active' };
}

async function dashboardLink(ctx, accountId) {
  return (await stripe(ctx, 'POST', `/accounts/${accountId}/login_links`, {})).url;
}

// Sends one deal's commission to the rep. Safe to call repeatedly: Stripe
// idempotency keys stop the same deal from ever being paid twice.
async function payCommission(ctx, deal, rep) {
  const amount = cents(deal.commission);
  if (amount <= 0) return { status: 'skipped', detail: 'No commission on this deal' };
  const p = deal.commissionPayout || {};
  if (!p.transferId) {
    try {
      const t = await stripe(ctx, 'POST', '/transfers', {
        amount, currency: 'usd', destination: rep.stripeAccountId, transfer_group: deal.id,
        description: `Commission: ${deal.business.name}`, metadata: { deal_id: deal.id, rep_id: rep.id },
      }, { idem: `sb-transfer-${deal.id}` });
      p.transferId = t.id;
    } catch (err) {
      if (err.code === 'balance_insufficient') {
        return { status: 'waiting', detail: 'Waiting for the client payment to clear in Stripe (usually about 2 business days). It sends automatically.' };
      }
      throw err;
    }
  }
  deal.commissionPayout = p;
  // Push it to the rep's card right away if Stripe allows an instant payout.
  let instant = false;
  try {
    const bal = await stripe(ctx, 'GET', '/balance', null, { account: rep.stripeAccountId });
    const instantAvail = (bal.instant_available || []).find((b) => b.currency === 'usd')?.amount || 0;
    const payAmount = Math.min(amount, instantAvail);
    if (payAmount > 0) {
      const po = await stripe(ctx, 'POST', '/payouts', { amount: payAmount, currency: 'usd', method: 'instant', description: 'SalesBoard commission' }, { account: rep.stripeAccountId, idem: `sb-instant-${deal.id}` });
      p.payoutId = po.id;
      instant = true;
    }
  } catch { /* card not eligible for instant: fall back to standard below */ }
  if (!instant) {
    try {
      const po = await stripe(ctx, 'POST', '/payouts', { amount, currency: 'usd', method: 'standard', description: 'SalesBoard commission' }, { account: rep.stripeAccountId, idem: `sb-standard-${deal.id}` });
      p.payoutId = po.id;
    } catch {
      // Money is safely in the rep's Stripe balance; Stripe will pay it out on its schedule.
    }
  }
  return { status: 'sent', instant, detail: instant ? '⚡ Sent instantly to their card' : 'Sent to their bank (1–2 business days)' };
}

function cashAppLink(cashtag, amount) {
  return `https://cash.app/${encodeURIComponent(cashtag)}/${Number(amount).toFixed(2)}`;
}

function normalizeCashtag(v) {
  const t = String(v || '').trim().replace(/^\$/, '');
  if (!t) return '';
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,19}$/.test(t)) return null;
  return `$${t}`;
}

module.exports = { createRepAccount, onboardingLink, accountStatus, dashboardLink, payCommission, cashAppLink, normalizeCashtag, form };
