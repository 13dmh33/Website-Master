/**
 * aggregator/lib/csv — CSV export helpers for scraped aggregator orgs.
 */

function csvEscape(val) {
  const s = (val === undefined || val === null) ? '' : String(val);
  return `"${s.replace(/"/g, '""')}"`;
}

const SCHEMA_FIELDS = [
  'source_type', 'org_name', 'contact_email', 'role_tag', 'website',
  'phone', 'city', 'state', 'program_type', 'track_link', 'notes'
];

function exportOrgsToCsv(orgs) {
  const header = SCHEMA_FIELDS.join(',');
  const rows = orgs.map((o) => SCHEMA_FIELDS.map((f) => csvEscape(o[f])).join(','));
  return [header, ...rows].join('\n');
}

function exportNeedsEmailToCsv(orgs) {
  const header = 'org_name,website,source_type';
  const rows = orgs.map((o) => [csvEscape(o.org_name), csvEscape(o.website), csvEscape(o.source_type)].join(','));
  return [header, ...rows].join('\n');
}

module.exports = { SCHEMA_FIELDS, exportOrgsToCsv, exportNeedsEmailToCsv };
