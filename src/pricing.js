'use strict';

// Profit math. The rep's commission is paid ONCE, as a percentage of the
// setup fee only. Monthly fees carry no commission.

const STRIPE_PCT = 0.029;
const STRIPE_FIXED = 0.30;

const stripeFee = (amount) => (amount > 0 ? amount * STRIPE_PCT + STRIPE_FIXED : 0);
const r2 = (n) => Math.round(n * 100) / 100;

function profitFor(w, commissionRate) {
  const commission = w.setupFee * commissionRate;
  const setupProfit = w.setupFee - commission - w.cost.setup - stripeFee(w.setupFee);
  const monthlyProfit = w.monthlyFee - w.cost.monthly - stripeFee(w.monthlyFee);
  const problems = [];
  if (setupProfit <= 0) problems.push(`setup fee of $${w.setupFee} doesn't cover the commission ($${r2(commission)}), setup cost ($${w.cost.setup}) and card fees`);
  if (w.monthlyFee > 0 && monthlyProfit <= 0) problems.push(`monthly fee of $${w.monthlyFee} doesn't cover tool costs ($${w.cost.monthly}/mo) and card fees`);
  return {
    commission: r2(commission),
    setupProfit: r2(setupProfit),
    monthlyProfit: r2(monthlyProfit),
    monthlyMargin: w.monthlyFee > 0 ? Math.round((monthlyProfit / w.monthlyFee) * 100) : 0,
    firstYearProfit: r2(setupProfit + monthlyProfit * 12),
    belowMarket: w.market ? { setup: w.market.setup - w.setupFee, monthly: w.market.monthly - w.monthlyFee } : null,
    ok: problems.length === 0,
    problems,
  };
}

module.exports = { profitFor, stripeFee };
