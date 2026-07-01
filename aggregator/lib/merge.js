/**
 * aggregator/lib/merge — light mail-merge for aggregator email templates.
 * Replaces {{field}} tokens; unknown tokens are left blank (never leak braces
 * into a sent/drafted email).
 */

function mergeFields(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] !== undefined && vars[key] !== '' ? vars[key] : ''));
}

function pickVariant(variants, seedKey) {
  if (variants.length === 1) return variants[0];
  let hash = 0;
  for (const ch of seedKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return variants[hash % variants.length];
}

module.exports = { mergeFields, pickVariant };
