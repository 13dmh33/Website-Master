/**
 * "Launching your trade business: first 5 steps" — master student handout.
 * Used by license_prep, sbdc_score, trade_school with a lane-specific intro
 * line and footer (set in aggregator/pdfs/build-config below). Helpful
 * first, promotional last — step 4 is Trevo's web presence, not the title.
 */

const STEPS = [
  {
    title: '1. Get licensed and bonded',
    body: 'Make sure your license, bond and insurance are squared away before you take a paying job. A skipped step here can cost a lot more than the time it takes to do it right.'
  },
  {
    title: '2. Set up the business basics',
    body: 'An EIN, a separate business bank account and a simple way to track income and expenses. None of it is exciting, but it saves a lot of pain come tax time.'
  },
  {
    title: '3. Claim your Google Business Profile',
    body: 'It is free, and it is the fastest way to show up when someone nearby searches for your trade. Fill it out completely — hours, service area, a few photos.'
  },
  {
    title: '4. Get a simple website',
    body: 'A one-page site with your phone number, service area and a few photos is enough to start. This is the step most new contractors put off the longest, and it is the one that costs the most leads while it waits.'
  },
  {
    title: '5. Start collecting reviews from day one',
    body: 'Ask every happy customer for a review while the job is still fresh in their mind. Reviews compound — the earlier you start, the further ahead you are a year from now.'
  }
];

module.exports = { TITLE: 'Launching your trade business: first 5 steps', STEPS };
