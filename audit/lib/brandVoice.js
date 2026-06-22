// Brand-voice linter — runs against any generated customer-facing copy (email hooks,
// mini-audits) and returns a list of violations. An empty array means the copy passes.

// Matches emoji ranges without relying on the Unicode property escape (kept simple/portable).
const EMOJI_REGEX = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

const BANNED_PHRASES = [
  { phrase: /\bbot\b/i, message: 'uses "bot" — Nora must be referred to as an "AI agent"' },
  { phrase: /\bbusiness days?\b/i, message: 'uses "business day(s)" — banned phrase' }
];

// A line is treated as a heading if it's markdown heading syntax (#, ##, etc.) or a short
// standalone line followed by a blank line / colon, then checked for Title Case.
function extractHeadings(text) {
  const lines = text.split('\n');
  const headings = [];
  for (const line of lines) {
    const mdHeading = line.match(/^#{1,6}\s+(.+)$/);
    if (mdHeading) headings.push(mdHeading[1].trim());
  }
  return headings;
}

function isTitleCase(line) {
  const words = line.split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  if (words.length < 2) return false;
  const capitalizedWords = words.filter((w) => /^[A-Z]/.test(w));
  // Allow leading word + proper nouns; flag only if the majority of words are capitalized,
  // which indicates Title Case rather than sentence case.
  return capitalizedWords.length / words.length > 0.6;
}

export function lintBrandVoice(text) {
  const violations = [];

  if (EMOJI_REGEX.test(text)) {
    violations.push('contains an emoji — emojis are not allowed in any generated copy');
  }

  for (const { phrase, message } of BANNED_PHRASES) {
    if (phrase.test(text)) violations.push(message);
  }

  for (const heading of extractHeadings(text)) {
    if (isTitleCase(heading)) {
      violations.push(`heading "${heading}" appears to be Title Case — use sentence case`);
    }
  }

  return violations;
}

export function assertBrandVoice(text, label = 'copy') {
  const violations = lintBrandVoice(text);
  if (violations.length > 0) {
    throw new Error(`Brand voice violations in ${label}: ${violations.join('; ')}`);
  }
}
