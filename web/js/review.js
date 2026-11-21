import {consumeInvitation} from './workshop-invite.js';
import {readHandoff,readiness} from './contribute-core.js?v=review-1';
import {fingerprint, httpLink, outcomeLabels, portableReceipt} from './review-core.js';

const $ = id => document.getElementById(id);
const invitation = consumeInvitation();
const query = new URLSearchParams(location.search);
let tasks, access, current, sessionId = '', workshop = false, sequence = 0, receiptURL = '', busy = false;

function node(tag, value) {
  const el = document.createElement(tag);
  el.textContent = value;
  return el;
}
function line(parent, label, value) {
  if (!value) return;
  const p = node('p','');
  p.append(node('strong',label + ' '),document.createTextNode(value));
  parent.append(p);
}
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').dataset.error = String(error);
}
function event(fn) {
  return async e => {
    try { notice(''); await fn(e); } catch (err) { notice(err.message,true); }
  };
}
async function api(url, body) {
  const response = await fetch(url, body === undefined ? {cache:'no-store'} : {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || 'The review service is unavailable.');
  return data;
}
async function verifySession() {
  if (!workshop || !access) return;
  const status = await api('/api/credits/status');
  if (!sessionId || sessionId !== status.account_storage_id) {
    document.querySelector('main').hidden = true;
    location.reload();
    throw Error('The workshop account changed. Reopening reviews.');
  }
}
function taskLink(id) {
  const params = new URLSearchParams({task:id});
  if (query.get('project') && query.get('task') === id) params.set('project',query.get('project'));
  return 'contribute.html?' + params;
}
function reset() {
  current = null;
  $('submission').hidden = true;
  $('download-receipt').hidden = true;
  $('download-receipt').removeAttribute('href');
  if (receiptURL) URL.revokeObjectURL(receiptURL);
  receiptURL = '';
  $('decision-form').reset();
  for (const id of ['proposal','citations','effects','recorded']) $(id).replaceChildren();
}
function showLink(parent, label, url) {
  const safe = httpLink(url);
  const link = node(safe ? 'a' : 'span',label);
  if (safe) { link.href = safe; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
  parent.append(link);
}
function evidence(record, task) {
  const draft = record.draft;
  const parent = $('citations');
  const sources = record.local ? task.sources : record.sources || [];
  for (const id of draft.source_ids) {
    const saved = draft.source_revisions[id];
    const source = sources.find(s => s.id === id);
    const el = node('div',''); el.className = 'source-card';
    const label = (source?.title || id) + ' · ' + (saved || 'unknown revision');
    if (source && String(source.revision) === saved) {
      showLink(el,label,source.url);
      if (source.excerpt) el.append(node('blockquote',source.excerpt));
      if (source.applicability) el.append(node('small',source.applicability));
    } else {
      el.append(node('strong',label), node('p','The quoted source for this revision is unavailable here.'));
      if (source) showLink(el,'Inspect the available revision ' + source.revision,source.url);
    }
    if (record.changed_sources?.includes(id)) el.append(node('small','The catalog has changed since submission.'));
    parent.append(el);
  }
  if (draft.additional_source) showLink(parent,'Contributor source · ' + draft.additional_source,draft.additional_source);
  if (!parent.children.length) parent.append(node('p','This handoff has no cited evidence.'));
}
function generated(effects) {
  const parent = $('effects');
  const explanations = {
    portable:'The downloaded handoff contains the contribution draft and source revisions. Generated outputs must be reviewed in Studio.',
    first_build:'This was the first saved build available for this submission.',
    no_build:'The linked project had no generated build when submitted.',
    no_project:'This submission had no linked generated project.',
    legacy:'This submission predates generated-change snapshots.',
    compared:'Changes between the two saved builds at submission time are shown below.',
  };
  parent.append(node('p',explanations[effects?.state] || 'A generated-change snapshot is unavailable.'));
  if (effects?.after_version != null) line(parent,'Build revisions', (effects.before_version ?? 'First build') + ' → ' + effects.after_version);
  if (effects?.stale) parent.append(node('p','The saved build was out of date at submission.'));
  for (const metric of effects?.metrics || []) {
    const display = value => value == null ? 'unrecorded' : String(value) + (metric.unit ? ' ' + metric.unit : '');
    line(parent,metric.label,display(metric.before) + ' → ' + display(metric.after));
  }
  for (const item of effects?.workstreams || []) {
    const section = node('section','');
    section.append(node('h3',item.id));
    line(section,'Status', (item.before_status || 'No earlier status') + ' → ' + (item.after_status || 'No saved status'));
    if (item.changed_files?.length) line(section,'Changed files',item.changed_files.join(', '));
    for (const c of item.checks || []) {
      const result = x => x == null ? 'unrecorded' : (x ? 'passed' : 'failed');
      line(section,c.name, result(c.before) + ' → ' + result(c.after));
    }
    if (item.gaps_before?.length) line(section,'Earlier gaps',item.gaps_before.join(' · '));
    if (item.gaps_after?.length) line(section,'Remaining gaps',item.gaps_after.join(' · '));
    parent.append(section);
  }
}
function render(record) {
  reset();
  current = record;
  const task = tasks.find(t => t.id === record.task_id);
  $('submission').hidden = false;
  $('submission-title').textContent = record.task_title || task?.title || record.task_id;
  $('submission-ref').textContent = record.local ? 'Portable handoff · ' + task.module_id :
    record.module_id + ' · Round ' + record.round + ' · Submission revision ' + record.submission_version;
  $('submission-origin').textContent = record.local ? 'Local, unverified review · SHA-256 ' + record.hash :
    'Submitted ' + record.submitted_at;
  for (const id of ['back-to-task','return-task']) $(id).href = taskLink(record.task_id);
  const d = record.draft, p = $('proposal');
  line(p,'Contributor',d.contributor);
  line(p,'Applicable build or scope',d.scope);
  line(p,d.kind === 'answer' ? 'Proposed answer' : 'Open question',d.text);
  if (d.assistance) line(p,'Reported assistance',d.assistance);
  line(p,'Help needed',d.help);
  if (d.lesson_feedback) line(p,'Suggested lesson correction',d.lesson_step + ' · ' + d.lesson_feedback);
  if (record.local) {
    const issues = readiness(task,d);
    if (issues.length) line(p,'Unresolved handoff details',issues.join(' '));
  }
  evidence(record,task);
  generated(record.local ? {state:'portable'} : record.effects);
  const decision = record.decision;
  if (decision) {
    line($('recorded'),'Decision',outcomeLabels.get(decision.outcome) || decision.outcome);
    line($('recorded'),'Reviewer',decision.reviewer);
    line($('recorded'),'Recorded',decision.decided_at);
    line($('recorded'),'Feedback',decision.feedback);
  } else if (!record.local) $('recorded').textContent = 'Awaiting a reviewer decision.';
  const canDecide = !decision && (record.local || (access?.can_review && record.can_decide !== false));
  const problems = [];
  if (d.kind === 'question') problems.push('The contributor submitted an open question.');
  if (record.changed_sources?.length) problems.push('Cited sources have changed.');
  if (record.effects?.state === 'legacy') problems.push('This round predates submission snapshots.');
  if (record.effects?.stale) problems.push('The generated build needs to be refreshed.');
  if (record.local && readiness(task,d).length) problems.push('The handoff has unresolved evidence requirements.');
  $('outcome').querySelector('[value="accepted"]').disabled = problems.length > 0;
  if (problems.length && !decision && canDecide) line($('recorded'),'Acceptance unavailable.',problems.join(' '));
  $('decision-form').hidden = !canDecide;
  $('who-label').hidden = !record.local;
  $('reviewer').required = !!record.local;
  $('decide').textContent = record.local ? 'Prepare portable review receipt' : 'Record review decision';
  if (!record.local && canDecide) line($('recorded'),'Reviewing as',access.reviewer_label);
}
const root = '/api/contributions/reviews';
async function openRound(id) {
  const seq = ++sequence;
  reset();
  if (!id) return;
  const detail = await api(root + '/' + encodeURIComponent(id));
  if (seq === sequence) render(detail);
}
async function queue(id) {
  ++sequence; reset();
  const result = await api(root);
  access = result;
  $('review-queue').hidden = false;
  $('review-login').hidden = true;
  $('queue-heading').textContent = result.can_review ? 'Review submissions' : 'Your submissions';
  $('queue-note').textContent = result.can_review ? 'Choose a round to inspect its evidence and decision.' : 'Read the decision and feedback for each submitted round.';
  const rows = result.reviews.filter(r => !query.get('task') || r.task_id === query.get('task') || r.id === id);
  const select = $('round');
  select.replaceChildren(new Option(rows.length ? 'Choose a submission' : 'No submitted rounds',''));
  for (const r of rows) select.add(new Option(r.module_id + ' · ' + r.task_title + ' · ' + r.contributor + ' · round ' + r.round + ' · ' +
    (r.decision ? outcomeLabels.get(r.decision.outcome) || r.status : 'Pending'),r.id));
  const chosen = id || rows[0]?.id;
  if (chosen) { select.value = chosen; await openRound(chosen); }
  const panel = $('pilot-panel');
  if (result.can_review) {
    try { const {showPilot} = await import('./review-pilot.js'); await showPilot(panel); }
    catch { panel.hidden = true; }
  } else { panel.hidden = true; panel.replaceChildren(); }
}
$('round').onchange = event(() => openRound($('round').value));
$('reload-queue').onclick = event(() => queue($('round').value));
$('review-login').onsubmit = event(async e => {
  e.preventDefault(); const code = $('invite').value; $('invite').value = '';
  const status = await api('/api/credits/login',{code});
  sessionId = status.account_storage_id;
  await queue(query.get('review'));
});
$('handoff-file').onchange = event(async e => {
  const seq = ++sequence;
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  reset(); $('round').value = '';
  if (file.size > 80000) throw Error('Choose a contribution handoff smaller than 80 KB.');
  const draft = readHandoff(await file.text(),tasks);
  const hash = await fingerprint(draft);
  if (seq === sequence) render({local:true,task_id:draft.task_id,draft,hash});
});
$('decision-form').onsubmit = event(async e => {
  e.preventDefault();
  if (!current || busy) return;
  const record = current, outcome = $('outcome').value, feedback = $('feedback').value.trim();
  if (!feedback) throw Error('Enter feedback for the contributor.');
  busy = true; $('decide').disabled = true;
  try {
    if (record.local) {
      const receipt = await portableReceipt(record.draft,$('reviewer').value,outcome,feedback);
      if (current !== record) return;
      if (receiptURL) URL.revokeObjectURL(receiptURL);
      receiptURL = URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'}));
      const a = $('download-receipt');
      a.href = receiptURL; a.download = record.task_id + '-review.json'; a.hidden = false; a.focus();
      notice('Receipt ready. Download it and return the file to the contributor.');
    } else {
      await verifySession();
      await api(root + '/' + encodeURIComponent(record.id) + '/decision',{submission_version:record.submission_version,outcome,feedback});
      await queue(record.id);
      notice('Review decision recorded. The contributor can read your feedback on the task.');
    }
  } finally { busy = false; $('decide').disabled = false; }
});
$('decision-form').oninput = () => { $('download-receipt').hidden = true; };
for (const [code,label] of outcomeLabels) $('outcome').add(new Option(label,code));
try {
  const [catalog,deployment] = await Promise.all([api('data/contributions/tasks.json?v=review-1'),api('deployment.json')]);
  tasks = catalog.tasks;
  if (query.get('task')) $('return-task').href = taskLink(query.get('task'));
  workshop = deployment.workshop === true;
  if (deployment.backend === 'same-origin') {
    $('server-panel').hidden = false;
    sessionId = workshop ? (await api('/api/credits/status')).account_storage_id : '';
    if (workshop && !sessionId) { $('review-login').hidden = false; $('invite').value = invitation || ''; }
    else await queue(query.get('review'));
  }
} catch (e) { notice(e.message,true); }
$('handoff-file').disabled = !tasks;
async function resumeWorkshop() {
  const main = document.querySelector('main');
  if (!workshop || !access || document.hidden) return;
  try { await verifySession(); if (!document.hidden) main.hidden = false; }
  catch { location.reload(); }
}
document.addEventListener('visibilitychange',() => {
  if (document.hidden && workshop && access) document.querySelector('main').hidden = true;
  else void resumeWorkshop();
});
window.addEventListener('pageshow',e => { if (e.persisted) void resumeWorkshop(); });
