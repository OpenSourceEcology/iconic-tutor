import {contributionStorageKeys, emptyDraft, handoffFormat, limits, readDraft, readHandoff, readiness, staleSources, steps, suggestedLesson, volunteerClaim, wikitext} from './contribute-core.js';

import {fingerprint,readReceipt,outcomeLabels} from './review-core.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let tasks, task, draft, existing, offered, timerStart, timerRemainder = 0;
let boardDetail, claim, boardBusy = false, localService = false;
const project = params.get('project') || '';
let workshop = false, accountId = '', accountLabel = '', storage;

async function currentAccount() {
  const response = await fetch('/api/credits/status', {cache:'no-store'});
  if (!response.ok) throw Error('The workshop could not verify your session. Reload to try again.');
  const result = await response.json();
  accountLabel = result.authenticated ? result.account_label : '';
  return result.authenticated ? result.account_storage_id : null;
}

async function verifyWorkshop() {
  if (!workshop) return;
  if (await currentAccount() !== accountId) {
    $('workspace').hidden = true;
    location.reload();
    throw Error('The workshop account changed. Reopening this contribution.');
  }
}


function reviewLink(id) {
  const args = new URLSearchParams({task:task.id});
  if (id) args.set('review',id);
  if (project) args.set('project',project);
  return 'review.html?' + args;
}

function note(message, error = false) {
  $('notice').textContent = message;
  $('notice').dataset.error = String(error);
}

function run(work) {
  return async event => { try { await work(event); } catch (error) { note(error.message, true); } };
}

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function saveBrowser() {
  const serialized = JSON.stringify(draft);
  try {
    if (localStorage.getItem(storage.draft) !== existing) {
      $('draft-status').textContent = 'Another tab saved a draft. Download your current handoff before reloading.';
      return;
    }
    if (serialized !== existing) localStorage.setItem(storage.draft, serialized);
    existing = serialized;
    $('draft-status').textContent = 'Draft saved in this browser.';
  } catch {
    $('draft-status').textContent = 'Browser storage is unavailable. Download a handoff to keep your draft.';
  }
}

function renderForm() {
  if (workshop) { draft.contributor = accountLabel; $('contributor').readOnly = true; }
  for (const key of ['kind', ...Object.keys(limits)]) $(key).value = draft[key];
  $('assistance').value = draft.assistance || 'unreported';
  for (const input of $('source-list').querySelectorAll('input')) input.checked = draft.source_ids.includes(input.value);
  refreshResult();
  showTime();
}

function refreshResult() {
  const answer = draft.kind === 'answer';
  const evidenceRequired = task.answer_evidence || (task.id === 'wall-fastening' ? 'Cite an independent build or reviewer record for this joint.' : '');
  $('response-label').textContent = answer ? 'Proposed answer and its evidence' : 'Question for the next contributor';
  $('additional-label').textContent = answer && evidenceRequired ? 'Supporting evidence URL' : 'Additional source URL (optional with a cited source)';
  $('answer-guidance').hidden = !answer;
  $('answer-guidance').textContent = evidenceRequired || 'Describe the evidence for this interpretation. A reviewer will assess the proposed answer.';
  const outdated = staleSources(task, draft);
  $('reconcile').hidden = !outdated.length;
  $('changed-sources').textContent = outdated.map(id => {
    const source = task.sources.find(s => s.id === id);
    return source ? source.title + ' changed from ' + (draft.source_revisions[id] || 'an unknown revision') + ' to ' + source.revision + '.'
      : 'Source ' + id + ' is no longer in this brief; reconfirming removes it from the draft.';
  }).join(' ');
  const issues = readiness(task, draft);
  $('missing').replaceChildren(...issues.map(v => element('li',v)));
  $('wiki-preview').value = issues.length ? '' : wikitext(task, draft);
  $('copy-wiki').disabled = issues.length > 0;
  $('copy-claim').disabled = !draft.contributor.trim();
  if (!$('claim-text').hidden) $('claim-text').value = draft.contributor.trim() ? volunteerClaim(task, draft) : '';
  updateBoardControls();
}

function showTime() {
  const s = draft.active_seconds;
  $('time').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  $('timer').textContent = timerStart == null ? 'Start timer' : 'Pause timer';
  $('timer').setAttribute('aria-pressed', String(timerStart != null));
}

function tick() {
  if (timerStart == null) return;
  const now = performance.now();
  const elapsed = (now - timerStart) / 1000 + timerRemainder;
  timerStart = now;
  const whole = Math.floor(elapsed);
  timerRemainder = elapsed - whole;
  if (whole > 0) {
    draft.active_seconds = Math.min(31536000, draft.active_seconds + whole);
    showTime();
    saveBrowser();
  }
}

function pause() {
  if (timerStart == null) return;
  tick();
  timerStart = null;
  showTime();
}

function evidence() {
  for (const s of task.sources) {
    const card = element('article','');
    card.className = 'source-card';
    const title = element('h3', '');
    const link = element('a', s.title + ' ↗');
    link.href = s.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    title.append(link);
    const meta = element('small', (s.kind === 'git' ? 'Git commit ' : 'Wiki revision ') + s.revision);
    const cite = element('label','');
    cite.className = 'cite';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.value = s.id;
    check.setAttribute('aria-label', 'Cite ' + s.title);
    check.onchange = () => {
      draft.source_ids = draft.source_ids.filter(id => id !== s.id);
      delete draft.source_revisions[s.id];
      if (check.checked) {
        draft.source_ids.push(s.id);
        draft.source_revisions[s.id] = s.revision;
      }
      changed();
    };
    cite.append(check, 'Cite this source');
    card.append(title, meta, element('blockquote',s.excerpt), element('p',s.applicability), cite);
    $('source-list').append(card);
  }
}

function changed() {
  refreshResult();
  saveBrowser();
}

async function copy(text, fallback) {
  try {
    await navigator.clipboard.writeText(text);
    note('Copied. Paste and preview the text in the wiki editor.');
  } catch {
    fallback();
    note('Select the text and use your browser’s Copy command.');
  }
}

function handoff() {
  tick();
  const text = JSON.stringify({format:handoffFormat, exported_at:new Date().toISOString(), draft}, null, 2) + '\n';
  const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = task.id + '-handoff.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function offer(nextDraft, origin) {
  offered = readDraft(nextDraft, task.id);
  $('import-summary').textContent = origin + ' from ' + (offered.contributor || 'an unnamed contributor') +
    '. Resuming replaces the draft shown here. Download your current draft first if you need both copies.';
  $('import-review').hidden = false;
  $('apply-import').focus();
}

async function boardRequest(action, payload) {
  const path = '/api/contributions/tasks/' + encodeURIComponent(task.id) + (action ? '/' + action : '');
  const response = await fetch(path, payload ? {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload),
  } : {cache:'no-store'});
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(detail.error || 'Studio could not open this task (' + response.status + ').');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function updateBoardControls() {
  if (!boardDetail) return;
  const held = boardDetail.status === 'claimed';
  const correctProject = !project || boardDetail.project_id === project;
  const mine = held && claim && claim.holder === boardDetail.contributor && correctProject;
  $('claim').disabled = boardBusy || held || boardDetail.awaiting_review || boardDetail.reviews?.some(r => r.status === 'pending') || !draft.contributor.trim();
  $('save-shared').disabled = boardBusy || !mine;
  $('release').disabled = boardBusy || !mine;
  $('submit').disabled = boardBusy || !mine || readiness(task,draft).length > 0;
  $('refresh-board').disabled = boardBusy;
  const projectId = boardDetail.project_id;
  const coach = $('claim-coach');
  coach.hidden = !(mine && projectId);
  if (!coach.hidden) coach.href = 'coach.html?' + new URLSearchParams({project:projectId,task:task.id,lesson:task.workstream});
  else coach.removeAttribute('href');
}

function showBoard() {
  $('board').hidden = false;
  let message = 'Available to claim.';
  if (boardDetail.status === 'claimed') {
    const until = boardDetail.claim_expires_at;
    message = 'Claimed by ' + boardDetail.contributor + (until ? ' until ' + new Date(until).toLocaleDateString() : '') + '.';
  } else if (boardDetail.status === 'ready_for_review') {
    const round = boardDetail.reviews?.find(r => r.submission_version === boardDetail.version);
    message = round?.decision ? 'Decision recorded. You can claim this task to prepare another round.' :
      'A contribution from ' + boardDetail.contributor + ' is ready for review.';
  }
  if (outcomeLabels.has(boardDetail.status)) message = 'Decision recorded: ' + outcomeLabels.get(boardDetail.status) + '. You can claim this task for another round.';
  if (boardDetail.project_id && boardDetail.project_id !== project) {
    message += ' The shared task is linked to Studio project ' + boardDetail.project_id + '.';
  }
  $('shared-status').textContent = message + ' Studio revision ' + boardDetail.version + '.';
  $('task-decisions').replaceChildren();
  for (const review of boardDetail.reviews || []) {
    const row = element('p','');
    const link = element('a','Round ' + review.round + ' · submission revision ' + review.submission_version);
    link.href = reviewLink(review.id);
    row.append(link,document.createTextNode(' · ' + (review.decision ? outcomeLabels.get(review.decision.outcome) : 'Awaiting review')));
    if (review.decision) row.append(element('small',review.decision.reviewer + ' · ' + review.decision.feedback));
    $('task-decisions').append(row);
  }
  $('shared-handoffs').replaceChildren();
  for (const row of [boardDetail, ...(boardDetail.handoffs || []).filter(r => r.version !== boardDetail.version)]) {
    if (!row.draft) continue;
    const button = element('button', 'Read draft from revision ' + row.version);
    button.onclick = run(() => offer(row.draft, 'Studio revision ' + row.version));
    $('shared-handoffs').append(button);
  }
  updateBoardControls();
}

async function fetchBoard() {
  boardDetail = await boardRequest();
  showBoard();
}

async function act(action) {
  if (boardBusy) return;
  boardBusy = true;
  updateBoardControls();
  try {
    await verifyWorkshop();
    let token = claim?.token;
    const payload = {version:boardDetail.version};
    if (action === 'claim') {
      token = crypto.randomUUID();
      claim = {token, holder:draft.contributor.trim()};
      // Store before POST so a lost response can be recovered by refreshing the board.
      localStorage.setItem(storage.claim, JSON.stringify(claim));
      payload.contributor = claim.holder;
    } else {
      tick();
      payload.draft = draft;
    }
    payload.claim_token = token;
    if (project) payload.project_id = project;
    boardDetail = await boardRequest(action,payload);
    if (action === 'release' || action === 'submit') {
      claim = null;
      localStorage.removeItem(storage.claim);
    }
    showBoard();
    note(action === 'submit' ? 'Handed off for Studio review. Your wiki draft is available to copy.' : 'Studio task updated.');
  } catch (error) {
    if (error.status === 403 || (action === 'claim' && error.status)) {
      claim = null;
      localStorage.removeItem(storage.claim);
    }
    if (error.status === 403 || error.status === 409) await fetchBoard();
    throw error;
  } finally {
    boardBusy = false;
    updateBoardControls();
  }
}

async function start() {
  const response = await fetch('data/contributions/tasks.json');
  if (!response.ok) throw Error('The task catalog could not be opened.');
  tasks = (await response.json()).tasks;
  for (const t of tasks) $('task-select').add(new Option(t.module_id + ' · ' + t.title,t.id));
  $('task-select').options[0].remove();
  $('task-select').disabled = false;
  $('task-select').onchange = () => {
    pause();
    const next = tasks.find(item => item.id === $('task-select').value);
    const destination = new URLSearchParams({task:next.id});
    if (project && task?.module_id === next.module_id) destination.set('project',project);
    location.href = 'contribute.html?' + destination;
  };
  const id = params.get('task') || 'wall-fastening';
  task = tasks.find(t => t.id === id);
  if (!task) {
    $('task-select').selectedIndex = -1;
    throw Error('This task is not in the catalog. Choose an available contribution above.');
  }
  $('open-reviews').href = reviewLink();
  $('task-select').value = task.id;
  document.title = task.title + ' · Iconic Tutor';
  $('title').textContent = task.title;
  $('module').textContent = task.module_id + ' · ' + task.workstream;
  $('question').textContent = task.question;
  $('task-scope').textContent = task.scope;
  $('completion').append(...task.completion.map(s => element('li', s)));
  $('affected').textContent = task.affected.join(' · ');
  const wiki = 'https://wiki.opensourceecology.org/index.php?';
  $('discussion').href = wiki + new URLSearchParams({title:task.wiki_title});
  $('edit-wiki').href = wiki + new URLSearchParams({title:task.wiki_title, action:'edit'});
  $('destination').textContent = 'Destination on the OSE wiki: ' + task.wiki_title + '.';
  $('lesson_step').add(new Option('Choose a step',''));
  for (const s of steps) $('lesson_step').add(new Option(s,s));
  const deploymentResponse = await fetch('deployment.json', {cache:'no-store'});
  if (!deploymentResponse.ok) throw Error('Could not verify the site configuration. Reload to reopen your draft.');
  const deployment = await deploymentResponse.json();
  workshop = deployment.workshop === true;
  localService = deployment.backend === 'same-origin';
  accountId = workshop ? await currentAccount() : '';
  if (workshop && !accountId) {
    note('Sign in to the workshop, then return to this contribution. ');
    const login = element('a','Open workshop sign-in');
    login.href = 'coach.html';
    $('notice').append(login);
    return;
  }
  storage = contributionStorageKeys(task.id, project, workshop, accountId);
  evidence();
  draft = emptyDraft(task.id);
  existing = storageGet(storage.draft);
  if (existing) {
    try { draft = readDraft(JSON.parse(existing), task.id); }
    catch { note('The stored draft could not be read. You can import a handoff or start a new draft.', true); }
  }
  renderForm();
  $('draft-status').textContent = existing ? 'Resumed the browser draft.' : 'Edits are saved in this browser.';
  $('workspace').hidden = false;
  for (const key of ['kind', ...Object.keys(limits)]) {
    const field = $(key);
    field.addEventListener(field.tagName === 'SELECT' ? 'change' : 'input', () => {
      draft[key] = field.value;
      if (key === 'help' || key === 'lesson_step') $('suggestion-box').hidden = true;
      changed();
    });
  }
  $('assistance').onchange = () => {
    if ($('assistance').value === 'unreported') delete draft.assistance;
    else draft.assistance = $('assistance').value;
    changed();
  };
  $('confirm-sources').onclick = () => {
    draft.source_ids = draft.source_ids.filter(id => task.sources.some(s => s.id === id));
    draft.source_revisions = Object.fromEntries(draft.source_ids.map(id => [id, task.sources.find(s => s.id === id).revision]));
    changed();
    note('Current source revisions recorded.');
  };
  $('timer').onclick = () => {
    if (timerStart != null) pause();
    else { timerStart = performance.now(); showTime(); }
  };
  setInterval(tick,1000);
  async function resumeWorkshop() {
    if (!workshop || document.hidden) return;
    $('workspace').hidden = true;
    await verifyWorkshop();
    if (!document.hidden) $('workspace').hidden = false;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pause();
      if (workshop) $('workspace').hidden = true;
    } else run(resumeWorkshop)();
  });
  window.addEventListener('pagehide', () => {
    pause();
    if (workshop) $('workspace').hidden = true;
  });
  window.addEventListener('pageshow', event => { if (event.persisted) run(resumeWorkshop)(); });

  $('suggest-lesson').onclick = run(() => {
    $('lesson-suggestion').textContent = suggestedLesson(task, draft.lesson_step, draft.help);
    $('suggestion-box').hidden = false;
  });
  $('use-suggestion').onclick = () => {
    const field = $('lesson_feedback');
    field.value = $('lesson-suggestion').textContent.slice(0,3000);
    field.dispatchEvent(new Event('input', {bubbles:true}));
    $('suggestion-box').hidden = true;
    field.focus();
  };
  $('copy-wiki').onclick = run(() => copy(wikitext(task,draft), () => {
    $('preview-details').open = true; $('wiki-preview').focus(); $('wiki-preview').select();
  }));
  $('copy-claim').onclick = run(() => copy(volunteerClaim(task,draft), () => {
    const field = $('claim-text'); field.hidden = false; field.value = volunteerClaim(task,draft); field.focus(); field.select();
  }));
  $('download').onclick = run(handoff);
  $('receipt-file').onchange = run(async event => {
    const file = event.target.files[0]; event.target.value = '';
    const panel = $('receipt-result'); panel.replaceChildren();
    if (!file) return;
    if (file.size > 140000) throw Error('Choose a portable review receipt smaller than 140 KB.');
    const receipt = await readReceipt(await file.text(),tasks);
    if (receipt.draft.task_id !== task.id) throw Error('Open task “' + receipt.draft.task_id + '” to inspect this review.');
    const matches = receipt.fingerprint === await fingerprint(draft);
    const d = receipt.decision;
    panel.append(element('h3','Local, unverified review'),
      element('p',outcomeLabels.get(d.outcome) + ' · ' + d.reviewer + ' · ' + d.decided_at),
      element('p',d.feedback),element('p',matches ? 'Reviewed handoff matches the open draft.' : 'Reviewed handoff differs from the open draft.'),
      element('small','SHA-256 ' + receipt.fingerprint));
    const details = element('details','');
    details.append(element('summary','Inspect reviewed submission'),element('p',receipt.draft.contributor),
      element('p',receipt.draft.scope),element('p',receipt.draft.text));
    for (const id of receipt.draft.source_ids) details.append(element('p',id + ' · ' + receipt.draft.source_revisions[id]));
    if (receipt.draft.additional_source) details.append(element('p',receipt.draft.additional_source));
    panel.append(details);
  });
  $('import-file').onchange = run(async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 80000) throw Error('Choose a handoff file smaller than 80 KB.');
    const imported = readHandoff(await file.text(), tasks);
    if (imported.task_id !== task.id) throw Error('Open task “' + imported.task_id + '” before importing this handoff.');
    offer(imported,'Portable handoff');
  });
  $('cancel-import').onclick = () => { offered = null; $('import-review').hidden = true; };
  $('apply-import').onclick = () => {
    if (!offered) return;
    pause(); draft = offered; offered = null;
    $('import-review').hidden = true; $('suggestion-box').hidden = true;
    renderForm(); saveBrowser(); note('Handoff loaded. Review its evidence and continue.');
  };
  for (const [button,action] of [['claim','claim'],['save-shared','save'],['release','release'],['submit','submit']]) {
    $(button).onclick = run(() => act(action));
  }
  $('refresh-board').onclick = run(fetchBoard);
  try {
    if (localService) {
      if (project) {
        $('author-project').href = 'author.html?project=' + encodeURIComponent(project);
        $('author-project').hidden = false;
      }
      try { claim = JSON.parse(storageGet(storage.claim)); } catch { claim = null; }
      await fetchBoard();
    }
  } catch {
    $('shared-status').textContent = 'Studio task board unavailable. You can continue here and download your handoff.';
    $('public-claim').hidden = false;
    return;
  }
  if (!localService) {
    $('shared-status').textContent = 'Shared task claims and saved revisions are available on a running Tutor Studio server.';
    $('public-claim').hidden = false;
  }
}

start().catch(error => note(error.message,true));
