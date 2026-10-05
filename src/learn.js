'use strict';

// Self-learning lead scoring. Looks at every lead your team has actually
// called and learns:
//   - which lead signals (no website, few reviews, …) close more or less often
//   - which business types close more or less often
//   - which workflows sell best to each business type
// Those lessons adjust lead scores and the "pitch this" recommendations. It
// only kicks in once there's enough data, so early luck can't skew it.

const { getIndustry } = require('./industries');
const { getWorkflow } = require('./workflows');

const MIN_LEADS = 20; // called leads needed before a signal/industry gets a bonus
const MIN_DEALS = 5; // deals in an industry before workflow picks are learned
const SIGNAL_NAMES = { no_website: 'No website', few_reviews: 'Few reviews', low_rating: 'Low rating', no_rating: 'No rating', busy: 'Busy & loved', no_phone: 'No phone' };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function computeModel(db) {
  const deals = db.deals.filter((d) => d.status !== 'cancelled');
  const won = new Set(deals.map((d) => d.leadId));
  const called = db.leads.filter((l) => l.status !== 'new');
  const totalWon = called.filter((l) => won.has(l.id)).length;
  const baseline = called.length ? totalWon / called.length : 0;
  const model = { updatedAt: Date.now(), calledLeads: called.length, deals: deals.length, baseline, signalBonus: {}, industryBonus: {}, workflowBoost: {}, notes: [] };
  if (!baseline) return model;

  const tally = (keyFn) => {
    const t = {};
    for (const l of called) for (const k of keyFn(l)) { (t[k] ||= { n: 0, w: 0 }).n++; if (won.has(l.id)) t[k].w++; }
    return t;
  };
  const bonusFrom = (rate) => clamp(Math.round((rate / baseline - 1) * 10), -10, 15);

  for (const [key, { n, w }] of Object.entries(tally((l) => (l.analysis?.signals || []).map((s) => s.key)))) {
    if (n < MIN_LEADS) continue;
    const pts = bonusFrom(w / n);
    if (!pts) continue;
    model.signalBonus[key] = pts;
    model.notes.push({ pts, text: `"${SIGNAL_NAMES[key] || key}" leads close ${(w / n / baseline).toFixed(1)}× as often as average (${n} called)` });
  }
  for (const [key, { n, w }] of Object.entries(tally((l) => [l.industry]))) {
    if (n < MIN_LEADS) continue;
    const pts = bonusFrom(w / n);
    if (!pts) continue;
    model.industryBonus[key] = pts;
    model.notes.push({ pts, text: `${getIndustry(key).label} close ${(w / n / baseline).toFixed(1)}× as often as average (${n} called)` });
  }
  // What each kind of business actually buys.
  const byIndustry = {};
  for (const d of deals) (byIndustry[d.business.industry] ||= []).push(d);
  for (const [ind, list] of Object.entries(byIndustry)) {
    if (list.length < MIN_DEALS) continue;
    const counts = {};
    for (const d of list) for (const w of d.workflows) counts[w.id] = (counts[w.id] || 0) + 1;
    model.workflowBoost[ind] = Object.fromEntries(Object.entries(counts).map(([wid, c]) => [wid, Math.round((c / list.length) * 30)]));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top) model.notes.push({ pts: 0, text: `${getIndustry(ind).label} buy ${getWorkflow(top[0])?.name || top[0]} most (${top[1]} of ${list.length} deals): recommended first` });
  }
  model.notes.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
  return model;
}

// Adjusts a freshly computed analysis with what the system has learned.
function apply(analysis, lead, model) {
  if (!model || !model.baseline) return analysis;
  const learned = [];
  let delta = 0;
  for (const s of analysis.signals) {
    const pts = model.signalBonus[s.key];
    if (pts) { delta += pts; learned.push({ pts, label: SIGNAL_NAMES[s.key] || s.key }); }
  }
  const ip = model.industryBonus[lead.industry];
  if (ip) { delta += ip; learned.push({ pts: ip, label: getIndustry(lead.industry).label }); }
  const closed = analysis.signals.some((s) => s.key === 'closed');
  const score = closed ? 0 : clamp(analysis.score + delta, 0, 100);
  const boosts = model.workflowBoost[lead.industry];
  let recommended = analysis.recommended;
  if (boosts && analysis.ranked) {
    recommended = analysis.ranked.map((r) => ({ id: r.id, fit: r.fit + (boosts[r.id] || 0) })).sort((a, b) => b.fit - a.fit).slice(0, 3).map((r) => r.id);
  }
  return { ...analysis, score, temperature: score >= 70 ? 'hot' : score >= 45 ? 'warm' : 'cold', recommended, learned };
}

module.exports = { computeModel, apply, MIN_LEADS, MIN_DEALS };
