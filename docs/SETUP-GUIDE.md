# 🧭 The SalesBoard Setup Walkthrough

**Read this like a recipe.** Do one part at a time, top to bottom. Every part ends with a ✅ check so you know it worked before you move on.

- ⏱️ **Total time:** about one afternoon (plus waiting time for some approvals).
- 🌐 **You already have a domain.** Everywhere you see `yourdomain.com`, type your real domain instead.
- 🔑 **Keys are like passwords.** Never post them in a chat, a screenshot or an email. You'll paste them into SalesBoard and nowhere else.
- 🚀 **SalesBoard keeps score for you.** After Part 3, open **Manager → 🚀 Launch**. It turns each step green as you finish it.

---

## 🎯 What you're building

When one of your sales reps gets a "yes", they:

1. Press **🎉 THEY SAID YES!**
2. Tick the boxes for what the client agreed to (and the AI upgrade, if they want it)
3. Press **🚀 SET IT ALL UP**

…and SalesBoard does all of this by itself, while the rep watches each step turn ✅:

| Step | Done by |
|---|---|
| Saves the deal and locks in the rep's commission | SalesBoard |
| Makes a payment link for the client | Stripe |
| Builds the client their own account from your template | GoHighLevel |
| Fills in their business name, phone, review link… and switches ON only the workflows they bought | GoHighLevel |
| Creates a login so the owner can see their leads and texts | GoHighLevel |
| Builds their AI receptionist and buys them a local phone number | Retell |
| Emails them a welcome note + a 3-minute setup form | Brevo |
| Texts them reminders until the setup form is done | GoHighLevel |
| Pays the rep's commission to their card once the client pays | Stripe (instant pay) |

When the client fills in the setup form, their hours, services and FAQs flow into their account and their AI receptionist automatically.

**Two things a computer is not allowed to do for you.** Your team handles these from the checklist:
- Registering a business for texting. US phone carriers make every business register ("A2P 10DLC"), and approval takes a few days.
- The client turning on call forwarding on their own phone.

---

## 🛒 Part 1: Make your accounts (20 minutes)

Open each website, click **Sign up**, and make an account with your business email. Write each one down in a notebook or password manager.

| ✔ | Website | What it's for | Cost |
|---|---|---|---|
| ☐ | **cloudflare.com** | Connects your domain to everything | Free |
| ☐ | **cloud.google.com** | The computer SalesBoard lives on, plus Google leads | Free tier (needs a card) |
| ☐ | **brevo.com** | Sends the emails | Free (300 emails a day) |
| ☐ | **stripe.com** | Collects the money | Free, small fee per payment |
| ☐ | **gohighlevel.com** | Builds and runs every client's account | **Agency Pro** plan ($497/month, has a free trial) |
| ☐ | **retellai.com** | AI receptionists | Pay as you go (about 10–30¢ per call minute) |
| ☐ | **console.anthropic.com** *(optional)* | AI-written call openers | Pay as you go (well under 1¢ per opener) |

> 💡 **Why the Agency Pro plan?** GoHighLevel only lets outside apps like SalesBoard create client accounts on its Agency Pro plan. That's what makes the one button work. The prices already cover it: about 4 live workflows pay for the plan.

✅ **Check:** you can log in to all six websites.

---

## 🌐 Part 2: Put your domain on Cloudflare (15 minutes + waiting)

Cloudflare becomes the "phone book" for your domain. It's free, and it makes the next steps easy.

1. Log in to **Cloudflare** → click **Add a domain** (or **Add site**).
2. Type `yourdomain.com` → **Continue** → pick the **Free** plan.
3. Cloudflare scans your domain and copies your existing settings. **If your domain already has a website or email**, look down the list and make sure those records are there. Then click **Continue**.
4. Cloudflare shows you **two nameservers**. They look like `anna.ns.cloudflare.com` and `bob.ns.cloudflare.com`. Keep this page open.
5. Open a new tab and log in where you **bought** your domain (GoDaddy, Namecheap, Squarespace, etc.).
6. Find **Nameservers** (usually under *Domain settings* or *DNS*). Choose **Custom nameservers**, delete the old ones, and paste Cloudflare's two. **Save**.
7. Go back to Cloudflare and click **Done, check nameservers**.

✅ **Check:** within a few hours (sometimes minutes), Cloudflare emails you that your domain is **Active**. You can keep going while you wait.

---

## 💻 Part 3: Turn on your free server and install SalesBoard (20 minutes)

You're renting a small free computer from Google that stays on 24/7.

1. Go to **console.cloud.google.com**. If it asks, create a **project** (name it `salesboard`) and add a **billing account** (your card). You won't be charged for this computer.
2. In the search bar at the top, type **VM instances** and click it. If asked, click **Enable** for Compute Engine and wait a minute.
3. Click **Create instance** and set:
   - **Name:** `salesboard`
   - **Region:** `us-east1` (or `us-central1` or `us-west1`. **Only these three are free!**)
   - **Machine type:** `e2-micro`
   - **Boot disk** → **Change** → **Ubuntu**, version **24.04 LTS**, disk type **Standard persistent disk**, size **30** GB → **Select**
4. Click **Create**. Wait until there's a green ✔ next to it.
5. Click the **SSH** button on that row. A black window opens. That's your server!
6. Click inside the black window, paste this whole block, and press **Enter**:
   ```bash
   sudo apt update && sudo apt install -y git
   git clone https://github.com/tidewaterrepair-code/sales-board.git
   cd sales-board
   bash install.sh --service
   ```
7. It asks you questions. **For now, just press Enter on every question.** You'll add the keys later.

✅ **Check:** you see `Running as a service → http://localhost:3000`. SalesBoard is running! (You can't visit it yet. That's Part 4.)

> 🔒 **It asks for a GitHub username and password?** That means your code is private. Type your GitHub username. For the password, use a token: on github.com go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**, give it **read-only "Contents"** access to the `sales-board` repo, and paste that token as the password.
>
> 🆘 **Black window closed?** Just click **SSH** again and type `cd sales-board` to get back.

---

## 🔗 Part 4: Give SalesBoard your web address (15 minutes)

You'll make **https://board.yourdomain.com** open SalesBoard. (Your domain must be **Active** in Cloudflare first, from Part 2.)

1. In **Cloudflare**, click **Zero Trust** in the left menu (pick the free plan if it asks).
2. Go to **Networks → Tunnels** → **Create a tunnel** → choose **Cloudflared** → name it `salesboard` → **Save**.
3. Cloudflare asks what computer you have. Click **Debian** and **64-bit**. It shows a command in a box. **Copy it.**
4. Go back to the **SSH black window**, paste the command, press **Enter**. Wait until it finishes.
5. Back in Cloudflare, the tunnel says **Connected**. Click **Next**.
6. Fill in the **Public hostname**:
   - **Subdomain:** `board`
   - **Domain:** `yourdomain.com`
   - **Type:** `HTTP`
   - **URL:** `localhost:3000`
7. Click **Save**.
8. Tell SalesBoard its new address. In the SSH window, type:
   ```bash
   npm run setup
   ```
   Press **Enter** for each question until you reach **Public web address**. Type `https://board.yourdomain.com` and press Enter, then press Enter for the rest. Then restart SalesBoard:
   ```bash
   sudo systemctl restart salesboard
   ```

✅ **Check:** open **https://board.yourdomain.com** on your phone. You see the SalesBoard welcome screen. Create your **manager** account (your name + a PIN you'll remember). You land on **Manager → 🚀 Launch**, and step 1 is green ✅.

---

## 🔒 Part 4b: Lock the door with Cloudflare Access (15 minutes, free)

Right now anyone on the internet can reach your login screen. This adds a second lock: people must prove their email before they even see SalesBoard. Clients still open their own links without a login.

1. **Cloudflare → Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. **Application name:** `SalesBoard`. **Domain:** subdomain `board`, domain `yourdomain.com`. **Session duration:** 1 month.
3. **Add a policy:** name `Team`, action **Allow**, **Include → Emails** → type each teammate's email (or **Emails ending in** `@yourdomain.com`). Save.
4. Login methods: leave **One-time PIN** on (they type their email, get a code, done).
5. Now let clients, Stripe and Retell through. Create **one more Self-hosted application** named `SalesBoard public` with these paths (click **+ Add path** for each), all on `board.yourdomain.com`:
   - `onboard` · `unsubscribe` · `api/onboard` · `api/unsubscribe` · `api/hooks`

   Policy: name `Everyone`, action **Bypass**, **Include → Everyone**. Save.

✅ **Check:** open `https://board.yourdomain.com` in a private window. Cloudflare asks for your email first. Then open any client setup link: it opens with no login.

---

## 🔎 Part 5: Google leads (10 minutes)

1. Go to **console.cloud.google.com** (same project as Part 3).
2. In the top search bar, type **Places API (New)** → click it → **Enable**.
3. In the top search bar, type **Credentials** → click **Create credentials** → **API key**. **Copy the key** (it starts with `AIza`).
4. Click **Edit API key** (or the key's name):
   - Under **API restrictions** → **Restrict key** → tick only **Places API (New)**.
   - **Save**.
5. Protect your wallet: search **Budgets & alerts** → **Create budget** → amount **$1** → keep the email alerts on → **Finish**.

   > Google gives you **1,000 free lead searches every month**. SalesBoard counts them and stops at 1,000 so you don't get a bill.
6. In the **SSH window**: `cd ~/sales-board && npm run setup`. Paste the key at **Google Places API key**, press Enter for the rest, then `sudo systemctl restart salesboard`.

✅ **Check:** in SalesBoard → **🔎 Find Leads**, the "practice mode" banner is gone and you see real local businesses.

---

## 📧 Part 6: Email with your domain (20 minutes + waiting)

1. Log in to **Brevo** → click your name (top right) → **Senders, Domains & Dedicated IPs** → **Domains** → **Add a domain** → type `yourdomain.com`.
2. Brevo shows a few **DNS records** (each has a *Type*, a *Name/Host* and a *Value*).
   - If Brevo offers a button to **authenticate automatically with Cloudflare**, click it. Done!
   - Otherwise, open **Cloudflare → your domain → DNS → Records** and click **Add record** for each one. Copy the **Type**, **Name** and **Content/Value** exactly from Brevo, then **Save**.
3. Back in Brevo, click **Authenticate**. Wait until everything shows green (can take up to an hour).
4. **Senders** tab → **Add a sender** → name: your company, email: `hello@yourdomain.com`.
5. Click your name → **SMTP & API** → **API Keys** → **Generate a new API key** → name it `salesboard` → **copy it** (starts with `xkeysib-`).
6. SSH window: `cd ~/sales-board && npm run setup`. Paste the key at **Brevo API key**, then `sudo systemctl restart salesboard`.
7. In SalesBoard → **Manager → 📧 Email Drip**, fill in:
   - **From email:** `hello@yourdomain.com`
   - **Business mailing address:** your real address (the law says every email needs one; a PO box is fine)
   - Click **Save**, then **Send test** to your own email.

✅ **Check:** the test email lands in your inbox (not spam). The Launch checklist shows email ✅.

---

## 💳 Part 7: Get paid with Stripe (15 minutes)

1. Log in to **Stripe**. Make sure the **Test mode** switch (top right) is **ON** for now.
2. Click **Developers** → **API keys** → next to **Secret key** click **Reveal** → **copy it** (starts with `sk_test_`).
3. Still in Developers, click **Webhooks** → **Add endpoint**:
   - **Endpoint URL:** `https://board.yourdomain.com/api/hooks/stripe`
   - **Select events** → search `checkout.session.completed` → tick it → **Add endpoint**
   - On the next page, click **Reveal** under **Signing secret** → **copy it** (starts with `whsec_`).
4. SSH window: `cd ~/sales-board && npm run setup`. Paste the **Stripe secret key** and the **webhook signing secret**, then `sudo systemctl restart salesboard`.

✅ **Check:** the Launch checklist shows Stripe ✅. (You'll test a payment in Part 11.)

## ⚡ Part 7b: Instant pay for your reps (10 minutes)

This lets each rep get their commission on their debit card (a **Cash App Card** works if Stripe accepts it) within minutes of the client paying. It uses **Stripe Connect**.

1. In **Stripe**, click **Connect** in the left menu → **Get started**. When asked how you'll use Connect, choose the option for **paying out to people/contractors** (Express accounts). Finish the short platform questions.
2. Stripe's Connect fees: about **$2 per active rep per month + 0.25% + 25¢ per payout**, plus a small fee for *instant* payouts (Stripe shows the exact amount). Standard payouts (1–2 days) have no instant fee.
3. **Each rep:** SalesBoard → **💰 My Money** → **⚡ Set up instant pay** → Stripe asks for their name, birthday, last 4 of their SSN (for tax forms) and their **debit card** → done. Their money page then says **✅ Ready**.

How it works: when a client pays, the commission goes out automatically as soon as the money is available in your Stripe balance. Card payments usually take about 2 business days to clear. **Want it truly instant from day one?** In Stripe go to **Balances → Add to balance** and keep a small cushion (for example $500) so payouts don't wait for the client's money to clear.

> 💚 **Rather use Cash App?** Reps can also save their **$cashtag** on the My Money page. In **Manager → 👥 Team & Payouts** you'll see a green **Pay on Cash App** button that opens Cash App with the amount filled in. Send it, then tap **Mark paid**. (Cash App doesn't let apps send money automatically, so this one is a tap.)

> 🧾 **All sales are final:** your no-refund policy is shown right above the Pay button on every Stripe checkout, on the client's setup page, and reps are prompted to say it before pressing SET IT ALL UP. Change the wording in **Manager → ⚙️ Settings**.

---

## 🏢 Part 8: GoHighLevel, the engine that builds client accounts (1–2 hours, done once)

This is the biggest part, but you only do it once.

### 8a. Build your template (the "snapshot")
A snapshot is a **master copy**: one client account with all 10 workflows already built. SalesBoard copies it for every new client.

👉 Follow **[GHL-SNAPSHOT.md](GHL-SNAPSHOT.md)**. It's a step-by-step list of exactly what to create.

### 8b. Get your Private Integration key
1. In GoHighLevel, make sure you're in **Agency view** (top left switcher).
2. **Settings** → **Private Integrations** → **Create new Integration**.
3. Name: `SalesBoard`. Tick these permissions (scopes):
   - `locations.write` and `locations.readonly` (create client accounts)
   - `locations/customValues.write` and `locations/customValues.readonly` (fill in business details + switches)
   - `users.write` and `users.readonly` (create the owner's login)
   - `snapshots.readonly` (let SalesBoard see your templates)
   - `oauth.write` and `oauth.readonly` (let SalesBoard work inside each client account)
4. **Create** → **copy the key** (starts with `pit-`). You only see it once!

### 8c. Find your Company ID
In **Agency view** → **Settings** → **Company** (or **Business Profile**), look for **Company ID** and copy it.
> Can't find it? Open the chat bubble in GoHighLevel and ask support: *"Where do I find my agency Company ID for the API?"*

### 8d. Plug it in
1. SSH window: `cd ~/sales-board && npm run setup`. Paste the **GoHighLevel Private Integration key** and the **Company ID**, then `sudo systemctl restart salesboard`.
2. In SalesBoard → **Manager → 🚀 Launch** → click **📋 Show my GoHighLevel templates** → pick your snapshot → **Save**.

### 8e. (Nice to have) Let clients log in at app.yourdomain.com
1. GoHighLevel **Agency view** → **Settings** → **Company** → **Whitelabel domain** → type `app.yourdomain.com`. GoHighLevel shows a **CNAME** value to point at.
2. In **Cloudflare → DNS → Records → Add record**: Type `CNAME`, Name `app`, Target = the value GoHighLevel showed, and click the orange cloud so it turns **grey (DNS only)** → **Save**.
3. In SalesBoard → **Manager → ⚙️ Settings** → **Client login link** → `https://app.yourdomain.com` → **Save**.

✅ **Check:** the Launch checklist shows GoHighLevel ✅ and template ✅.

---

## 🤖 Part 9: Retell, the AI receptionists (10 minutes)

1. Log in to **Retell** → add a payment card in **Billing** (it's pay as you go).
2. Find **API Keys** in the menu → **copy your key**.
3. SSH window: `cd ~/sales-board && npm run setup`. Paste it at **Retell API key**, then `sudo systemctl restart salesboard`.

✅ **Check:** the Launch checklist shows Retell ✅.

Retell will now report every AI receptionist call back to SalesBoard, so you can see minutes used per client. You'll get a warning when a client passes 80% of their included minutes.

## ✨ Part 9b: AI-written openers (optional, 5 minutes)

Reps get a **✨ Write my opener** button on the call screen. It reads the business's Google reviews and writes a personal first line.

1. Go to **console.anthropic.com** → sign up → **Billing** (add a card; each opener costs well under a cent) → **API Keys** → **Create Key** → copy it (starts with `sk-ant-`).
2. SSH window: `cd ~/sales-board && npm run setup`. Paste it at **Anthropic API key**, then `sudo systemctl restart salesboard`.

## 💾 Part 9c: Off-server backups (10 minutes)

SalesBoard already saves a backup on the server every night (the last 14 are kept). This copies each one somewhere safe too, in case the server ever breaks.

1. **console.cloud.google.com** → search **Buckets** → **Create**: name it something unique like `salesboard-backups-yourname`, location **Region** → the same region as your server (e.g. `us-east1`), class **Standard** → **Create**. (5 GB is free in US regions.)
2. Give your server permission to write there: **VM instances** → click `salesboard` → **Stop** → **Edit** → **Access scopes** → **Set access for each API** → **Storage: Read Write** → **Save** → **Start**.
3. SSH window: `cd ~/sales-board && npm run setup`. Type the bucket name at **Google Cloud Storage bucket**, then `sudo systemctl restart salesboard`.

✅ **Check:** **Manager → 🚀 Launch → 💾 Back up now** says "copied off-server ✅". You can also press **⬇️ Download a copy** in Settings any time.

---

## 🧪 Part 10: Make sure everything is green

Open **Manager → 🚀 Launch**. Every step except "Add your sales team" and "Do one practice close" should be ✅.

If something isn't green:
- Did you **restart** after `npm run setup`? (`sudo systemctl restart salesboard`)
- Did you paste the **whole** key, with no spaces?
- Still stuck? In the SSH window, run `sudo journalctl -u salesboard -n 50`. It shows the last 50 lines of what SalesBoard is doing, often with the exact problem.

---

## 🏁 Part 11: Add your team + do a practice close

1. **Manager → 👥 Team & Payouts** → add each rep: their **first name** and a **4-digit PIN**. Tell each rep their PIN in person.
   - Each rep, on their phone: open `https://board.yourdomain.com` → **Share** (iPhone) or **⋮** (Android) → **Add to Home Screen**. Open SalesBoard from the new icon and tap **🔔 Turn on** so they get a buzz when a callback is due and when they get paid.
   - Each rep: **💰 My Money** → set up **⚡ instant pay** (Part 7b) and/or save their **$cashtag**.
2. Do a practice close **using yourself as the client**:
   - **🔎 Find Leads** → **➕ Add a lead by hand** → use a made-up business name and **your own cell number**.
   - Press **🎉 THEY SAID YES!** → tick **24/7 AI Receptionist** + one more → type **your own name, email and cell** → **🚀 SET IT ALL UP**.
   - Watch every step turn ✅.
3. Check that it really worked:
   - 💳 Open the payment link and pay with Stripe's test card: `4242 4242 4242 4242`, any future date, any 3 digits. The deal turns **Paid**.
   - 🏢 In GoHighLevel you see a new client account with the business details filled in.
   - 📞 **Call the AI receptionist number** shown on the success screen. Talk to it!
   - 📧 You got the welcome email. Open the setup form, fill it in, and call the AI again: it now knows the hours you typed.
4. Clean up: **Manager → 📑 Deals** → open the practice deal → **✖ Cancel deal**. Then in GoHighLevel and Retell, delete the practice account and release the practice phone number so you don't pay for it.

✅ **Check:** the Launch checklist is all green. 🎉

---

## 💰 Part 12: Go live (5 minutes)

1. In **Stripe**, finish **Activate account** (it asks for your business and bank details), then turn **Test mode OFF**.
2. Repeat **Part 7** with the **live** keys (they start with `sk_live_` and a new `whsec_`).
3. Tell your reps: **"Go sell!"** 🚀

---

## 🛟 Quick fixes

| What you see | What to do |
|---|---|
| A setup step shows ⚠️ on a deal | Manager → 📑 Deals → open the deal → **🔁 Retry setup**. It only redoes the broken step. |
| "Free Google searches are used up" | That's the money-saver working. It resets next month. |
| Emails say "queued" | Manager → 📧 Email Drip tells you exactly what's missing |
| Website won't open | In the SSH window: `sudo systemctl restart salesboard`. Check the tunnel says **Healthy** in Cloudflare. |
| Want a backup | Copy `~/sales-board/data/db.json` somewhere safe every week |
| Update SalesBoard later | SSH window: `cd ~/sales-board && git pull && npm ci --omit=dev && sudo systemctl restart salesboard` |
| A rep's commission says "waiting" | The client's card payment is still clearing in Stripe (about 2 business days). It sends by itself. Keep a balance cushion (Part 7b) to skip the wait. |
| Rep isn't getting notifications | On iPhone it only works from the Home Screen icon. Have them tap 🔔 Turn on again. |
