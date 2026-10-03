# 🏆 SalesBoard

A fun, competitive sales dashboard built so anyone can use it. Your team uses it to sell the **Top 10 fastest-selling automation workflows** (with or without AI) to local businesses pulled from **Google Business listings**.

- 🔎 **Find leads**: pick a business type and a city. Leads come straight from Google and are ranked 🔥 hottest first (no website, few reviews, low rating…).
- 📞 **Call mode**: a personalized teleprompter script (Open → Hook → Ask → Pitch → Close), one-tap objection answers and a live ROI calculator.
- 🎉 **One-button setup**: when the lead says yes, the rep hits **THEY SAID YES** → **SET IT ALL UP**. That one button creates the deal, the Stripe payment link, the client onboarding form and the fulfillment checklist, and fires your automation webhook.
- 🏆 **Leaderboard**: points, levels (Rookie → Legend), badges, streaks, a weekly contest, a live "who just closed" ticker with sound and confetti.
- 💰 **Commission**: reps automatically get **10% of the setup fee** on every deal they close (the rate can be changed). It's tracked as *pending → earned (client paid) → paid out*.

Zero dependencies. Only Node.js 20+ is needed.

---

## 🚀 Start it (2 minutes)

```bash
cp .env.example .env     # optional: add keys later
npm start                # → http://localhost:3000
```

1. Open the app and create your **manager** account (name + PIN).
2. **Manager → Team & Payouts**: add each sales rep with a PIN.
   Or **Manager → Settings → Load demo team** to see it full of data (demo PIN `1234`).
3. Reps open the app on their phone or computer, tap their name, type their PIN and start selling.

Without a Google key the app runs in **practice mode** with realistic fake businesses (phone numbers in the fictional 555-01xx range), so new reps can train safely.

---

## 🧰 The Top 10 Workflows

| # | Workflow | AI? | Setup | Monthly | Rep earns |
|---|----------|-----|------:|--------:|----------:|
| 1 | 📲 Missed-Call Text-Back | No AI needed (AI add-on) | $497 | $97 | $49.70 |
| 2 | ⭐ 5-Star Review Engine | No AI needed (AI add-on) | $597 | $97 | $59.70 |
| 3 | 🤖 24/7 AI Receptionist | AI | $997 | $297 | $99.70 |
| 4 | ⚡ Instant Lead Responder | No AI needed (AI add-on) | $697 | $147 | $69.70 |
| 5 | 📅 Online Booking + No-Show Killer | No AI | $597 | $97 | $59.70 |
| 6 | 💸 Dead Lead Reactivation Blast | AI | $797 | $97 | $79.70 |
| 7 | 💳 Text-to-Pay & Invoice Chaser | No AI | $497 | $77 | $49.70 |
| 8 | 📣 Social + Google Posts Autopilot | AI | $697 | $197 | $69.70 |
| 9 | 📝 Estimate Follow-Up Closer | No AI needed (AI add-on) | $597 | $97 | $59.70 |
| 10 | 🔁 Referral & Rebooking Engine | No AI | $497 | $97 | $49.70 |

Bundles: 🛡️ Never Miss a Lead · 🤖 Robot Front Desk · 💰 Cash This Week.

Change prices anytime in **Manager → Pricing**. To change the wording of scripts, pitches and objections, edit `src/workflows.js`.

---

## 🕹️ Points & levels

| Action | Points |
|---|---|
| Any logged call (no answer / not interested) | +1 |
| Callback scheduled | +2 |
| Interested | +5 |
| Closed deal | +1 per $10 of setup fees |
| Bundle bonus | +25 per extra workflow in the deal |
| ⚡ Speed bonus (closed within 24h of claiming) | +20 |

Call points count once per lead per day, so nobody can farm the button. Cancelled deals remove their points and commission.

Levels: 🐣 Rookie → 💪 Hustler (250) → 🎯 Closer (750) → 🦈 Shark (2,000) → 👑 Legend (5,000).
Badges: First Close, Hat Trick, Dial Machine, Bundle Boss, Speed Demon, On Fire, Big Earner.

---

## 🔌 Going live

All keys go in `.env` (see `.env.example`).

### Real Google leads
1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create an API key.
2. Enable **Places API (New)**.
3. Set `GOOGLE_PLACES_API_KEY=...` and restart.

Each search uses Places **Text Search** and requests phone, website, rating and review count, which Google bills at its higher field tier. Check Google's pricing page and set a budget alert.

### Payments (Stripe)
- `STRIPE_SECRET_KEY` makes every close create a Stripe Checkout link (one-time setup fee + monthly subscription). The link goes into the client's onboarding page and the rep's text/email.
- `STRIPE_WEBHOOK_SECRET`: add a Stripe webhook to `<PUBLIC_URL>/api/hooks/stripe` for `checkout.session.completed`. Deals are then marked paid automatically, which turns the rep's commission from *pending* to *earned*.
- No Stripe? The manager clicks **Mark client paid** instead.

### Automatic provisioning (Zapier / Make / n8n / GoHighLevel)
Paste a webhook URL in **Manager → Settings** (or set `SETUP_WEBHOOK_URL`). SalesBoard POSTs JSON for these events:

| Event | When |
|---|---|
| `deal.created` | Rep pressed the YES button |
| `onboarding.completed` | Client submitted their setup form |
| `deal.paid` | Client paid (Stripe or manager) |

The payload contains `event`, `onboardingUrl` and `deal` (business, contact, workflows with tasks, totals, commission, onboarding answers). If `WEBHOOK_SECRET` is set, each request is signed with an `X-SalesBoard-Signature: sha256=<hmac>` header.

Your automation can report back when a workflow is live:

```bash
curl -X POST $PUBLIC_URL/api/hooks/provisioning \
  -H "Content-Type: application/json" -H "X-SalesBoard-Secret: $WEBHOOK_SECRET" \
  -d '{"dealId":"deal_abc","workflowId":"missed_call_textback","status":"live"}'
```

Leave out `workflowId` to mark every workflow on the deal live.

### Hosting
It's a single Node process that stores everything in `data/db.json`. Run it on any VPS, Render, Railway or Fly.io with a persistent disk, and set `PUBLIC_URL` to your real address so onboarding and payment links work. Back up `data/db.json`.

---

## 🧑‍💼 What the manager does

- **Deals**: see every deal, the client's onboarding answers and the fulfillment checklist. Mark the client paid, mark workflows live, re-send automation, cancel.
- **Team & Payouts**: add reps, reset PINs, deactivate people. See commission owed per rep and record payouts in one click.
- **Pricing**: edit setup and monthly prices, or turn workflows off.
- **Settings**: company name, commission %, daily call/close goals, default city, contest title and prize, webhook URL, and how many days before an untouched lead returns to the pool.

---

## 🛠️ Development

```bash
npm run dev   # auto-restart on changes
npm test      # node:test suite (no dependencies)
```

```
server.js          HTTP server + .env loader
src/app.js         API routes
src/workflows.js   the Top 10 catalog, scripts, objections, onboarding fields
src/leads.js       Google Places search, demo leads, lead scoring
src/setup.js       one-button setup: deal, Stripe, webhooks
src/game.js        points, levels, badges, leaderboard
src/auth.js        PIN login + sessions
public/            dashboard (index.html, app.js, styles.css, fx.js) + client onboarding page
```

Security notes: PINs are hashed with scrypt, and logins lock for 5 minutes after 5 wrong PINs. API keys never leave the server. Onboarding links use random 128-bit tokens. Use HTTPS in production.
