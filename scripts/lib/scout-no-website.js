/**
 * scout-no-website — the original Scout filter/scoring logic (gap_score),
 * extracted unchanged from scripts/scout.js so it can be unit-tested and
 * reused by the --mode dispatcher. No behavior change from the pre-refactor
 * inline implementation — see scout-no-website.golden.json for the lock.
 */

const { slugify, channelForTrade, isSocialOnlySite } = require('./scout-shared');

function scoreGap(result) {
  let score = 0;

  // No website → core signal; filter already guarantees this but score it
  if (!result.site || result.site.trim() === '') score += 3;

  // Review sweet spot (visible enough to trust, not dominant market leader)
  const reviews = result.reviews || 0;
  if      (reviews >= 10 && reviews <= 30)  score += 4;
  else if (reviews >= 31 && reviews <= 80)  score += 3;
  else if (reviews >= 81 && reviews <= 150) score += 2;
  else if (reviews > 150)                   score += 1;

  // Rating quality
  const rating = result.rating || 0;
  if      (rating >= 4.8) score += 2;
  else if (rating >= 4.5) score += 1;

  // Email present signals more complete listing (rare for contractors)
  if (result.email && result.email.trim() !== '') score += 1;

  return Math.min(score, 10);
}

function filterAndFormatNoWebsite(results, tradeStr, cityStr, knownIds, minScore) {
  const channel = channelForTrade(tradeStr);

  let disc = { reviews: 0, rating: 0, website: 0, noPhone: 0, duplicate: 0, lowScore: 0 };
  const leads = [];

  for (const r of results) {
    // Skip already-known leads (pre-dedup from existing files)
    const pid = r.place_id;
    if (pid && knownIds.has(pid)) { disc.duplicate++; continue; }

    if (!r.reviews || r.reviews < 5 || r.reviews > 300) { disc.reviews++; continue; }
    if (!r.rating  || r.rating  < 4.0)                  { disc.rating++;  continue; }
    if (!r.phone   || r.phone.trim() === '')             { disc.noPhone++; continue; }

    // Filter out businesses with a real website (social-only "sites" are not disqualifying)
    const hasSite = r.site && r.site.trim() !== '' && !isSocialOnlySite(r.site);
    if (hasSite) { disc.website++; continue; }

    const gap = scoreGap(r);
    if (gap < minScore) { disc.lowScore++; continue; }

    leads.push({
      lead_id:       r.place_id || `${slugify(r.name)}-${slugify(cityStr)}`,
      business_name: r.name || '',
      trade:         tradeStr,
      city:          cityStr,
      years_on_maps: null,
      review_count:  r.reviews   || 0,
      rating:        r.rating    || 0,
      website:       r.site      || null,
      email:         r.email     ? r.email.trim() : '',
      phone:         r.phone     || '',
      address:       r.full_address || '',
      place_id:      r.place_id  || null,
      subtypes:      Array.isArray(r.subtypes) ? r.subtypes : (r.subtypes ? [r.subtypes] : []),
      latitude:      r.latitude  || null,
      longitude:     r.longitude || null,
      gap_score:     gap,
      channel,
      notes:         '',
      scraped_at:    new Date().toISOString()
    });
  }

  leads.sort((a, b) => b.gap_score - a.gap_score);

  return { leads, disc, channel };
}

function exportToCsv(leads) {
  const header = 'business_name,trade,city,phone,email,review_count,rating,gap_score,channel,address';
  const rows = leads.map(l => [
    `"${l.business_name.replace(/"/g, '""')}"`,
    l.trade, l.city, l.phone, l.email,
    l.review_count, l.rating, l.gap_score, l.channel,
    `"${l.address.replace(/"/g, '""')}"`
  ].join(','));
  return [header, ...rows].join('\n');
}

module.exports = { scoreGap, filterAndFormatNoWebsite, exportToCsv };
