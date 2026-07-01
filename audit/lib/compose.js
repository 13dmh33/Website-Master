// Output composition — turns Module 1-3 findings into the two customer-facing drafts:
// the email hook and the one-page mini-audit. All copy generation is delegated to Claude,
// constrained by a strict system prompt, then re-checked with the brand-voice linter before
// being written to disk.

import { lintBrandVoice } from './brandVoice.js';

const BUCKET_ANGLES = {
  'diy-builder': "you're paying monthly, forever, and doing the work yourself. owning a better site outright costs about the same as a single service call.",
  'pro-maintained': 'you already paid to have this built and you keep paying a monthly retainer to maintain it. a Trevo site is a one-time cost you own outright.',
  unknown: "it's costing you leads. no price-bleed claim — not enough signal to be specific yet."
};

const COMPOSE_SYSTEM_PROMPT = (signatureName) => `You write cold outreach for Trevo Advisors, which builds one-time-cost websites for contractors and offers an optional AI add-on (Nora) separately.

Voice rules — follow exactly:
- No emojis anywhere.
- Sentence case everywhere, including headings and subject lines.
- Refer to Nora only as "an AI agent," never a "bot."
- Never write "business days."
- Never put a price in the email hook.
- Never co-pitch Nora in the email. Nora may appear only as a single soft mention inside the mini-audit, never the email.
- Tone: honest, specific, helpful, low-pressure — like one tradesperson telling another their tire is low. Critique the site, never the contractor.
- No fake scarcity. No dollar-loss claims you can't substantiate (e.g. "this is likely costing you after-hours calls" is fine; "you're losing $10,000 a month" is not).
- The only personal name allowed anywhere in the output is the signature, which must be exactly: ${signatureName}.

Output strict JSON: { "email_hook": "...", "mini_audit_markdown": "..." }`;

function buildUserPrompt({ lead, findings, bucket, visionFindings }) {
  const angle = BUCKET_ANGLES[bucket.bucket] || BUCKET_ANGLES.unknown;
  return `Business: ${lead.business_name} (${lead.trade}, ${lead.city})
Website: ${lead.url}

Bucket: ${bucket.bucket} (confidence: ${bucket.confidence}) — ${bucket.reason}
Sales angle for this bucket: ${angle}

Deterministic findings:
${JSON.stringify(findings, null, 2)}

Subjective findings from a screenshot review:
${JSON.stringify(visionFindings, null, 2)}

Write:
1. email_hook — 2 to 4 sentences. Open with the single strongest, most verifiable finding. Frame it for this bucket's angle. No price. Sign with the configured signature name only.
2. mini_audit_markdown — a one-page markdown mini-audit with: a note that a screenshot was reviewed, 3 to 5 findings each written as "problem -> why it costs you -> one-line fix", one line contrasting what a current site looks like, a price reframe matched to this bucket as the close, exactly one soft mention of Nora (the AI agent, no co-pitch), and a low-pressure call to action. Sign with the configured signature name only.`;
}

export async function composeOutputs({ lead, findings, bucket, visionFindings, anthropicClient, model = 'claude-sonnet-4-6', signatureName }) {
  if (!signatureName) {
    throw new Error('TREVO_SIGNATURE_NAME must be set — composed copy cannot be signed without it');
  }

  const response = await anthropicClient.messages.create({
    model,
    max_tokens: 1200,
    system: COMPOSE_SYSTEM_PROMPT(signatureName),
    messages: [{ role: 'user', content: buildUserPrompt({ lead, findings, bucket, visionFindings }) }]
  });

  const text = response?.content?.find((block) => block.type === 'text')?.text || '{}';
  const parsed = JSON.parse(text);

  const emailViolations = lintBrandVoice(parsed.email_hook || '');
  const auditViolations = lintBrandVoice(parsed.mini_audit_markdown || '');
  if (emailViolations.length || auditViolations.length) {
    throw new Error(
      `Composed copy failed brand-voice lint for ${lead.business_name}: ` +
      `email=[${emailViolations.join('; ')}] mini_audit=[${auditViolations.join('; ')}]`
    );
  }

  return { email_hook: parsed.email_hook, mini_audit_markdown: parsed.mini_audit_markdown };
}
