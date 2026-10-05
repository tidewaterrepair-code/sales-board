# 🧩 Build Your GoHighLevel Template (Snapshot)

You build this **once**. Every new client gets an exact copy, with their own details filled in, and **only the workflows they bought switched on**.

**How the magic works:** SalesBoard fills in "custom values" in each new client account. Think of them as labeled boxes. Your workflows read those boxes:
- `sb_business_name` holds the client's business name, so your texts say *"Thanks for calling Bayside HVAC!"*
- `sb_wf_review_engine` holds `on` or `off`. Your Review workflow checks this box first and stops if it says `off`.

⏱️ **Time:** 1–2 hours. Grab a snack.

---

## Step 1: Make a practice client account

1. GoHighLevel → **Agency view** → **Sub-Accounts** → **Create Sub-Account** → **Blank** (no snapshot).
2. Name it `SalesBoard Template`. Fill in anything for the address.
3. Click into the new sub-account. (Switch to it with the top-left switcher.)

---

## Step 2: Create the labeled boxes (custom values)

Inside the `SalesBoard Template` sub-account: **Settings → Custom Values → Add Custom Value**.

Create each of these. **Type the names exactly like this**, all lowercase with underscores. You can leave the value blank, or type the example.

### About the business (SalesBoard fills these in)
| Name | Example value |
|---|---|
| `sb_business_name` | Bayside HVAC |
| `sb_business_phone` | (757) 555-0100 |
| `sb_business_website` | https://bayside.com |
| `sb_business_address` | 1 Shore Dr, Norfolk, VA |
| `sb_city` | Norfolk |
| `sb_industry` | HVAC |
| `sb_owner_first_name` | Pat |
| `sb_owner_email` | pat@bayside.com |
| `sb_owner_cell` | (757) 555-0111 |
| `sb_review_link` | https://search.google.com/local/writereview?placeid=… |
| `sb_onboarding_link` | (their setup form link) |
| `sb_agency_name` | your company name |
| `sb_ai_receptionist_number` | +17575550142 |

### On/off switches (SalesBoard sets `on` for what they bought). Type `off` as the value.
| Name | Switches on… |
|---|---|
| `sb_wf_missed_call_textback` | 📲 Missed-Call Text-Back |
| `sb_wf_review_engine` | ⭐ 5-Star Review Engine |
| `sb_wf_ai_receptionist` | 🤖 AI Receptionist (built in Retell, no workflow needed) |
| `sb_wf_speed_to_lead` | ⚡ Instant Lead Responder |
| `sb_wf_booking_noshow` | 📅 Booking + No-Show Killer |
| `sb_wf_reactivation` | 💸 Dead Lead Reactivation |
| `sb_wf_text_to_pay` | 💳 Text-to-Pay & Invoice Chaser |
| `sb_wf_social_autopilot` | 📣 Social Autopilot |
| `sb_wf_estimate_followup` | 📝 Estimate Follow-Up |
| `sb_wf_referral_rebook` | 🔁 Referral & Rebooking |

### AI upgrade switches (`on` when the client paid for the AI add-on). Type `off` as the value.
`sb_ai_missed_call_textback` · `sb_ai_review_engine` · `sb_ai_speed_to_lead` · `sb_ai_estimate_followup`

### Filled in from the client's setup form (create them now, leave blank)
`sb_alert_cell` · `sb_textback_message` · `sb_hours` · `sb_services` · `sb_faqs` · `sb_transfer_number` · `sb_lead_sources` · `sb_offer` · `sb_rebook_interval` · `sb_referral_reward` · `sb_bad_review_email`

> 💡 To use a box inside a text or email, type `{{custom_values.sb_business_name}}` (or pick it from the **Custom Values** menu in the message editor).

---

## Step 3: Build the workflows

**Automation → Workflows → Create Workflow → Start from scratch.** Make one workflow per row below.

🔑 **The golden rule:** the **first step** after the trigger in every workflow is an **If/Else**:
- **Condition:** the custom value `sb_wf_…` (the switch for that workflow) **is** `on`
- **Yes branch:** the rest of the workflow
- **No branch:** nothing (the workflow ends)

> Can't find how to check a custom value in If/Else? Ask GoHighLevel's support chat: *"How do I make an If/Else check that a custom value equals 'on'?"* They'll show you in a minute.

| Workflow name | Trigger (what starts it) | Steps after the If/Else |
|---|---|---|
| **SB · Missed-Call Text-Back** | **Call Status** = missed / no answer (inbound) | **Send SMS** to the caller: *"Hi! Sorry we missed your call at {{custom_values.sb_business_name}}. How can we help?"* → **Send internal notification (SMS)** to `{{custom_values.sb_alert_cell}}` |
| **SB · Review Engine** | **Opportunity status changed → Won** (or tag `job-done` added) | **Wait** 2 hours → **Send SMS**: *"Thanks for choosing {{custom_values.sb_business_name}}! Mind leaving a quick review? {{custom_values.sb_review_link}}"* → **Wait** 2 days → **Send Email** reminder |
| **SB · Instant Lead Responder** | **Form submitted** + **Facebook Lead Form submitted** (add both triggers) | **Send SMS** right away: *"Hi {{contact.first_name}}, it's {{custom_values.sb_business_name}}! Got your request. When's a good time for a quick call?"* → **Send Email** → **Internal notification** to `{{custom_values.sb_owner_cell}}` |
| **SB · Booking Reminders** | **Customer booked appointment** | **Send SMS** confirmation → **Wait until** 24 hours before the appointment → SMS reminder → **Wait until** 2 hours before → SMS reminder |
| **SB · Reactivation** | **Contact tag added** = `reactivate` | **Send SMS**: *"Hi {{contact.first_name}}! It's {{custom_values.sb_business_name}}. {{custom_values.sb_offer}}. Want me to book you in?"* |
| **SB · Invoice Chaser** | **Invoice** sent / due | **Wait** 3 days → if unpaid: SMS reminder → **Wait** 4 days → SMS → **Wait** 7 days → Email |
| **SB · Estimate Follow-Up** | **Opportunity stage changed** → "Estimate sent" (or tag `estimate-sent`) | **Wait** 1 day → SMS → **Wait** 2 days → Email → **Wait** 4 days → SMS → **Wait** 7 days → Email. Add a **Goal: Contact replied** so it stops when they answer. |
| **SB · Referral & Rebooking** | **Opportunity status changed → Won** | **Wait** 3 days → SMS: *"Give your friends {{custom_values.sb_referral_reward}} off, and get it yourself too!"* → **Wait** (their rebook time, e.g. 180 days) → SMS: *"Time for your next visit! Book here: …"* |
| **SB · AI Upgrade** (optional) | Same triggers as above | Add a second If/Else on `sb_ai_…` = `on` → turn on **Conversation AI** for the reply |

**📣 Social Autopilot** doesn't need a workflow. Your team sets it up in **Marketing → Social Planner** (it's on their checklist).
**🤖 AI Receptionist** doesn't need a workflow. SalesBoard builds it in Retell automatically.

Click **Publish** (top right) on every workflow, so it's **ON** in the template. The `off` switches keep them quiet until a client buys them.

---

## Step 4: Save it as a snapshot

1. Switch back to **Agency view** → **Account Snapshots** (sometimes under **Settings** or the left menu) → **Create New Snapshot**.
2. Name: `SalesBoard Master`. Pick the sub-account: `SalesBoard Template`. → **Save**.

---

## Step 5: Tell SalesBoard to use it

SalesBoard → **Manager → 🚀 Launch** → **📋 Show my GoHighLevel templates** → pick **SalesBoard Master** → **Save**.

✅ **Done!** Every "SET IT ALL UP" now creates a copy of this template for the new client, fills in their boxes, and flips on just the workflows they bought.

> 🔁 **Changed a workflow later?** Update it in `SalesBoard Template`, then refresh the snapshot (**Account Snapshots → ⋮ → Refresh**). New clients get the new version. Existing clients can be updated from there too.
