'use strict';
// The three agents: Prompt Coach, Security Agent, Model Tracker.

const FORMAT_WORDS = /\b(table|json|bullet|bullets|list|markdown|csv|summary|paragraphs?|steps|outline|code block|yaml)\b/i;
const LENGTH_WORDS = /\b(\d+\s*(words?|sentences?|bullets?|paragraphs?|items?|lines?)|brief|concise|short|detailed)\b/i;
const ROLE_WORDS = /\b(act as|you are|as an? (expert|senior|professional)|role:|persona)\b/i;
const AUDIENCE_WORDS = /\b(for (a|an|our|my|the) [a-z ]{3,30}|audience|reader|user|student|staff|faculty|customer|client|executive|beginner)\b/i;
const CONTEXT_WORDS = /\b(context|background|given|based on|using the|our (team|product|company)|attached|below)\b/i;
const CONSTRAINT_WORDS = /\b(do not|don't|avoid|must|only|no more than|at least|exclude|include)\b/i;
const VAGUE_WORDS = /\b(something|stuff|things|anything|whatever|nice|good|better|some)\b/i;

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function coach(text) {
  const t = (text || '').trim();
  const words = t ? t.split(/\s+/).length : 0;
  const sentences = t.split(/[.!?\n]+/).filter(s => s.trim().length > 2).length;
  const hasFormat = FORMAT_WORDS.test(t);
  const hasLength = LENGTH_WORDS.test(t);
  const hasRole = ROLE_WORDS.test(t);
  const hasAudience = AUDIENCE_WORDS.test(t);
  const hasContext = CONTEXT_WORDS.test(t) || words > 45;
  const hasConstraints = CONSTRAINT_WORDS.test(t);
  const vague = VAGUE_WORDS.test(t);
  const structured = /\n\s*[-*\d]/.test(t) || /:\s*\n/.test(t);

  let clarity = 55 + (sentences > 0 ? 12 : 0) + (words >= 8 ? 12 : -12) + (vague ? -18 : 10);
  if (words > 260) clarity -= 10;
  let context = 45 + (hasContext ? 30 : 0) + (hasAudience ? 12 : 0) + clamp(words / 6, 0, 14);
  let specificity = 45 + (hasLength ? 16 : 0) + (hasConstraints ? 14 : 0) + (vague ? -22 : 12) + clamp(words / 8, 0, 14);
  let structure = 50 + (structured ? 26 : 0) + (sentences > 1 ? 10 : -6) + (hasRole ? 8 : 0);
  let output_instructions = 42 + (hasFormat ? 34 : 0) + (hasLength ? 16 : 0) + (hasConstraints ? 6 : 0);

  const sub = {
    clarity: Math.round(clamp(clarity, 5, 100)),
    context: Math.round(clamp(context, 5, 100)),
    specificity: Math.round(clamp(specificity, 5, 100)),
    structure: Math.round(clamp(structure, 5, 100)),
    output_instructions: Math.round(clamp(output_instructions, 5, 100))
  };
  const score = Math.round(
    sub.clarity * 0.24 + sub.context * 0.2 + sub.specificity * 0.24 +
    sub.structure * 0.12 + sub.output_instructions * 0.2
  );

  const gaps = [];
  if (!hasFormat) gaps.push({ kind: 'output_format', text: 'No output format requested.', add: 'Return the answer as a short bulleted list.' });
  if (!hasLength) gaps.push({ kind: 'length', text: 'No length or depth constraint.', add: 'Keep it under 150 words.' });
  if (!hasAudience) gaps.push({ kind: 'audience', text: 'No audience or tone given.', add: 'Write for a non-technical reader in a plain, confident tone.' });
  if (!hasContext) gaps.push({ kind: 'context', text: 'Little background for the model to work from.', add: 'Context: ' });
  if (vague) gaps.push({ kind: 'vague', text: 'Vague wording ("something", "stuff", "nice") weakens the result.', add: '' });
  if (!hasRole && words < 25) gaps.push({ kind: 'role', text: 'No role given for the model.', add: 'Act as an experienced analyst.' });

  return { score, sub, gaps, words };
}

function buildRevision(text, result) {
  let out = (text || '').trim();
  const additions = result.gaps.filter(g => g.add && g.kind !== 'context').map(g => g.add);
  if (!additions.length) return null;
  if (!/[.!?]$/.test(out)) out += '.';
  return out + ' ' + additions.join(' ');
}

const DETECTORS = [
  { id: 'email', label: 'Email address', cls: 'PII', severity: 'warn', re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g, token: '[EMAIL]' },
  { id: 'phone', label: 'Phone number', cls: 'PII', severity: 'warn', re: /\+?\d[\d ().-]{8,}\d/g, token: '[PHONE]' },
  { id: 'ssn', label: 'National ID / SSN', cls: 'PII', severity: 'block', re: /\b\d{3}-\d{2}-\d{4}\b/g, token: '[NATIONAL_ID]' },
  { id: 'card', label: 'Payment card number', cls: 'PII', severity: 'block', re: /\b(?:\d[ -]*?){13,16}\b/g, token: '[CARD]' },
  { id: 'account', label: 'Account identifier', cls: 'PII', severity: 'warn', re: /\b(?:acct|account)[\s#:-]*[A-Z0-9-]{4,}\b/gi, token: '[ACCOUNT_ID]' },
  { id: 'openai_key', label: 'API key', cls: 'Credentials', severity: 'block', re: /\bsk-[A-Za-z0-9_-]{16,}\b/g, token: '[API_KEY]' },
  { id: 'github_token', label: 'Access token', cls: 'Credentials', severity: 'block', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, token: '[TOKEN]' },
  { id: 'aws_key', label: 'Cloud access key', cls: 'Credentials', severity: 'block', re: /\bAKIA[0-9A-Z]{16}\b/g, token: '[AWS_KEY]' },
  { id: 'bearer', label: 'Bearer token', cls: 'Credentials', severity: 'block', re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g, token: '[TOKEN]' },
  { id: 'pem', label: 'Private key material', cls: 'Credentials', severity: 'block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, token: '[PRIVATE_KEY]' },
  { id: 'conn', label: 'Connection string', cls: 'Credentials', severity: 'block', re: /\b(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/g, token: '[CONNECTION_STRING]' },
  { id: 'confidential', label: 'Confidential marking', cls: 'Confidential data', severity: 'warn', re: /\b(confidential|internal only|do not distribute|proprietary|under nda|trade secret)\b/gi, token: null },
  { id: 'injection', label: 'Possible prompt injection', cls: 'Prompt injection', severity: 'warn', re: /\b(ignore (all )?(previous|prior|above) instructions|disregard your (rules|instructions)|you are now in developer mode|reveal your system prompt)\b/gi, token: null }
];

function security(text, policy) {
  const t = text || '';
  const findings = [];
  let redacted = t;
  for (const d of DETECTORS) {
    const matches = t.match(d.re);
    if (!matches || !matches.length) continue;
    findings.push({ id: d.id, label: d.label, class: d.cls, severity: d.severity, count: matches.length });
    if (d.token) redacted = redacted.replace(d.re, d.token);
  }
  const weight = { block: 26, warn: 11 };
  const risk = Math.min(100, findings.reduce((a, f) => a + weight[f.severity] * Math.min(f.count, 3), 0));
  const score = 100 - risk;

  let action = 'allow';
  if (findings.some(f => f.severity === 'block')) action = 'block';
  else if (findings.length) action = policy && policy.auto_redact === false ? 'warn' : 'redact';
  if (policy && policy.mode === 'observe' && action !== 'block') action = findings.length ? 'warn' : 'allow';

  return { score, risk, findings, action, redacted, rule_version: '2026.09.1' };
}

const MODELS = {
  'chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini', 'bard.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot', 'github.com': 'Copilot',
  'perplexity.ai': 'Perplexity', 'www.perplexity.ai': 'Perplexity'
};

function track(host, modelHint) {
  const application = MODELS[host] || (host ? host.replace(/^www\./, '') : 'Unknown');
  return { application, model: modelHint || application + ' (default)', host: host || null };
}

module.exports = { coach, buildRevision, security, track, DETECTORS };
