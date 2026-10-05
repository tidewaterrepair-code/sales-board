# 🏆 SalesBoard

A fun, competitive sales dashboard built so anyone can use it. Your team uses it to sell the **Top 10 fastest-selling automation workflows** (with or without AI) to local businesses pulled from **Google Business listings**.

- 🔎 **Find leads**: pick a business type and a city. Leads come straight from Google and are ranked 🔥 hottest first (no website, few reviews, low rating…).
- 📞 **Call mode**: a personalized teleprompter script (Open → Hook → Ask → Pitch → Close), one-tap objection answers and a live ROI calculator.
- 🎉 **One-button setup**: when the lead says yes, the rep presses **THEY SAID YES**, ticks what the client agreed to (plus the AI upgrade, phone area code, login and payment options) and presses **SET IT ALL UP**. SalesBoard then builds everything while the rep watches: a Stripe payment link, the client's **GoHighLevel sub-account from your template** with their details filled in and only their workflows switched on, the owner's login, an **AI receptionist in Retell with a local phone number**, and a welcome email with their setup form. When the client submits the form, their answers flow into GoHighLevel and the AI automatically.
- 🏆 **Leaderboard**: points, levels (Rookie → Legend), badges, streaks, a weekly contest, a live "who just closed" ticker with sound and confetti.
- 💰 **Commission**: reps get **10% of the setup fee, paid once**, on every deal they close. There's no commission on monthly fees. It's tracked as *pending → earned (client paid) → paid out*.
- 📧 **Email drip**: any lead who gives an email gets automatic follow-ups through Brevo/Resend free tiers.
- 🏷️ **Priced under market, never at a loss**: researched prices, with live profit math for the manager.

Zero dependencies. Only Node.js 20+ is needed.

---

## 🚀 Install (one command)

```bash
bash install.sh              # Mac / Linux: installs Node if needed, asks for keys, starts the app
bash install.sh --service    # Linux server: also keeps it running 24/7
docker compose up -d         # or run it with Docker
```
Windows: `powershell -ExecutionPolicy Bypass -File install.ps1`

The app opens at **http://localhost:3000**. Press Enter to skip any key, and add them later with `npm run setup`.
👉 **[docs/SETUP-GUIDE.md](docs/SETUP-GUIDE.md)** is the step-by-step walkthrough, written so anyone can follow it: domain → server → Google → email → Stripe → GoHighLevel → Retell → practice close. **[docs/GHL-SNAPSHOT.md](docs/GHL-SNAPSHOT.md)** shows how to build your GoHighLevel template. Inside the app, **Manager → 🚀 Launch** turns green as you finish each step.

1. Create your **manager** account (name + PIN).
2. **Manager → Team & Payouts**: add each sales rep with a PIN.
   Or **Manager → Settings → Load demo team** to see it full of data (demo PIN `1234`).
3. Reps open the app on their phone or computer, tap their name, type their PIN and start selling.

Without a Google key the app runs in **practice mode** with realistic fake businesses (phone numbers in the fictional 555-01xx range), so new reps can train safely.

---

## 🧰 The Top 10 Workflows (priced under market)

Prices are researched and sit **10–25% under what agencies typically charge**, while staying profitable after the rep's commission. Sources and full math: **[docs/PRICING-RESEARCH.md](docs/PRICING-RESEARCH.md)**.

| # | Workflow | AI? | Market | **Our price** | Rep earns (once) |
|---|----------|-----|-------:|------:|----------:|
| 1 | 📲 Missed-Call Text-Back | No AI needed (AI add-on) | $497 + $197/mo | **$447 + $167/mo** | $44.70 |
| 2 | ⭐ 5-Star Review Engine | No AI needed (AI add-on) | $397 + $199/mo | **$347 + $167/mo** | $34.70 |
| 3 | 🤖 24/7 AI Receptionist | AI | $497 + $297/mo | **$447 + $257/mo** | $44.70 |
| 4 | ⚡ Instant Lead Responder | No AI needed (AI add-on) | $597 + $197/mo | **$497 + $167/mo** | $49.70 |
| 5 | 📅 Online Booking + No-Show Killer | No AI | $397 + $129/mo | **$347 + $109/mo** | $34.70 |
| 6 | 💸 Dead Lead Reactivation Blast | AI | $997 + $397/mo | **$847 + $297/mo** | $84.70 |
| 7 | 💳 Text-to-Pay & Invoice Chaser | No AI | $297 + $149/mo | **$247 + $127/mo** | $24.70 |
| 8 | 📣 Social + Google Posts Autopilot | AI | $497 + $597/mo | **$397 + $447/mo** | $39.70 |
| 9 | 📝 Estimate Follow-Up Closer | No AI needed (AI add-on) | $497 + $249/mo | **$397 + $197/mo** | $39.70 |
| 10 | 🔁 Referral & Rebooking Engine | No AI | $397 + $149/mo | **$297 + $127/mo** | $29.70 |

**Commission:** reps earn **10% of the setup fee, paid once**, when the client pays. Monthly fees carry no commission.

Bundles: 🛡️ Never Miss a Lead · 🤖 Robot Front Desk · 💰 Cash This Week.

**Manager → Pricing & Profit** shows market price, our cost and profit for every workflow. It **refuses any price or commission rate that would lose money**. To change the wording of scripts, pitches and objections, edit `src/workflows.js`.

---

## 📧 Email drip

When a rep types in a lead's email (call screen → **📧 Got their email?**, +3 points), that lead joins the drip automatically:

- **Prospects:** 5 personal follow-ups over ~2 weeks. Day 0: the info they asked for. Day 2: the money math. Day 5: FAQ. Day 9: what to pair it with. Day 14: "should I close your file?". The drip stops the moment they buy.
- **New customers:** a welcome email with their setup-form and payment links, plus reminders until the form is done.

Emails go out through **Brevo** (free 300/day) or **Resend** (free 100/day) and stay under the free daily cap. Every email has the company's mailing address and an unsubscribe link (CAN-SPAM), and unsubscribed people are never emailed again. **Manager → 📧 Email Drip** shows who's in the drip, what's been sent and what's still needed to start sending.

---

## 🕹️ Points & levels

| Action | Points |
|---|---|
| Any logged call (no answer / not interested) | +1 |
| Callback scheduled | +2 |
| Interested | +5 |
| Got their email (joins the drip) | +3 |
| Closed deal | +1 per $10 of setup fees |
| Bundle bonus | +25 per extra workflow in the deal |
| ⚡ Speed bonus (closed within 24h of claiming) | +20 |

Call points count once per lead per day, so nobody can farm the button. Cancelled deals remove their points and commission.

Levels: 🐣 Rookie → 💪 Hustler (250) → 🎯 Closer (750) → 🦈 Shark (2,000) → 👑 Legend (5,000).
Badges: First Close, Hat Trick, Dial Machine, Bundle Boss, Speed Demon, On Fire, Big Earner.

---

## 🔌 Going live

All keys go in `.env` (see `.env.example`).

Step-by-step instructions for every free tier are in **[docs/SETUP-GUIDE.md](docs/SETUP-GUIDE.md)**. In short:

- **Google leads**: enable *Places API (New)*, put the key in `GOOGLE_PLACES_API_KEY`. Google gives 1,000 searches/month free. The app counts them and stops at `GOOGLE_MONTHLY_LIMIT` (default 1000) so you're never billed by surprise, and repeat searches within 24h are served from cache.
- **Email drip**: `BREVO_API_KEY` (or `RESEND_API_KEY`), then set the sender email and mailing address in **Manager → 📧 Email Drip**.
- **Stripe**: `STRIPE_SECRET_KEY` creates a Checkout link (setup fee + monthly plan) on every close. With `STRIPE_WEBHOOK_SECRET` (endpoint `<PUBLIC_URL>/api/hooks/stripe`, event `checkout.session.completed`), deals are marked paid automatically and commission becomes *earned*. Without Stripe, the manager clicks **Mark client paid**.

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
It's a single Node process that stores everything in `data/db.json`. The free option is a Google Cloud e2-micro VM plus Cloudflare Tunnel (see the guide). Use `bash install.sh --service` or `docker compose up -d`, set `PUBLIC_URL` to your real address, and back up `data/db.json`.

---

## 🧑‍💼 What the manager does

- **Deals**: see every deal, the client's onboarding answers and the fulfillment checklist. Mark the client paid, mark workflows live, re-send automation, cancel.
- **Team & Payouts**: add reps, reset PINs, deactivate people. See commission owed per rep and record payouts in one click.
- **Pricing**: edit setup and monthly prices, or turn workflows off.
- **Settings**: company name, commission %, daily call/close goals, default city, contest title and prize, webhook URL, and how many days before an untouched lead returns to the pool.

---

## 🛠️ Development

```bash
npm run setup # change keys (.env)
npm run dev   # auto-restart on changes
npm test      # node:test suite (no dependencies)
```

```
server.js          HTTP server + .env loader
src/app.js         API routes
src/workflows.js   the Top 10 catalog, scripts, objections, onboarding fields
src/leads.js       Google Places search, demo leads, lead scoring
src/setup.js       deal building, Stripe checkout, signed webhooks
src/provision.js   one-button setup engine: Stripe → GoHighLevel sub-account + custom values + login → Retell AI receptionist + number → welcome email
src/drip.js        email drip sequences + Brevo/Resend sending + unsubscribe
src/pricing.js     profit math (setup commission is one-time, 10%)
scripts/setup.js   interactive .env wizard (used by install.sh)
src/game.js        points, levels, badges, leaderboard
src/auth.js        PIN login + sessions
public/            dashboard (index.html, app.js, styles.css, fx.js) + client onboarding + unsubscribe pages
docs/              SETUP-GUIDE.md (free tiers) · PRICING-RESEARCH.md (market vs. our prices)
```

Security notes: PINs are hashed with scrypt, and logins lock for 5 minutes after 5 wrong PINs. API keys never leave the server. Onboarding links use random 128-bit tokens. Use HTTPS in production.
