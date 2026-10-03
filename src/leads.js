'use strict';

// Lead sourcing from Google Business listings (Google Places API, New),
// plus opportunity scoring and workflow recommendations.
//
// Without GOOGLE_PLACES_API_KEY we generate clearly-labelled demo listings so
// the team can train on the dashboard before going live.

const crypto = require('node:crypto');
const { getIndustry } = require('./industries');
const { WORKFLOWS } = require('./workflows');

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'places.businessStatus',
  'places.primaryTypeDisplayName',
  'nextPageToken',
].join(',');

async function searchGoogle({ apiKey, industryKey, city, pageToken, fetchImpl = fetch }) {
  const industry = getIndustry(industryKey);
  const body = { textQuery: `${industry.query} in ${city}`, pageSize: 20 };
  if (pageToken) body.pageToken = pageToken;
  const res = await fetchImpl(PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Google Places request failed (${res.status})`;
    const err = new Error(msg);
    err.status = 502;
    throw err;
  }
  const leads = (json.places || []).map((p) => ({
    placeId: p.id,
    name: p.displayName?.text || 'Unknown business',
    address: p.formattedAddress || '',
    phone: p.nationalPhoneNumber || '',
    website: p.websiteUri || '',
    rating: typeof p.rating === 'number' ? p.rating : null,
    reviews: p.userRatingCount || 0,
    mapsUrl: p.googleMapsUri || '',
    businessStatus: p.businessStatus || 'OPERATIONAL',
    category: p.primaryTypeDisplayName?.text || industry.label,
    industry: industry.key,
    city,
    source: 'google',
  }));
  return { leads, nextPageToken: json.nextPageToken || null };
}

// ---------- Demo data ----------

function seededRandom(seed) {
  let h = crypto.createHash('sha256').update(seed).digest().readUInt32LE(0);
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

const SURNAMES = ['Miller', 'Johnson', 'Garcia', 'Patel', 'Nguyen', 'Brooks', 'Rivera', 'Carter', 'Hughes', 'Foster', 'Reed', 'Bennett', 'Coleman', 'Hayes', 'Ortiz', 'Sullivan', 'Price', 'Ward', 'Kim', 'Hall'];
const PREFIXES = ['Elite', 'Premier', 'Pro', 'Precision', 'Family', 'Hometown', 'Bayside', 'Liberty', 'Summit', 'Coastal', 'Blue Ribbon', 'Advantage', 'Tidewater', 'Harbor', 'Five Star'];
const STREETS = ['Main St', 'Oak Ave', 'Shore Dr', 'Military Hwy', 'Granby St', 'Laskin Rd', 'Battlefield Blvd', 'Colley Ave', 'Ocean View Ave', 'Holland Rd'];
const SUFFIX = {
  hvac: ['Heating & Air', 'HVAC', 'Comfort Systems'], plumber: ['Plumbing', 'Plumbing & Drain', 'Rooter'],
  roofer: ['Roofing', 'Roofing & Exteriors'], electrician: ['Electric', 'Electrical Services'],
  dentist: ['Family Dentistry', 'Dental Care', 'Smiles'], chiropractor: ['Chiropractic', 'Spine & Wellness'],
  med_spa: ['Med Spa', 'Aesthetics', 'Skin & Laser'], salon: ['Hair Studio', 'Salon', 'Nail Lounge'],
  auto_repair: ['Auto Repair', 'Automotive', 'Auto Care'], landscaping: ['Landscaping', 'Lawn Care', 'Outdoor Living'],
  cleaning: ['Cleaning Co.', 'Maids', 'Cleaning Services'], pest_control: ['Pest Control', 'Exterminators'],
  lawyer: ['Law Group', 'Injury Lawyers', '& Associates'], real_estate: ['Realty', 'Real Estate Group', 'Homes'],
  gym: ['Fitness', 'Strength Club', 'CrossFit'], restaurant: ['Grill', 'Kitchen', 'Bistro'],
  veterinarian: ['Animal Hospital', 'Veterinary Clinic', 'Pet Care'], contractor: ['Builders', 'Construction', 'Remodeling'],
};

function demoLeads({ industryKey, city, page = 0 }) {
  const industry = getIndustry(industryKey);
  const rand = seededRandom(`${industry.key}|${city.toLowerCase()}|${page}`);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const cityName = city.split(',')[0].trim();
  const suffixes = SUFFIX[industry.key] || ['Services'];
  const leads = [];
  const used = new Set();
  for (let i = 0; i < 12; i++) {
    let name;
    do {
      const style = rand();
      if (style < 0.4) name = `${pick(SURNAMES)} ${pick(suffixes)}`;
      else if (style < 0.75) name = `${pick(PREFIXES)} ${pick(suffixes)}`;
      else name = `${cityName} ${pick(suffixes)}`;
    } while (used.has(name));
    used.add(name);
    const reviews = Math.floor(rand() < 0.45 ? rand() * 35 : rand() * 400);
    const rating = reviews === 0 ? null : Math.round((3.4 + rand() * 1.6) * 10) / 10;
    const hasSite = rand() > 0.35;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
    leads.push({
      placeId: `demo_${crypto.createHash('md5').update(`${industry.key}${city}${name}`).digest('hex').slice(0, 16)}`,
      name,
      address: `${100 + Math.floor(rand() * 8900)} ${pick(STREETS)}, ${city}`,
      // 555-0100..0199 numbers are reserved for fiction, so nobody gets a real call.
      phone: `(757) 555-01${String(Math.floor(rand() * 100)).padStart(2, '0')}`,
      website: hasSite ? `https://www.${slug}.example` : '',
      rating,
      reviews,
      mapsUrl: '',
      businessStatus: 'OPERATIONAL',
      category: industry.label,
      industry: industry.key,
      city,
      source: 'demo',
    });
  }
  return { leads, nextPageToken: page < 2 ? `demo:${page + 1}` : null };
}

// ---------- Scoring & recommendations ----------

function analyzeLead(lead) {
  const signals = [];
  let score = 20;
  const hasPhone = Boolean(lead.phone);

  if (!lead.website) { score += 25; signals.push({ key: 'no_website', label: 'No website', icon: '🚫', tone: 'hot' }); }
  if (lead.reviews < 20) { score += 20; signals.push({ key: 'few_reviews', label: `Only ${lead.reviews} reviews`, icon: '📉', tone: 'hot' }); }
  else if (lead.reviews < 60) { score += 12; signals.push({ key: 'few_reviews', label: `${lead.reviews} reviews`, icon: '📉', tone: 'warm' }); }
  if (lead.rating == null) { score += 10; signals.push({ key: 'no_rating', label: 'No rating yet', icon: '❔', tone: 'warm' }); }
  else if (lead.rating < 4.0) { score += 15; signals.push({ key: 'low_rating', label: `${lead.rating}★ rating`, icon: '⚠️', tone: 'hot' }); }
  else if (lead.rating < 4.4) { score += 8; signals.push({ key: 'low_rating', label: `${lead.rating}★ rating`, icon: '⚠️', tone: 'warm' }); }
  if (lead.rating >= 4.6 && lead.reviews >= 150) { score += 5; signals.push({ key: 'busy', label: 'Busy & loved', icon: '🔥', tone: 'good' }); }
  if (hasPhone) score += 10;
  else { score -= 30; signals.push({ key: 'no_phone', label: 'No phone listed', icon: '📵', tone: 'cold' }); }
  if (lead.businessStatus && lead.businessStatus !== 'OPERATIONAL') {
    score = 0;
    signals.push({ key: 'closed', label: 'Not operating', icon: '⛔', tone: 'cold' });
  }
  score = Math.max(0, Math.min(100, score));

  const keys = new Set(signals.map((s) => s.key));
  const ranked = WORKFLOWS.map((w) => {
    let fit = w.demand / 10;
    if (w.bestFor.includes(lead.industry)) fit += 30;
    if (keys.has('no_website')) fit += { missed_call_textback: 25, ai_receptionist: 15, speed_to_lead: 10, booking_noshow: 8 }[w.id] || 0;
    if (keys.has('few_reviews') || keys.has('low_rating') || keys.has('no_rating')) fit += { review_engine: 40, referral_rebook: 5 }[w.id] || 0;
    if (keys.has('busy')) fit += { ai_receptionist: 20, booking_noshow: 10, missed_call_textback: 10 }[w.id] || 0;
    return { id: w.id, fit };
  }).sort((a, b) => b.fit - a.fit);

  const temperature = score >= 70 ? 'hot' : score >= 45 ? 'warm' : 'cold';
  return { score, temperature, signals, recommended: ranked.slice(0, 3).map((r) => r.id), hook: hookFor(keys) };
}

function hookFor(keys) {
  if (keys.has('no_website')) return 'I noticed you don\'t have a website on your Google listing, so when people find you, the only way in is a phone call. That means every missed call is a lost job.';
  if (keys.has('few_reviews')) return 'You\'ve got {{reviews}} Google reviews. The top {{trade}} businesses in {{city}} usually have a few hundred, and that\'s who Google shows first.';
  if (keys.has('low_rating')) return 'Your rating\'s sitting at {{rating}} stars. Usually that\'s just because happy {{customer}} never get asked to leave one, while unhappy ones always do.';
  if (keys.has('no_rating')) return 'I noticed you don\'t have any Google reviews yet. That\'s the first thing people check before they call.';
  if (keys.has('busy')) return 'You\'ve got a great reputation: {{rating}} stars from {{reviews}} reviews. Businesses doing as well as you usually have more calls than they can answer.';
  return 'Most {{trade}} businesses we talk to are losing jobs simply because nobody can get back to people fast enough.';
}

function reviewLinkFor(lead) {
  return lead.source === 'google' && lead.placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(lead.placeId)}` : '';
}

module.exports = { searchGoogle, demoLeads, analyzeLead, reviewLinkFor };
