# Trevo Advisors — Project Overview

*Shareable summary — last updated 2026-06-22*

## What this is

Trevo Advisors builds simple, affordable websites for home service contractors (plumbing, electrical, handyman, roofing) and layers in AI add-on products. The business runs on a largely automated outreach pipeline: find contractors with weak/no web presence → diagnose their specific gap → reach out → close → build → host.

**Owner:** Dave (dave@trevoadvisors.com)
**Pricing:** $150 to build a website, $65/mo to host. AI bundles (see below) are $200 to build + $65/mo.
**Trade focus:** Plumbing (40%), Electrical (35%), Handyman (25%), Roofing (secondary). **HVAC is explicitly excluded** (conflict of interest with owner's day job).

## Products

| Product | Status | Description |
|---|---|---|
| Website | **Live** | Basic contractor website, $150 + $65/mo hosting |
| Nora | **Live** | AI voice agent — answers calls, books jobs while owner is on a job |
| Atlas | Landing page only, backend not built | AI text-reply agent — replies to inbound SMS/leads in <60 seconds, 24/7 |
| Argus | Landing page only, backend not built | AI review-response agent — replies to every Google review automatically |

Atlas and Argus are intentionally on hold — they're backend agents (not static pages) and need significant new infrastructure (per-client credentials, onboarding, isolated state) before they're sellable. Their marketing pages and checkout UI already exist; their Stripe links are placeholders pending vetting.

## How leads are found and worked (automated pipeline)

1. **Scout** — scrapes Google Business listings for contractors with no real website (5-300 reviews, 4.0+ rating), scores each by "gap" (how much they're losing by not having a site).
2. **Enricher** — finds owner emails for phone-only leads (Apollo.io).
3. **Diagnoser** — AI (Claude) writes a short, specific diagnosis of each lead's gap and picks the best outreach template.
4. **Checker** — AI quality-reviews every outbound message before it's allowed to send.
5. **Personalizer / Builder / Filmer** — generates a live demo site + screen-recorded walkthrough for top-priority leads.
6. **Pitcher** — sends the approved outreach (email first, SMS follow-up ~4 hours later).
7. **Drip** — automated 4-step follow-up sequence for non-responders.
8. **Mobile** — handles positive replies, suggests booking slots, triggers the Nora upsell 7 days after a website deal closes.
9. **Reporter / Dashboard** — daily visibility into pipeline health and spend.

This pipeline currently assumes the lead has **no existing website** — that's the only segment it's built to find, diagnose, and pitch.

## Where things stand today (2026-06-22)

- **Live and running:** Scout, Diagnoser, Checker, Pitcher, Drip, Mobile, Reporter, plus manual channels (cold calling, personal SMS, LinkedIn, referral outreach).
- **Checkout:** Website-only and Website+Nora are live with real Stripe Payment Links. Atlas/Argus checkout exists in code but isn't live (no real payment link yet).
- **New lead segment identified, not yet built:** ~100+ Colorado plumbing contractors who already HAVE a website and email — a different pitch is needed for them ("your current site is costing you" / "you may be overpaying for hosting"), instead of the "you have no website" pitch the rest of the system is built around.
- **In scoping, not built:** A "diagnostic agent" that would visit a contractor's existing website and generate a specific, credible critique to use as the hook in outreach to that new segment. Currently gathering input from a website-design professional on what's worth flagging (conversion killers, design trends, realistic hosting cost benchmarks) before any build decision.
- **Tabled for later:** "Name your price" pricing model for the basic website tier — discussed, deliberately not pursued yet.
- **Manual cleanup in progress:** Calling through existing lead lists, tagging phone numbers as good/bad and outcomes (voicemail, not interested, do not call) directly in a shared Google Sheet — purely manual right now, not yet automated.

## What's NOT done yet (known gaps)

- No outreach template exists for the "has website, has email" segment — every current template assumes the lead has no site.
- No automated site-auditing/diagnostic tool exists — would need to be built once the scoping questions above are answered.
- No phone-number validation or lead-decay automation — stale/dead leads are currently caught only by manually calling them.
- Atlas and Argus have no backend — they are not sellable products yet, despite having marketing pages.
- Twilio A2P 10DLC registration is pending carrier approval — SMS sending is otherwise functional but may be rate-limited/blocked until approved.

## Open questions for next scoping conversations

1. How rigorous should website diagnosis be — cheap automated checks (PageSpeed, mobile-friendly test) vs. AI-vision screenshot review?
2. Should cost-savings claims to prospects be specific dollar figures or general ranges?
3. What's the right outreach artifact — a short paragraph in an email, or a fuller "mini audit" as a standalone asset?
4. When (if ever) does "name your price" make sense to introduce, and for which tier?
5. When does Atlas/Argus backend development become a priority relative to the core website + has-website-pitch work?
