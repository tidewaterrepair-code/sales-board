# 🧭 Setup Guide: Free Tiers, Step by Step

Do these in order. Each step takes 5–15 minutes. **You can start selling after Step 0.** Every other step switches on another feature, and the app works in practice mode until then.

| Step | Tool | What it powers | Free tier (Oct 2026) | Card needed? |
|---|---|---|---|---|
| 0 | This app | The whole sales board | Free and open | No |
| 1 | Google Cloud e2-micro + Cloudflare | Hosting 24/7 at a real address | e2-micro VM + 30 GB disk always free · Cloudflare Tunnel free | Google: yes |
| 2 | Google Places API | Real leads from Google Business | 1,000 searches/month free | Yes |
| 3 | Brevo (or Resend) | Email drip | Brevo 300 emails/day · Resend 100/day (3,000/mo) | No |
| 4 | Stripe | Payment links + auto "paid" | No monthly fee. 2.9% + 30¢ per payment | No (bank account to get paid) |
| 5 | Make (or Zapier) | Automatic provisioning when a deal closes | Make 1,000 credits/mo, 2 scenarios · Zapier 100 tasks/mo | No |
| — | Domain name | Professional email + web address | ~$10–15/year (not free, but needed for email) | Yes |

The tools that **deliver** the workflows to clients (GoHighLevel, Twilio texting, AI voice) are not free. Their cost is already built into the prices (see [PRICING-RESEARCH.md](PRICING-RESEARCH.md)). Sign up for those when you land your first client. See "Delivery tools" at the bottom.

---

## Step 0: Install and run (one command)

**Mac / Linux** (in the project folder):
```bash
bash install.sh
```
**Not downloaded yet?** This downloads it too:
```bash
curl -fsSL https://raw.githubusercontent.com/tidewaterrepair-code/sales-board/main/install.sh | bash
```
**Windows** (PowerShell, in the project folder):
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```
**Docker** (any OS with Docker): `docker compose up -d`

The installer gets Node.js if you don't have it, asks for your keys (press **Enter to skip** any of them), runs a self-check and starts the app at **http://localhost:3000**. Change keys later with `npm run setup`.

> If the GitHub repo is private, the `curl` line won't work. Clone the repo first (`git clone https://github.com/tidewaterrepair-code/sales-board.git`), then run `bash install.sh` inside it.

**First time in the app:** create your manager account → **Manager → Team & Payouts** → add your reps and their PINs.

---

## Step 1: Free hosting (so your team and clients can reach it)

Your reps need the app online, and clients need to open their setup and unsubscribe links. Pick one option.

### Option A (recommended): Google Cloud e2-micro (always free)
1. Go to **console.cloud.google.com** and sign in. Add a billing account (needed even for free things). New accounts also get trial credit.
2. **Compute Engine → VM instances → Create instance**:
   - Region: **us-east1**, **us-central1** or **us-west1** (only these are free)
   - Machine type: **e2-micro**
   - Boot disk: **Ubuntu 24.04 LTS**, **Standard persistent disk**, **30 GB**
   - Click **Create**.
3. Click **SSH** next to the VM. In the black window, run:
   ```bash
   sudo apt update && sudo apt install -y git
   git clone https://github.com/tidewaterrepair-code/sales-board.git && cd sales-board
   bash install.sh --service
   ```
   `--service` keeps it running 24/7 and restarts it after reboots.
4. Give it a real HTTPS address with **Cloudflare Tunnel** (free, no ports to open):
   - Fastest test: install `cloudflared` using Cloudflare's instructions (developers.cloudflare.com → Cloudflare Tunnel → Downloads), then run `cloudflared tunnel --url http://localhost:3000`. You get a random `https://….trycloudflare.com` address that changes on every restart, so use it for testing only.
   - Permanent: add your domain to a free Cloudflare account. Then go to **Zero Trust → Networks → Tunnels → Create tunnel** and run the install command it shows on the VM. Add a public hostname such as `board.yourdomain.com` → `http://localhost:3000`.
5. Run `npm run setup` and set **PUBLIC_URL** to `https://board.yourdomain.com`. Then `sudo systemctl restart salesboard`.

### Option B: Oracle Cloud Always Free
Same idea with a bigger box (Ampere A1: up to 2 CPUs / 12 GB RAM free since June 2026). Create an Ubuntu VM, then follow steps 3–5 above.

### Option C: An office computer that stays on
Run `bash install.sh` (or `install.ps1`) on it and use Cloudflare Tunnel (step 4) for the public address. It's free, but the app is down whenever that computer is off.

> Avoid hosts that wipe the disk on restart (many "free web service" plans). The app keeps its data in `data/db.json`, so you need a persistent disk. Back that file up weekly.

---

## Step 2: Google Places API (real leads)

1. In **console.cloud.google.com**, create or select a project. **Billing** must be on.
2. **APIs & Services → Library**, search **"Places API (New)"** → **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Copy it.
4. Click the key → **Restrict key**:
   - API restrictions → **Places API (New)** only
   - Application restrictions → **IP addresses** → your server's IP (from the VM page)
5. **Stay inside the free amount.** Our searches use the "Text Search Enterprise" price tier (we request phone, website and rating). Google gives **1,000 of those free each month**, then charges $35 per 1,000.
   - The app **counts every search and stops at 1,000 a month** (`GOOGLE_MONTHLY_LIMIT`). It also re-uses results when someone repeats a search within 24 hours.
   - Belt and braces: **Billing → Budgets & alerts** → create a **$1 budget** with email alerts. You can also lower the per-day request quota on the Places API **Quotas** page (about 33/day ≈ 1,000/month).
6. Run `npm run setup` and paste the key at **Google Places API key**. Restart the app.

✅ Check: **Manager → Settings** shows "live Google Business data · 0 of 1000 free searches used".

---

## Step 3: Brevo (email drip, free 300/day)

Any lead who gives a rep their email gets 5 follow-ups over 2 weeks. New customers get a welcome email plus setup-form reminders.

1. Sign up free at **brevo.com**.
2. **Verify your sending domain** (this keeps emails out of spam): **Settings → Senders, Domains & Dedicated IPs → Domains → Add a domain**. Brevo shows DNS records (DKIM, DMARC). Add them where your domain's DNS lives (Cloudflare: **DNS → Records → Add**). Wait for green checks.
3. **Settings → Senders → Add a sender** such as `hello@yourdomain.com`.
4. **SMTP & API → API Keys → Generate a new API key**. Copy it (it starts with `xkeysib-`).
5. Run `npm run setup` and paste it at **Brevo API key**. Restart.
6. In the app, go to **Manager → 📧 Email Drip** and fill in:
   - **From email**: the sender from step 3
   - **Business mailing address**: required by US anti-spam law (CAN-SPAM). A PO box works.
   - Click **Send test** and check your inbox.

**Rather use Resend?** Sign up at **resend.com** → **Domains → Add Domain** (add the DNS records) → **API Keys → Create**. Paste the `re_…` key at **Resend API key**. The free tier is 100 emails/day.

The app stops each day at the free-tier limit (Brevo 280, Resend 95) and sends the rest the next day. Every email has an unsubscribe link, and unsubscribed people are never emailed again.

---

## Step 4: Stripe (get paid)

1. Sign up at **stripe.com**. It's free, with no monthly fee. You pay 2.9% + 30¢ per card payment, and the prices already account for that.
2. Stay in **Test mode** (toggle at the top) while you practice.
3. **Developers → API keys** → copy the **Secret key** (`sk_test_…`).
4. **Developers → Webhooks → Add endpoint**:
   - URL: `https://board.yourdomain.com/api/hooks/stripe`
   - Event: `checkout.session.completed`
   - Copy the **Signing secret** (`whsec_…`).
5. Run `npm run setup` and paste both. Restart.
6. Test: close a practice deal. The success screen shows a payment link. Pay with card `4242 4242 4242 4242` (any future date, any CVC). The deal flips to **Paid** and the rep's commission to **Earned** automatically.
7. When you're ready for real money: activate your account (bank details), switch to **Live mode**, and repeat steps 3–5 with the live keys.

---

## Step 5: Make (automatic provisioning)

When a rep presses **SET IT ALL UP**, the app sends the full deal to your automation tool so setup starts on its own.

1. Sign up free at **make.com** (1,000 credits/month, 2 active scenarios).
2. **Create a new scenario → + → Webhooks → Custom webhook → Add**. Name it "SalesBoard" and **copy the URL**.
3. In the app, go to **Manager → Settings → Automation webhook URL**, paste it, **Save**, then **Send test webhook**. Make shows it received the data.
4. Add what should happen next, for example:
   - **Slack / Gmail**: "🎉 New deal: {business} bought {workflows}"
   - **Google Sheets**: add a row to your client list
   - **GoHighLevel**: create the sub-account / contact and load the snapshot for the workflows they bought
5. Turn the scenario **ON**.

The events you'll receive are `deal.created`, `onboarding.completed` (the client filled the form) and `deal.paid`. Zapier works the same way with **Webhooks by Zapier → Catch Hook** (free: 100 tasks/month, 2-step zaps).

---

## Delivery tools (not free; costs are already in the prices)

You need these to actually run the workflows for clients. Sign up when you close your first deal.

| Tool | What for | Cost |
|---|---|---|
| **GoHighLevel** | Texting, review requests, booking, follow-ups, reactivation (8 of the 10 workflows) | $97/mo (3 clients) or $297/mo (unlimited) · free trial available |
| **Twilio** (or GoHighLevel's built-in phone) | Phone numbers + texts | $1.15/number/mo + ~1.1¢ per text · A2P registration $4.50–$46 once + $10–15/mo |
| **Retell AI or Vapi** | 24/7 AI Receptionist | ~$0.10–$0.31 per call minute |

About 2 live workflows cover the GoHighLevel Unlimited plan. After that, it's profit.

---

## Quick troubleshooting

| Problem | Fix |
|---|---|
| "Free Google searches are used up" | It's protecting you from a bill. Raise `GOOGLE_MONTHLY_LIMIT` (costs $35 per extra 1,000), or wait for next month |
| Emails show "queued" but don't send | **Manager → 📧 Email Drip** shows exactly what's missing (key, sender email or address) |
| Test email lands in spam | Finish domain verification (DKIM + DMARC) in Brevo/Resend |
| Client links say localhost | Set `PUBLIC_URL` with `npm run setup`, then restart |
| Need to restart (server) | `sudo systemctl restart salesboard` · logs: `sudo journalctl -u salesboard -f` |
| Back up your data | Copy `data/db.json` somewhere safe |
