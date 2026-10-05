'use strict';

// Auto-pay for clients. Stripe charges the card on file every month (or year)
// on its own; this file keeps our copy of each client's billing in sync from
// Stripe's webhooks, and opens Stripe's billing page where clients update
// their card or cancel. Cancelling stops the NEXT charge (no refunds), so the
// client keeps service until the end of the period they already paid for.

const STRIPE = 'https://api.stripe.com/v1';

async function stripe(ctx, method, path, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await ctx.fetchImpl(`${STRIPE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ctx.env.STRIPE_SECRET_KEY}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.error?.message || `Stripe error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// The client billing page: update card, see invoices, cancel at period end.
// We create the settings once through the API so there's nothing to click
// in Stripe. If Stripe refuses, the dashboard's default portal is used.
async function portalConfig(ctx, db) {
  const sys = db.data.system;
  if (sys.stripePortalConfig) return sys.stripePortalConfig;
  try {
    const cfg = await stripe(ctx, 'POST', '/billing_portal/configurations', {
      'business_profile[headline]': `${ctx.companyName || 'Your'} billing: update your card or cancel anytime`.slice(0, 60),
      'features[payment_method_update][enabled]': 'true',
      'features[invoice_history][enabled]': 'true',
      'features[customer_update][enabled]': 'true',
      'features[customer_update][allowed_updates][0]': 'email',
      'features[customer_update][allowed_updates][1]': 'address',
      'features[subscription_cancel][enabled]': 'true',
      'features[subscription_cancel][mode]': 'at_period_end',
      'features[subscription_cancel][proration_behavior]': 'none',
      'features[subscription_cancel][cancellation_reason][enabled]': 'true',
      'features[subscription_cancel][cancellation_reason][options][0]': 'too_expensive',
      'features[subscription_cancel][cancellation_reason][options][1]': 'unused',
      'features[subscription_cancel][cancellation_reason][options][2]': 'switched_service',
      'features[subscription_cancel][cancellation_reason][options][3]': 'other',
    });
    sys.stripePortalConfig = cfg.id;
    db.save();
    return cfg.id;
  } catch (err) {
    console.error('[billing] portal settings:', err.message);
    return null;
  }
}

async function portalLink(ctx, db, deal) {
  const customer = deal.stripe?.customerId;
  if (!customer) throw new Error('No card on file yet. Pay the first invoice and this link will work.');
  const config = await portalConfig(ctx, db);
  const params = { customer, return_url: `${ctx.publicUrl}/onboard/${deal.onboardingToken}` };
  if (config) params.configuration = config;
  try {
    return (await stripe(ctx, 'POST', '/billing_portal/sessions', params)).url;
  } catch (err) {
    // A deleted or test-mode config: forget it and use the default once.
    if (config && /configuration/i.test(err.message)) {
      db.data.system.stripePortalConfig = null;
      delete params.configuration;
      return (await stripe(ctx, 'POST', '/billing_portal/sessions', params)).url;
    }
    if (/configuration|portal/i.test(err.message)) throw new Error('Stripe billing page is not turned on yet. In Stripe: Settings → Billing → Customer portal → Save.');
    throw err;
  }
}

// Manager cancels for the client. Same rule as the client: no refund, it
// stops the next charge. `now` ends it today instead (still no refund).
async function cancel(ctx, deal, { immediately = false } = {}) {
  const sub = deal.stripe?.subscriptionId;
  if (!sub) throw new Error('This client has no auto-pay plan in Stripe.');
  const out = immediately
    ? await stripe(ctx, 'DELETE', `/subscriptions/${sub}`, { prorate: 'false', invoice_now: 'false' })
    : await stripe(ctx, 'POST', `/subscriptions/${sub}`, { cancel_at_period_end: 'true', proration_behavior: 'none' });
  applySubscription(deal, out);
  return deal.subscription;
}

async function resume(ctx, deal) {
  const sub = deal.stripe?.subscriptionId;
  if (!sub) throw new Error('This client has no auto-pay plan in Stripe.');
  applySubscription(deal, await stripe(ctx, 'POST', `/subscriptions/${sub}`, { cancel_at_period_end: 'false' }));
  return deal.subscription;
}

// ---- Webhook → deal ----
// Field locations moved between Stripe API versions, so read both.
const subIdOfInvoice = (inv) => (typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id)
  || inv.parent?.subscription_details?.subscription
  || inv.lines?.data?.find((l) => l.subscription)?.subscription
  || inv.lines?.data?.find((l) => l.parent?.subscription_item_details?.subscription)?.parent.subscription_item_details.subscription
  || null;
const dealIdOfInvoice = (inv) => inv.subscription_details?.metadata?.deal_id || inv.parent?.subscription_details?.metadata?.deal_id || inv.metadata?.deal_id || null;
const periodEnd = (sub) => sub.current_period_end || sub.items?.data?.[0]?.current_period_end || null;
const ms = (sec) => (sec ? sec * 1000 : null);

function findDeal(db, { dealId, subscriptionId, customerId }) {
  return (dealId && db.deals.find((d) => d.id === dealId))
    || (subscriptionId && db.deals.find((d) => d.stripe?.subscriptionId === subscriptionId))
    || (customerId && db.deals.find((d) => d.stripe?.customerId === customerId))
    || null;
}

function base(deal) {
  deal.subscription = deal.subscription || { status: 'active', interval: deal.billing === 'yearly' ? 'year' : 'month', amount: deal.billing === 'yearly' ? deal.yearlyTotal : deal.monthlyTotal, payments: 0, collected: 0, failures: 0 };
  return deal.subscription;
}

function applyCheckout(deal, session) {
  deal.stripe = { ...(deal.stripe || {}), customerId: session.customer || deal.stripe?.customerId || null, subscriptionId: session.subscription || deal.stripe?.subscriptionId || null };
  if (session.subscription) base(deal);
}

function applySubscription(deal, sub) {
  const s = base(deal);
  deal.stripe = { ...(deal.stripe || {}), subscriptionId: sub.id, customerId: sub.customer || deal.stripe?.customerId || null };
  const prev = s.status;
  s.status = sub.status === 'canceled' ? 'canceled' : sub.status;
  s.cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end || (sub.cancel_at && sub.status !== 'canceled'));
  s.renewsAt = ms(periodEnd(sub));
  s.cancelAt = s.cancelAtPeriodEnd ? ms(sub.cancel_at || periodEnd(sub)) : null;
  if (sub.status === 'canceled') s.endedAt = ms(sub.ended_at || sub.canceled_at) || Date.now();
  if (sub.cancellation_details?.feedback) s.reason = sub.cancellation_details.feedback;
  return prev;
}

function applyInvoicePaid(deal, inv, now) {
  const s = base(deal);
  const amount = (inv.amount_paid || 0) / 100;
  if (!amount) return { recovered: false };
  if ((s.invoices || []).includes(inv.id)) return { recovered: false, duplicate: true };
  s.invoices = [...(s.invoices || []), inv.id].slice(-36);
  // The first invoice includes the one-time setup fee; count only the plan.
  const periodEndSec = Math.max(0, ...(inv.lines?.data || []).map((l) => l.period?.end || 0));
  const planAmount = inv.billing_reason === 'subscription_create' ? Math.min(amount, s.amount || amount) : amount;
  const recovered = s.status === 'past_due' || s.status === 'unpaid';
  s.payments += 1;
  s.collected = Math.round((s.collected + planAmount) * 100) / 100;
  s.lastPaidAt = now;
  s.lastAmount = amount;
  if (periodEndSec) s.renewsAt = ms(periodEndSec);
  if (s.status !== 'canceled') s.status = 'active';
  s.failures = 0;
  s.nextRetryAt = null;
  return { recovered };
}

function applyInvoiceFailed(deal, inv, now) {
  const s = base(deal);
  if (s.status !== 'canceled') s.status = 'past_due';
  s.failures = Math.max(s.failures || 0, inv.attempt_count || 1);
  s.lastFailedAt = now;
  s.nextRetryAt = ms(inv.next_payment_attempt);
  s.lastError = inv.last_finalization_error?.message || inv.last_payment_error?.message || '';
  return { firstFailure: s.failures <= 1 };
}

// Monthly revenue that will actually come in (yearly counted per month).
function mrrOf(deal) {
  if (deal.status === 'cancelled' || !deal.monthlyTotal) return 0;
  const s = deal.subscription;
  if (s && (s.status === 'canceled' || s.status === 'unpaid' || s.status === 'incomplete_expired')) return 0;
  return deal.billing === 'yearly' ? Math.round((deal.yearlyTotal / 12) * 100) / 100 : deal.monthlyTotal;
}

module.exports = {
  portalConfig, portalLink, cancel, resume,
  subIdOfInvoice, dealIdOfInvoice, findDeal,
  applyCheckout, applySubscription, applyInvoicePaid, applyInvoiceFailed, mrrOf,
};
