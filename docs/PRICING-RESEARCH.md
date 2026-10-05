# 💲 Pricing Research (October 2026)

**Goal:** come in slightly under the going rate while still making money on every deal, after paying the rep's commission.

**Commission rule:** the rep gets **10% of the setup fee, paid once**, when the client pays. There is no commission on monthly fees, so all monthly revenue stays with the business.

## Our prices vs. the market

| # | Workflow | Market (typical) | **Our price** | Under market by | Our delivery cost (setup / mo) | Profit on setup* | Profit per month** | Year-1 profit |
|---|---|---|---|---|---|---:|---:|---:|
| 1 | 📲 Missed-Call Text-Back | $497 + $197/mo | **$447 + $167/mo** | 10% / 15% | $126 / $35 | $263 | $127 (76%) | $1,785 |
| 2 | ⭐ 5-Star Review Engine | $397 + $199/mo | **$347 + $167/mo** | 13% / 16% | $80 / $25 | $222 | $137 (82%) | $1,864 |
| 3 | 🤖 24/7 AI Receptionist | $497 + $297/mo | **$447 + $257/mo** | 10% / 13% | $170 / $115 | $219 | $134 (52%) | $1,830 |
| 4 | ⚡ Instant Lead Responder | $597 + $197/mo | **$497 + $167/mo** | 17% / 15% | $120 / $30 | $313 | $132 (79%) | $1,895 |
| 5 | 📅 Online Booking + No-Show Killer | $397 + $129/mo | **$347 + $109/mo** | 13% / 16% | $100 / $20 | $202 | $86 (78%) | $1,228 |
| 6 | 💸 Dead Lead Reactivation | $997 + $397/mo | **$847 + $297/mo** | 15% / 25% | $200 / $45 | $537 | $243 (82%) | $3,454 |
| 7 | 💳 Text-to-Pay & Invoice Chaser | $297 + $149/mo | **$247 + $127/mo** | 17% / 15% | $80 / $20 | $135 | $103 (81%) | $1,371 |
| 8 | 📣 Social + Google Posts Autopilot | $497 + $597/mo | **$397 + $447/mo** | 20% / 25% | $150 / $90 | $195 | $344 (77%) | $4,320 |
| 9 | 📝 Estimate Follow-Up Closer | $497 + $249/mo | **$397 + $197/mo** | 20% / 21% | $100 / $25 | $245 | $166 (84%) | $2,237 |
| 10 | 🔁 Referral & Rebooking Engine | $397 + $149/mo | **$297 + $127/mo** | 25% / 15% | $80 / $20 | $178 | $103 (81%) | $1,415 |

\* Setup profit = setup fee − 10% rep commission − setup cost (labor + registration fees) − Stripe fee (2.9% + 30¢).
\*\* Monthly profit = monthly fee − tool/usage cost − Stripe fee. No commission comes out of monthly fees.

The app runs this same math live in **Manager → Pricing & Profit**. It **refuses to save a price or commission rate that would lose money**. Once you know your real tool bills, replace the cost estimates there.

## How "market" was set

| Workflow | What the market charges | Sources |
|---|---|---|
| Missed-Call Text-Back | SaaS $79–$297/mo. Agencies are told to charge clients $397–$997 | [Onvert](https://onvert.com/best-missed-call-text-back-for-home-services), [Risacare](https://risacare-demo.duckdns.org/nexa-alternative), [Ciela.ai](https://ciela.ai/agents/missed-call-text-back), [Capterra: MissedCalls](https://www.capterra.com/p/10043407/MissedCalls/) |
| Review Engine | NiceJob $75–$125/mo, Birdeye from $299/mo, Podium $399/mo | [Costbench: Birdeye](https://costbench.com/software/review-management/birdeye), [WiserNotify](https://wisernotify.com/blog/podium-alternatives/) |
| AI Receptionist | Mid-range small-business tiers $99–$299/mo, setup $0–~$500 | [Hyperleap](https://hyperleap.ai/blog/ai-receptionist-cost), [My AI Front Desk](https://www.myaifrontdesk.com/blogs/how-much-does-an-ai-receptionist-cost-a-straight-answer-for-2026), [Fasthosts](https://www.fasthosts.co.uk/blog/how-much-does-an-ai-receptionist-cost/) |
| Instant Lead Responder | Setup and integration $200–$800. Lead-response tools ~$100–$300/mo | [Clicksgeek](https://clicksgeek.com/lead-generation-campaign-setup-cost/) |
| Booking + Reminders | DIY software $12–$100/mo. Done-for-you is higher | [Capterra](https://www.capterra.com/p/10044213/AppointmentReminders-com/), [GetApp](https://www.getapp.com/all-software/a/appointment-reminder/) |
| Database Reactivation | Example: £499 setup + £399/mo, or pay-per-result | [Ciela.ai](https://ciela.ai/blogs/database-reactivation-ai-offer-for-agencies), [Seagull Solutions](https://www.seagullsolutions.it.com/) |
| Text-to-Pay | Bundled suites: Weave from $199/mo, Podium $399/mo | [Software Advice: Weave](https://www.softwareadvice.com/medical/weave-profile/), [Pabau: Podium](https://pabau.com/blog/podium-pricing/) |
| Social Autopilot | Small-business management $500–$2,000/mo | [eClincher](https://eclincher.com/articles/social-media-management-pricing-rates-and-costs-for-2026), [Boomp](https://www.boomp.net/research/social-media-management-pricing-benchmarks-local-businesses) |
| Estimate Follow-Up | ResponsiBid $199–$249/mo, Endless Leads $297/mo + $500 setup | [ResponsiBid](https://toplinepro.com/apps/responsibid), [Endless Leads](https://endlessleads.it.com/) |
| Referral & Rebooking | Usually bundled in review/retention tools ($75–$399/mo) | Same sources as the Review Engine |

These are estimates from public pricing pages and industry write-ups. Real prices vary by market, so re-check every few months.

## How "cost" was estimated

| Tool | Price used | Source |
|---|---|---|
| Twilio SMS | ~$0.011 per text including carrier fees. Local number $1.15/mo | [Twilio pricing](https://www.twilio.com/en-us/sms/pricing), [Twilio cost breakdown](https://textbee.dev/blog/twilio-pricing-real-cost-breakdown) |
| A2P 10DLC registration (required to text US numbers) | Brand $4.50–$46 one-time + campaign $10–$15/mo | [Twilio cost breakdown](https://textbee.dev/blog/twilio-pricing-real-cost-breakdown) |
| AI voice (Retell / Vapi) | ~$0.10–$0.31 per minute all-in. We assume ~$0.15 × 600 min = ~$90/mo | [Fora Soft](https://www.forasoft.com/blog/article/vapi-vs-retell-vs-custom), [Macha](https://www.getmacha.com/blog/retell-ai-vs-vapi) |
| GoHighLevel (fulfillment platform) | **$497/mo Agency Pro**. It's the only plan that lets SalesBoard create client accounts automatically (the one button). $97/$297 plans work only if your team builds accounts by hand | [Apexure](https://www.apexure.com/blog/gohighlevel-pricing), [GoHighLevel API docs](https://marketplace.gohighlevel.com/docs/ghl/locations/create-location/) |
| Retell phone numbers | Small monthly fee per number + per-minute usage | Retell dashboard |
| Stripe | 2.9% + 30¢ per card payment, no monthly fee | [Stripe fee guide](https://dodopayments.com/blogs/stripe-fees-calculator) |
| Labor | $40/hour for setup work | Estimate. Change it to your real rate |

**Fixed cost:** the GoHighLevel Agency Pro plan ($497/mo) runs every client and powers the one-button setup. With ~$155/mo average profit per live workflow, **about 4 live workflows cover it**. Everything after that is profit. Monthly costs above include a per-client platform share.

**AI upgrade:** workflows marked "No AI needed (AI add-on)" can add the AI upgrade for **+$47/mo** (our cost about $12/mo). It's monthly only, so it doesn't change the rep's setup commission.

**AI Receptionist:** the price includes up to 600 call minutes a month. Heavy users (500+ calls/month) should go on a higher tier so voice minutes don't eat the margin.

**Yearly prepay:** clients can pay for a year up front at 10× the monthly price (2 months free). Every workflow still makes a profit on yearly billing because monthly margins are 52–84%. Commission is unchanged: 10% of the setup fee, once.

**Paying reps instantly:** Stripe Connect costs about $2 per active rep per month + 0.25% + 25¢ per payout, plus Stripe's instant-payout fee. On a typical $44.70 commission that's under $2. Cash App payouts are free but take a manual tap.

**No refunds:** your policy ("All sales are final. No refunds.") is shown right above the Pay button on every Stripe checkout and on the client's setup page. That's why commission can be paid out right away (the hold is 0 days by default). Card disputes (chargebacks) can still happen, so if you see any, set a short hold in Manager → Settings.

