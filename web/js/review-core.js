import {readHandoff, handoffFormat} from './contribute-core.js';

export const outcomeLabels = new Map([
  ['accepted','Accepted for documentation'],
  ['needs_evidence','Needs more evidence'],
  ['open_question','Keep as an open question'],
]);
const receiptFormat = 'ose-portable-review/v1';

function bounded(value, limit, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw Error('Enter ' + label + ' (1–' + limit + ' characters).');
  return value.trim();
}

export async function fingerprint(draft) {
  // readHandoff normalizes field order. Sort citation IDs so reordering identical evidence is immaterial.
  const ids = draft.source_ids.slice().sort();
  const canonical = {...draft, source_ids:ids, source_revisions:ids.map(id => [id,draft.source_revisions[id]])};
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonical)));
  return Array.from(new Uint8Array(bytes),b => b.toString(16).padStart(2,'0')).join('');
}

export async function portableReceipt(draft, reviewer, outcome, feedback) {
  if (!outcomeLabels.has(outcome)) throw Error('Choose a review outcome.');
  return {format:receiptFormat, submitted:{format:handoffFormat,draft}, fingerprint:await fingerprint(draft),
    decision:{reviewer:bounded(reviewer,100,'your reviewer name'),outcome,feedback:bounded(feedback,3000,'review feedback'),
      decided_at:new Date().toISOString()}};
}

export async function readReceipt(text, tasks) {
  if (text.length > 140000) throw Error('Choose a review receipt smaller than 140 KB.');
  const record = JSON.parse(text);
  if (record?.format !== receiptFormat || !record.submitted || !record.decision) throw Error('Choose a portable Iconic Tutor review receipt.');
  const draft = readHandoff(JSON.stringify(record.submitted),tasks);
  if (record.fingerprint !== await fingerprint(draft)) throw Error('The handoff does not match the fingerprint recorded in this receipt.');
  const {reviewer,outcome,feedback,decided_at} = record.decision;
  if (!outcomeLabels.has(outcome) || typeof decided_at !== 'string' || decided_at.length > 40 || !Number.isFinite(Date.parse(decided_at))) {
    throw Error('The receipt has an invalid review outcome or date.');
  }
  return {draft, fingerprint:record.fingerprint,decision:{outcome,decided_at,
    reviewer:bounded(reviewer,100,'a reviewer name'),feedback:bounded(feedback,3000,'review feedback')}};
}

export function httpLink(value) {
  try {
    const url = new URL(value);
    if (['https:','http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch {}
  return '';
}
