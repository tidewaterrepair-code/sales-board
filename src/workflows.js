'use strict';

// The Top 10 fastest-selling workflows for local businesses.
//
// Everything a rep needs lives here: price, pitch, discovery questions,
// objection handling, the info we need from the client after they say yes,
// and the fulfillment checklist our ops team (or automation) runs.
//
// Script placeholders are filled per lead in the browser:
//   {{rep}} {{business}} {{city}} {{trade}} {{customer}} {{rating}}
//   {{reviews}} {{setup}} {{monthly}} {{name}}
//
// Pricing (researched Oct 2026, see docs/PRICING-RESEARCH.md):
//   market  = what agencies / comparable software typically charge
//   cost    = our estimated delivery cost (tools + labor). setup cost is
//             one-time labor + registration fees, monthly is tools/usage.
//   setupFee / monthlyFee = our price, set ~10-25% under market while
//             keeping profit after the rep's one-time 10% setup commission.
//
// ai: 'none'     -> pure automation, no AI involved
//     'optional' -> works without AI; AI add-on makes it smarter
//     'ai'       -> AI-powered

const WORKFLOWS = [
  {
    id: 'missed_call_textback',
    rank: 1,
    name: 'Missed-Call Text-Back',
    emoji: '📲',
    tagline: 'Every missed call gets an instant text so the job never goes to a competitor.',
    ai: 'optional',
    setupFee: 447,
    monthlyFee: 167,
    market: { setup: 497, monthly: 197 },
    cost: { setup: 126, monthly: 35 },
    demand: 98,
    closeSpeed: 'Same-day close',
    bestFor: ['hvac', 'plumber', 'electrician', 'roofer', 'auto_repair', 'pest_control', 'landscaping', 'cleaning', 'contractor', 'salon'],
    pain: 'When they miss a call, the caller just dials the next business on Google.',
    promise: 'Within 5 seconds of a missed call, the caller gets a friendly text from the business and the owner gets an alert.',
    bullets: [
      'Caller gets a text in seconds: "Sorry we missed you! How can we help?"',
      'Owner gets the conversation on their phone and can reply by text',
      'Optional AI add-on answers basic questions and books the job',
    ],
    proof: 'Most callers who hit voicemail never leave a message. They just call the next shop.',
    roi: {
      label: 'Extra revenue per month',
      inputs: [
        { key: 'missed', label: 'Missed calls per week', default: 8 },
        { key: 'win', label: '% we can win back', default: 30, pct: true },
        { key: 'ticket', label: 'Average job value ($)', default: 350, money: true, fromIndustry: true },
      ],
      multiplier: 4.3,
    },
    discovery: [
      'When you\'re on a job and the phone rings, who answers it?',
      'Roughly how many calls do you think go to voicemail in a busy week?',
      'What\'s a typical job worth to you?',
    ],
    pitch: 'Here\'s what we do: the second you miss a call, the caller gets a text from your business number saying "Sorry we missed you, how can we help?" They text back, you see it on your phone, and you keep the job instead of losing it to the next guy on Google. Takes us about a day to turn on and you don\'t have to change your phone number.',
    close: 'It\'s {{setup}} one time to set up and {{monthly}} a month. If it saves even one job a month, it\'s paid for itself. Want me to get it turned on for you today?',
    objections: [
      { q: 'I already call people back.', a: 'Totally, and that\'s great. The problem is the 20 minutes between the missed call and your callback. That\'s when they call someone else. This just holds them for you until you\'re free.' },
      { q: 'Will it change my number?', a: 'Nope. You keep your exact number. We just watch for missed calls and send the text from a local number tied to your business.' },
    ],
    onboarding: [
      { key: 'business_phone', label: 'Main business phone number', type: 'tel', required: true, prefill: 'phone' },
      { key: 'alert_cell', label: 'Cell phone that should get the alerts', type: 'tel', required: true },
      { key: 'textback_message', label: 'Text-back message (we wrote one for you)', type: 'textarea', default: 'Hi! Sorry we missed your call at {{business}}. How can we help you today?' },
    ],
    setupTasks: ['Provision local SMS number', 'Connect missed-call forwarding', 'Load text-back message', 'Run live test call with client'],
  },
  {
    id: 'review_engine',
    rank: 2,
    name: '5-Star Review Engine',
    emoji: '⭐',
    tagline: 'Automatically asks every happy customer for a Google review and replies to reviews with AI.',
    ai: 'optional',
    setupFee: 347,
    monthlyFee: 167,
    market: { setup: 397, monthly: 199 },
    cost: { setup: 80, monthly: 25 },
    demand: 96,
    closeSpeed: 'Same-day close',
    bestFor: ['dentist', 'chiropractor', 'med_spa', 'salon', 'auto_repair', 'hvac', 'plumber', 'restaurant', 'veterinarian', 'cleaning', 'gym', 'lawyer'],
    pain: 'Happy customers never think to leave a review. Unhappy ones always do.',
    promise: 'After every job or visit, the customer gets a text with a one-tap link to leave a Google review. Unhappy customers get routed to the owner first.',
    bullets: [
      'Text + email review request goes out automatically after every job',
      'One tap takes them straight to the review box on Google',
      'Optional AI writes polite replies to every review so the profile looks active',
    ],
    proof: 'More reviews and higher ratings help you show up higher in Google Maps, which is where most local customers start.',
    roi: {
      label: 'New Google reviews per month',
      inputs: [
        { key: 'jobs', label: 'Customers served per month', default: 80 },
        { key: 'rate', label: '% who leave a review when asked', default: 20, pct: true },
      ],
      multiplier: 1,
      unit: 'reviews',
    },
    discovery: [
      'How do you get reviews right now? Do you ask, or do they just happen?',
      'Do you know who ranks above you on Google Maps for "{{trade}} near me"?',
      'How many {{customer}} do you see in a typical month?',
    ],
    pitch: 'We plug into how you already finish a job. When you mark it done, or at the end of the day, your {{customer}} get a quick text: "Thanks for choosing {{business}}! Mind leaving us a quick review?" One tap and they\'re on your Google page. If someone had a bad experience, it comes to you privately first so you can fix it. Businesses that turn this on usually add more reviews in a month than they got all last year.',
    close: 'Setup is {{setup}} one time and {{monthly}} a month. We even find your Google review link for you. Want me to turn it on?',
    objections: [
      { q: 'Isn\'t that against Google\'s rules?', a: 'Asking every customer for a review is 100% fine. We send the same request to everyone. We never buy or fake reviews.' },
      { q: 'We already ask for reviews.', a: 'Love that. The question is how many actually do it. Automating it means you ask 100% of {{customer}}, every time, even on your busiest days.' },
    ],
    onboarding: [
      { key: 'review_link', label: 'Google review link (we found it for you)', type: 'url', required: true, prefill: 'reviewLink' },
      { key: 'customer_source', label: 'How do you track customers? (e.g. Jobber, Square, paper, Google Sheet)', type: 'text', required: true },
      { key: 'bad_review_email', label: 'Email to alert if a customer is unhappy', type: 'email', required: true, prefill: 'email' },
    ],
    setupTasks: ['Verify Google review link', 'Connect customer source / CRM', 'Load review request templates', 'Enable AI review replies (if purchased)', 'Send test request to owner'],
  },
  {
    id: 'ai_receptionist',
    rank: 3,
    name: '24/7 AI Receptionist',
    emoji: '🤖',
    tagline: 'An AI voice + chat assistant that answers calls, answers questions and books appointments around the clock.',
    ai: 'ai',
    setupFee: 447,
    monthlyFee: 257,
    market: { setup: 497, monthly: 297 },
    cost: { setup: 170, monthly: 115 },
    demand: 94,
    closeSpeed: '1–2 day close',
    bestFor: ['hvac', 'plumber', 'dentist', 'med_spa', 'lawyer', 'chiropractor', 'veterinarian', 'roofer', 'electrician', 'real_estate'],
    pain: 'Calls come in after hours, during lunch and while everyone is busy, and nobody answers.',
    promise: 'A friendly AI receptionist answers every call and website chat, books appointments and texts the owner a summary.',
    bullets: [
      'Answers calls 24/7 in a natural voice and never puts anyone on hold',
      'Knows their services, prices, hours and FAQs',
      'Books appointments or transfers urgent calls to a real person',
      'Includes up to 600 call minutes a month (plenty for most shops)',
    ],
    proof: 'A lot of calls come in after hours and on weekends, and most people won\'t wait until Monday.',
    roi: {
      label: 'Extra revenue per month',
      inputs: [
        { key: 'calls', label: 'Unanswered calls per week', default: 12 },
        { key: 'book', label: '% AI can book', default: 25, pct: true },
        { key: 'ticket', label: 'Average job value ($)', default: 350, money: true, fromIndustry: true },
      ],
      multiplier: 4.3,
    },
    discovery: [
      'What happens when someone calls at 8pm or on a Sunday?',
      'Do you have a receptionist, or do calls go to you or your cell?',
      'What are the top 3 questions people ask when they call?',
    ],
    pitch: 'Imagine a receptionist who never sleeps, never calls in sick and costs less than a day of temp help per month. It answers your phone, knows your services and prices, books the appointment right into your calendar, and texts you a summary. If it\'s an emergency, it transfers to you. Your {{customer}} just think they talked to your front desk.',
    close: 'It\'s {{setup}} to set up, and we train it on your business, and {{monthly}} a month. That\'s a fraction of what a part-time receptionist costs. Should I get yours built?',
    objections: [
      { q: 'People hate talking to robots.', a: 'They hate bad robots, the "press 1" kind. This one talks like a person, and honestly most callers don\'t notice. And it beats voicemail every time, which is what they get now.' },
      { q: 'What if it says something wrong?', a: 'It only answers from the info you approve. Anything it\'s not sure about, it takes a message or transfers to you. You can review every call.' },
    ],
    onboarding: [
      { key: 'hours', label: 'Business hours', type: 'text', required: true, placeholder: 'Mon–Fri 8am–5pm, Sat 9am–1pm' },
      { key: 'services', label: 'Services you offer + rough prices', type: 'textarea', required: true },
      { key: 'faqs', label: 'Top questions callers ask (and your answers)', type: 'textarea' },
      { key: 'transfer_number', label: 'Number to transfer urgent calls to', type: 'tel', required: true },
      { key: 'calendar', label: 'Calendar you book in (Google, Outlook, software name)', type: 'text' },
    ],
    setupTasks: ['Build AI knowledge base from onboarding', 'Configure voice + greeting', 'Connect calendar booking', 'Set transfer / emergency rules', 'Install website chat widget', 'Run 5 test calls & client sign-off'],
  },
  {
    id: 'speed_to_lead',
    rank: 4,
    name: 'Instant Lead Responder',
    emoji: '⚡',
    tagline: 'Replies to every web form, Facebook and Google lead in under 60 seconds by text and email.',
    ai: 'optional',
    setupFee: 497,
    monthlyFee: 167,
    market: { setup: 597, monthly: 197 },
    cost: { setup: 120, monthly: 30 },
    demand: 92,
    closeSpeed: 'Same-day close',
    bestFor: ['roofer', 'contractor', 'real_estate', 'lawyer', 'med_spa', 'hvac', 'landscaping', 'gym', 'cleaning'],
    pain: 'Leads go cold in minutes. The first business to respond usually wins the job.',
    promise: 'Every new lead gets a personal text and email within 60 seconds, and the owner gets pinged with the details.',
    bullets: [
      'Watches web forms, Facebook lead ads, Google LSA, Angi, Thumbtack and more',
      'Sends a personal text + email in under 60 seconds, day or night',
      'Optional AI qualifies the lead and books the estimate',
    ],
    proof: 'The first business to respond usually wins. Leads go cold within minutes, not hours.',
    roi: {
      label: 'Extra revenue per month',
      inputs: [
        { key: 'leads', label: 'Leads per month', default: 40 },
        { key: 'lift', label: 'Extra % closed with instant reply', default: 10, pct: true },
        { key: 'ticket', label: 'Average job value ($)', default: 350, money: true, fromIndustry: true },
      ],
      multiplier: 1,
    },
    discovery: [
      'Where do your leads come from right now? Website, Facebook, Angi?',
      'When a form comes in at 9pm, how soon does someone reach out?',
      'Do you ever pay for leads that you just never got to in time?',
    ],
    pitch: 'Here\'s the deal: whoever calls the lead back first usually wins. So we make sure that\'s always you. The second a lead comes in, from your website, Facebook, wherever, they get a personal text from you within 60 seconds. "Hey, it\'s {{business}}, got your request, when\'s a good time for an estimate?" You get pinged at the same time. You stop paying for leads that go cold.',
    close: 'It\'s {{setup}} to connect all your lead sources and {{monthly}} a month. Want me to hook it up for you?',
    objections: [
      { q: 'We respond pretty fast already.', a: 'How fast at 9pm on a Saturday? This covers the times you physically can\'t, so you never lose one to a slower moment.' },
      { q: 'We don\'t get many leads.', a: 'Then every single one matters even more. Losing one big job pays for this for the year.' },
    ],
    onboarding: [
      { key: 'lead_sources', label: 'Where do your leads come from? (website form, Facebook, Angi, Thumbtack…)', type: 'textarea', required: true },
      { key: 'website', label: 'Website URL', type: 'url', prefill: 'website' },
      { key: 'alert_cell', label: 'Cell phone for new-lead alerts', type: 'tel', required: true },
    ],
    setupTasks: ['Connect website form', 'Connect Facebook / Google lead sources', 'Load instant-reply text + email', 'Configure AI qualification (if purchased)', 'Submit test lead & verify < 60s'],
  },
  {
    id: 'booking_noshow',
    rank: 5,
    name: 'Online Booking + No-Show Killer',
    emoji: '📅',
    tagline: 'Online booking with automatic text reminders and confirmations that cut no-shows dramatically.',
    ai: 'none',
    setupFee: 347,
    monthlyFee: 109,
    market: { setup: 397, monthly: 129 },
    cost: { setup: 100, monthly: 20 },
    demand: 90,
    closeSpeed: 'Same-day close',
    bestFor: ['dentist', 'chiropractor', 'salon', 'med_spa', 'auto_repair', 'veterinarian', 'gym', 'cleaning'],
    pain: 'No-shows and phone tag waste hours every week and leave empty slots on the calendar.',
    promise: 'Customers book online 24/7 and get automatic confirmation + reminder texts. Empty slots get filled from a waitlist.',
    bullets: [
      'Book-online button on Google, website and Facebook',
      'Automatic confirmation, 24-hour and 2-hour reminder texts',
      'One-tap reschedule so cancellations become rebookings',
    ],
    proof: 'Text reminders are one of the simplest, most proven ways to reduce no-shows.',
    roi: {
      label: 'Revenue saved per month',
      inputs: [
        { key: 'noshows', label: 'No-shows per week', default: 4 },
        { key: 'saved', label: '% reminders prevent', default: 50, pct: true },
        { key: 'ticket', label: 'Average appointment value ($)', default: 150, money: true, fromIndustry: true },
      ],
      multiplier: 4.3,
    },
    discovery: [
      'How do people book with you today? Phone only?',
      'How many no-shows or late cancels do you get in a week?',
      'Who spends time calling to confirm appointments?',
    ],
    pitch: 'We give you a "Book Now" button on your Google listing, website and Facebook, so {{customer}} can book at midnight without calling. Then the system texts them a confirmation, a reminder the day before and a reminder two hours before. If they need to move it, they tap a link and rebook instead of just not showing up. Nobody on your team has to make a single confirmation call.',
    close: 'It\'s {{setup}} to set up and {{monthly}} a month. One saved no-show a week pays for it several times over. Should I set it up?',
    objections: [
      { q: 'We already use booking software.', a: 'Perfect, we can usually connect to it and just add the reminder and rebooking automation on top. No switching.' },
      { q: 'Our customers are older and like to call.', a: 'They can still call! But everyone reads texts, and the reminders alone cut no-shows for every age group.' },
    ],
    onboarding: [
      { key: 'hours', label: 'Business hours', type: 'text', required: true },
      { key: 'services', label: 'Services + how long each takes', type: 'textarea', required: true },
      { key: 'current_booking', label: 'Current booking software (if any)', type: 'text' },
    ],
    setupTasks: ['Build booking calendar + services', 'Add Book Now to Google Business Profile', 'Configure confirmation & reminder texts', 'Embed booking on website / Facebook', 'Test booking end-to-end'],
  },
  {
    id: 'reactivation',
    rank: 6,
    name: 'Dead Lead Reactivation Blast',
    emoji: '💸',
    tagline: 'AI text campaign that wakes up old customers and past leads. Usually books jobs within days.',
    ai: 'ai',
    setupFee: 847,
    monthlyFee: 297,
    market: { setup: 997, monthly: 397 },
    cost: { setup: 200, monthly: 45 },
    demand: 88,
    closeSpeed: 'Same-day close',
    bestFor: ['hvac', 'dentist', 'med_spa', 'chiropractor', 'auto_repair', 'gym', 'salon', 'roofer', 'real_estate', 'pest_control', 'cleaning'],
    pain: 'They are sitting on a list of past customers and leads that never hear from them again.',
    promise: 'We send a friendly AI-powered text campaign to their old list. AI handles the replies and books the interested ones.',
    bullets: [
      'Upload any old customer or lead list: spreadsheet, CRM, even a phone export',
      'Friendly offer text goes out, and AI chats with everyone who replies',
      'Hot replies get booked or handed to the owner. Fast cash, often within days',
    ],
    proof: 'Your past customers already know and trust you. It\'s the cheapest revenue you\'ll ever get.',
    roi: {
      label: 'One-time revenue from campaign',
      inputs: [
        { key: 'list', label: 'Past customers / leads on list', default: 500 },
        { key: 'book', label: '% who rebook', default: 3, pct: true },
        { key: 'ticket', label: 'Average job value ($)', default: 350, money: true, fromIndustry: true },
      ],
      multiplier: 1,
    },
    discovery: [
      'Roughly how many past customers do you have, even if they\'re just in your phone?',
      'When was the last time you reached out to all of them?',
      'If you could book 10 extra jobs this month, could you handle it?',
    ],
    pitch: 'You\'ve got hundreds of past {{customer}} who already like you. They just forgot about you. We send them a friendly text with a simple offer, like a seasonal check-up or a returning-customer discount. When they reply, our AI chats with them like a person and books the ones who are ready. Most businesses see bookings within a few days of launch. It\'s the fastest money you\'ll make this year.',
    close: 'It\'s {{setup}} for setup and your first campaign, then {{monthly}} a month to keep it running every quarter. Want to launch your first one this week?',
    objections: [
      { q: 'My list is a mess.', a: 'That\'s normal! Send us whatever you have, a spreadsheet, a phone export, whatever. We clean it up.' },
      { q: 'I don\'t want to spam people.', a: 'Agreed. It\'s one friendly, personal text to people who already did business with you, and anyone can reply STOP. It feels like a check-in, not an ad.' },
    ],
    onboarding: [
      { key: 'list_location', label: 'Where is your customer list? (CRM, spreadsheet, phone)', type: 'text', required: true },
      { key: 'list_size', label: 'Rough number of contacts', type: 'number' },
      { key: 'offer', label: 'Offer to send (e.g. $50 off a tune-up)', type: 'text', required: true },
    ],
    setupTasks: ['Collect & clean contact list', 'Write campaign + offer copy', 'Train AI reply agent', 'Compliance check (opt-out, consent)', 'Launch campaign & monitor replies'],
  },
  {
    id: 'text_to_pay',
    rank: 7,
    name: 'Text-to-Pay & Invoice Chaser',
    emoji: '💳',
    tagline: 'Send invoices by text, take payment in one tap, and auto-chase late payers politely.',
    ai: 'none',
    setupFee: 247,
    monthlyFee: 127,
    market: { setup: 297, monthly: 149 },
    cost: { setup: 80, monthly: 20 },
    demand: 85,
    closeSpeed: 'Same-day close',
    bestFor: ['plumber', 'hvac', 'electrician', 'landscaping', 'cleaning', 'pest_control', 'auto_repair', 'contractor', 'lawyer'],
    pain: 'Chasing unpaid invoices is awkward, slow and eats cash flow.',
    promise: 'Invoices go out by text with a pay-now link. Polite automatic reminders go out until it\'s paid.',
    bullets: [
      'Invoice by text with Apple Pay / Google Pay / card in one tap',
      'Automatic friendly reminders at 3, 7 and 14 days',
      'Owner sees who paid and who didn\'t, with no awkward calls',
    ],
    proof: 'People pay faster when paying is one tap from a text instead of a mailed invoice.',
    roi: {
      label: 'Hours saved per month',
      inputs: [
        { key: 'invoices', label: 'Invoices sent per month', default: 60 },
        { key: 'late', label: '% that are paid late', default: 30, pct: true },
        { key: 'hours', label: 'Hours spent chasing each late one', default: 0.5 },
      ],
      multiplier: 1,
      unit: 'hours',
    },
    discovery: [
      'How do you send invoices today?',
      'How much money is outstanding right now, roughly?',
      'Who has to make the "hey, just following up on that invoice" calls?',
    ],
    pitch: 'When you finish a job, your customer gets a text with the invoice and a "Pay Now" button. Apple Pay, card, whatever. If they don\'t pay, the system sends polite reminders automatically, so you never have to make that awkward call again. Most owners tell us they get paid days faster.',
    close: 'It\'s {{setup}} to set up and {{monthly}} a month. Want me to get you set up so you get paid faster starting this week?',
    objections: [
      { q: 'I already use QuickBooks / Square.', a: 'Great, we connect to it. We just add the text delivery and the automatic chasing on top.' },
      { q: 'What about fees?', a: 'Standard card processing through your own processor. Most owners happily trade that for getting paid in a day instead of a month.' },
    ],
    onboarding: [
      { key: 'processor', label: 'Payment processor (Stripe, Square, QuickBooks…)', type: 'text', required: true },
      { key: 'invoice_tool', label: 'How do you create invoices today?', type: 'text', required: true },
    ],
    setupTasks: ['Connect payment processor', 'Connect invoicing tool', 'Load invoice text + reminder sequence', 'Send test invoice'],
  },
  {
    id: 'social_autopilot',
    rank: 8,
    name: 'Social + Google Posts Autopilot',
    emoji: '📣',
    tagline: 'AI creates and posts branded content to Facebook, Instagram and their Google Business Profile every week.',
    ai: 'ai',
    setupFee: 397,
    monthlyFee: 447,
    market: { setup: 497, monthly: 597 },
    cost: { setup: 150, monthly: 90 },
    demand: 82,
    closeSpeed: '1–2 day close',
    bestFor: ['restaurant', 'salon', 'med_spa', 'gym', 'real_estate', 'dentist', 'landscaping', 'contractor', 'veterinarian'],
    pain: 'Their social pages and Google profile look abandoned, so customers wonder if they\'re still open.',
    promise: 'Fresh, on-brand posts go out 3x a week to Facebook, Instagram and Google, with zero effort from the owner.',
    bullets: [
      'AI writes posts and makes graphics in their brand colors',
      'Auto-posts to Facebook, Instagram and Google Business Profile',
      'Owner can approve with one tap, or let it run on autopilot',
    ],
    proof: 'An active Google Business Profile signals to customers, and to Google, that you\'re open and busy.',
    roi: {
      label: 'Hours saved per month',
      inputs: [
        { key: 'posts', label: 'Posts per month', default: 12 },
        { key: 'mins', label: 'Minutes each would take you', default: 45 },
      ],
      multiplier: 1 / 60,
      unit: 'hours',
    },
    discovery: [
      'When was the last time you posted on Facebook or Google?',
      'Who handles your social media now?',
      'What makes you different from other {{trade}} businesses in {{city}}?',
    ],
    pitch: 'Most owners know they should post but never have time. We take it completely off your plate. Our AI creates posts with your logo and colors, things like tips, specials and before-and-afters, and posts them to Facebook, Instagram and your Google profile three times a week. Your business looks busy and trustworthy, and you never think about it.',
    close: 'It\'s {{setup}} to set up your brand kit and {{monthly}} a month for done-for-you posting. Want me to start it?',
    objections: [
      { q: 'Social media doesn\'t get me customers.', a: 'It\'s less about going viral and more about trust. When someone finds you and sees you posted yesterday, they call. When they see your last post was 2021, they wonder if you\'re still open.' },
      { q: 'I want control over what\'s posted.', a: 'You can approve every post with one tap from your phone, or let it run. Your choice.' },
    ],
    onboarding: [
      { key: 'social_links', label: 'Facebook / Instagram page links', type: 'textarea' },
      { key: 'brand', label: 'Brand colors / logo link (or "use my website")', type: 'text' },
      { key: 'topics', label: 'Specials, services or topics to highlight', type: 'textarea' },
    ],
    setupTasks: ['Build brand kit', 'Connect Facebook, Instagram, Google Business Profile', 'Generate first 2 weeks of posts', 'Client approves first batch', 'Enable autopilot schedule'],
  },
  {
    id: 'estimate_followup',
    rank: 9,
    name: 'Estimate Follow-Up Closer',
    emoji: '📝',
    tagline: 'Automatically follows up on every quote until the customer says yes or no.',
    ai: 'optional',
    setupFee: 397,
    monthlyFee: 197,
    market: { setup: 497, monthly: 249 },
    cost: { setup: 100, monthly: 25 },
    demand: 80,
    closeSpeed: 'Same-day close',
    bestFor: ['roofer', 'contractor', 'hvac', 'landscaping', 'electrician', 'plumber', 'lawyer', 'cleaning'],
    pain: 'Most quotes die from silence. Nobody follows up after sending them.',
    promise: 'Every estimate gets a friendly multi-touch follow-up by text and email until the customer decides.',
    bullets: [
      'Follow-ups at day 1, 3, 7 and 14 by text and email',
      'Stops automatically the moment they reply or sign',
      'Optional AI answers questions about the quote and handles objections',
    ],
    proof: 'Plenty of quotes are lost to nothing more than silence. A simple follow-up wins them back.',
    roi: {
      label: 'Extra revenue per month',
      inputs: [
        { key: 'quotes', label: 'Quotes sent per month', default: 20 },
        { key: 'lift', label: 'Extra % closed with follow-up', default: 10, pct: true },
        { key: 'ticket', label: 'Average job value ($)', default: 350, money: true, fromIndustry: true },
      ],
      multiplier: 1,
    },
    discovery: [
      'How many estimates do you send in a month?',
      'What happens after you send one? Do you follow up?',
      'What\'s your average job size?',
    ],
    pitch: 'You put the work into every estimate, so let\'s make sure none of them die from silence. After you send a quote, the system follows up for you by text and email: day 1, day 3, day 7, day 14. It\'s friendly and personal, and it stops the second they reply. You\'ll close jobs you would have totally forgotten about.',
    close: 'It\'s {{setup}} to set up and {{monthly}} a month. One extra closed job pays for the whole year. Want me to set it up?',
    objections: [
      { q: 'I don\'t want to seem pushy.', a: 'The messages are short and helpful, like "Any questions on your estimate?" Customers actually appreciate it, and it makes you look organized.' },
      { q: 'I follow up myself.', a: 'Every single one, every time, even in your busiest week? This is your safety net.' },
    ],
    onboarding: [
      { key: 'estimate_tool', label: 'How do you send estimates? (software, email, paper)', type: 'text', required: true },
      { key: 'avg_quote', label: 'Average quote size ($)', type: 'number' },
    ],
    setupTasks: ['Connect estimating tool / intake', 'Load follow-up sequence', 'Configure stop-on-reply rules', 'Enable AI replies (if purchased)', 'Test with sample estimate'],
  },
  {
    id: 'referral_rebook',
    rank: 10,
    name: 'Referral & Rebooking Engine',
    emoji: '🔁',
    tagline: 'Automatically asks for referrals and reminds customers when it\'s time to book again.',
    ai: 'none',
    setupFee: 297,
    monthlyFee: 127,
    market: { setup: 397, monthly: 149 },
    cost: { setup: 80, monthly: 20 },
    demand: 78,
    closeSpeed: 'Same-day close',
    bestFor: ['salon', 'dentist', 'hvac', 'pest_control', 'auto_repair', 'cleaning', 'chiropractor', 'med_spa', 'veterinarian', 'landscaping'],
    pain: 'Repeat business and referrals are left to chance. Customers forget to come back.',
    promise: 'Customers get automatic "time for your next visit" reminders and a simple referral offer they can share.',
    bullets: [
      'Rebooking reminders at the right interval (6 months, 30 days, seasonal…)',
      'Shareable referral link with a reward for both sides',
      'Owner sees who referred whom and the revenue it drove',
    ],
    proof: 'It costs far less to keep a customer than to find a new one.',
    roi: {
      label: 'Extra revenue per month',
      inputs: [
        { key: 'customers', label: 'Active customers', default: 300 },
        { key: 'extra', label: 'Extra % who rebook each month', default: 3, pct: true },
        { key: 'ticket', label: 'Average visit value ($)', default: 150, money: true, fromIndustry: true },
      ],
      multiplier: 1,
    },
    discovery: [
      'How often should a customer come back to you?',
      'Do you remind them, or wait for them to remember?',
      'How much of your business comes from referrals today?',
    ],
    pitch: 'You already did the hard part, which is winning the customer. We make sure they come back. When it\'s time for their next visit, they get a friendly text with a booking link. And after a great visit, they get a referral link: "Give your friends $25 off, and get $25 yourself." It runs in the background forever.',
    close: 'It\'s {{setup}} to set up and {{monthly}} a month. Want me to get your repeat business on autopilot?',
    objections: [
      { q: 'My customers come back anyway.', a: 'The loyal ones do! This catches the ones who forget, and there are always more of those than you think.' },
      { q: 'I don\'t want to give discounts.', a: 'The reward can be anything: a free add-on, priority booking, a gift card. You pick.' },
    ],
    onboarding: [
      { key: 'rebook_interval', label: 'How often should customers come back?', type: 'text', required: true, placeholder: 'Every 6 months' },
      { key: 'referral_reward', label: 'Referral reward (for both sides)', type: 'text', required: true, placeholder: '$25 off' },
    ],
    setupTasks: ['Import customer list + last visit dates', 'Configure rebooking intervals', 'Create referral offer + link', 'Load message templates', 'Test end-to-end'],
  },
];

// Universal objections every rep should know cold.
const UNIVERSAL_OBJECTIONS = [
  { q: 'How much is it?', a: 'Great question. Most agencies charge around {{marketSetup}} to set this up and {{marketMonthly}} a month. We\'re {{setup}} one time and {{monthly}} a month. And what\'s one new {{customer}} worth to you? This usually pays for itself with the first one or two.' },
  { q: 'I need to think about it.', a: 'Totally fair. Usually when someone says that, it\'s either the price or whether it\'ll actually work. Which one is it for you? (Then answer it.) We can also start with just one workflow so you can see it work.' },
  { q: 'Just send me some info.', a: 'Happy to! What\'s the best email for you? (Type it in the 📧 box. They\'ll automatically get our follow-up emails.) Honestly though, the info won\'t show you much. What it does is simple: [one-line pitch]. Want me to turn it on so you can see it working this week?' },
  { q: 'I\'m busy right now.', a: 'No problem, I\'ll be quick. That\'s actually exactly why I called: this runs while you\'re busy. When\'s a better time today, at 4 or 5? (Hit "Call Back" and set the time.)' },
  { q: 'We already have someone for that.', a: 'Good to hear you\'re on it! Out of curiosity, are they doing [the specific thing]? Most setups we replace were missing that one piece.' },
  { q: 'I don\'t trust AI with my customers.', a: 'I get it. That\'s why most of what we do doesn\'t even need AI. The AI parts are optional, and you approve exactly what it says. Want to start with the non-AI version?' },
  { q: 'It\'s not in the budget.', a: 'Understood. We\'re already priced under what most agencies charge ({{marketSetup}} + {{marketMonthly}}/mo). And this isn\'t really a cost, it\'s a way to recover money you\'re already losing. If it brings in even one extra job a month, it\'s paid for itself. Want to start with just the most important piece?' },
  { q: 'Is there a contract?', a: 'No long-term contract. It\'s month to month. We keep you because it works, not because you\'re locked in.' },
];

// Universal opener and signal-based hooks used by the call-mode teleprompter.
const OPENER = 'Hi, is this {{business}}? Hey, this is {{rep}}. I\'ll be super quick, I know you\'re busy. I work with {{trade}} businesses here in {{city}}, and I was just looking at your Google listing. Do you have 30 seconds?';

// Ready-made bundles reps can pitch in one click (bundle bonus points apply).
const BUNDLES = [
  { id: 'never_miss', name: 'Never Miss a Lead', emoji: '🛡️', workflows: ['missed_call_textback', 'speed_to_lead', 'review_engine'], pitch: 'Catch every call, every lead, and turn every job into a 5-star review.' },
  { id: 'front_desk', name: 'Robot Front Desk', emoji: '🤖', workflows: ['ai_receptionist', 'booking_noshow', 'review_engine'], pitch: 'Answer every call, book every appointment, kill no-shows.' },
  { id: 'cash_now', name: 'Cash This Week', emoji: '💰', workflows: ['reactivation', 'text_to_pay', 'estimate_followup'], pitch: 'Wake up old customers, close old quotes, and collect unpaid invoices.' },
];

const BY_ID = Object.fromEntries(WORKFLOWS.map((w) => [w.id, w]));

module.exports = { WORKFLOWS, UNIVERSAL_OBJECTIONS, OPENER, BUNDLES, getWorkflow: (id) => BY_ID[id] };
