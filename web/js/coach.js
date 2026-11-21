import {consumeInvitation} from './workshop-invite.js';
import {contributionStorageKeys} from './contribute-core.js';
const $ = id => document.getElementById(id);
const invitation = consumeInvitation();
const params = new URLSearchParams(location.search);
const guide = 'https://github.com/OpenSourceEcology/iconic-tutor/blob/main/docs/ichl-authoring.md';
let contributionTasks = [], lessons = [], lessonId = params.get('lesson') || 'welcome', state = null;
let credits, workshopAccount = null, workshop = false, live = false, busy = false, retry = null;

function node(tag, text) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  return element;
}
function link(parent, label, url) {
  if (!url) return;
  const dest = new URL(url, location.href);
  if (!['http:', 'https:'].includes(dest.protocol)) return;
  const a = node('a', label);
  a.href = dest.href;
  parent.append(a);
}
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {cache:'no-store'} : {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not open this project.');
  return data;
}
function notice(message = '', error = false) {
  $('feedback').textContent = message;
  $('feedback').dataset.error = String(error);
}
async function run(fn) {
  if (busy) return;
  busy = true;
  const lock = [$('outline'), $('lesson'), $('chat'), $('library'), $('join'), document.querySelector('.paging')];
  lock.forEach(el => { el.inert = true; });
  try { notice(); await fn(); }
  catch (e) { notice(e.message, true); }
  finally { busy = false; lock.forEach(el => { el.inert = false; }); }
}
function notesKey() { return 'ose-coach-notes/v1/' + (workshopAccount ? workshopAccount + '/' : '') + (state?.project.id || 'wall-example'); }
function notes() {
  try { return JSON.parse(localStorage.getItem(notesKey()) || '{}'); } catch { return {}; }
}
function updateLocation() {
  const u = new URL(location.href);
  u.searchParams.set('lesson', lessonId);
  if (state) u.searchParams.set('project', state.project.id);
  history.replaceState(null, '', u);
}
function bind(value) {
  state = value;
  lessonId = value.lesson.id;
  updateLocation();
  render();
}
function route(action = '') {
  return '/api/coach/projects/' + encodeURIComponent(state.project.id) + (action ? '/' + action : '');
}
async function openProject(id) {
  const result = await api('/api/coach/projects/' + encodeURIComponent(id));
  bind(result);
  $('resume').value = id;
  $('library').open = false;
}
async function selectLesson(id) {
  if (id === lessonId) return;
  if (state) bind(await api(route('lesson'), {version:state.project.version,lesson_id:id}));
  else { lessonId = id; updateLocation(); render(); }
}
function requestLesson(id) { return run(()=>selectLesson(id)); }
function drawMessages() {
  const list = $('messages');
  list.replaceChildren();
  for (const msg of state?.messages || []) {
    const item = node('div'); item.className = 'message';
    const names = {guided:'Lesson guide',free:'OSE AI',frontier:'Frontier AI · suggestion for review',confirmed:'Project result'};
    item.append(node('strong', msg.role === 'user' ? 'You' : names[msg.mode] || 'Tutor'));
    item.append(node('p',msg.text));
    for (const ref of msg.sources || []) {
      const src = typeof ref === 'string' ? state.sources?.find(s => s.id === ref) : ref;
      if (src) link(item,src.title || src.label || src.id,src.url);
    }
    list.append(item);
  }
  list.scrollTop = list.scrollHeight;
}
function drawActions() {
  $('actions').replaceChildren();
  for (const action of state?.actions || []) {
    const b = node('button', action.label); b.title = action.description || action.label;
    b.onclick = () => run(async () => {
      const text = action.id === 'save_note' ? ($('question').value.trim() || $('field-note').value.trim()) : action.label;
      if (!text) {
        notice('Write the observation or question you want to save first.');
        $('question').focus();
        return;
      }
      await message('guided',text,action.id);
    });
    $('actions').append(b);
  }
  const p = state?.pending;
  $('proposal').hidden = !p;
  $('proposal').replaceChildren();
  if (!p) return;
  $('proposal').append(node('strong',p.label), node('p',p.description));
  const fieldLabels = {spacing_in:'Stud spacing (inches)',drawing_dimensions:'Drawing dimensions',scope:'Project scope'};
  for (const change of p.changes || []) {
    const field = change.path.split('/').pop();
    const label = change.path.startsWith('/notes/') ? 'Workstream note' : fieldLabels[field] || field;
    const value = v => (Array.isArray(v) ? v.join(', ') : String(v ?? '')) || '(empty)';
    $('proposal').append(node('p',label + ' · ' + value(change.before) + ' → ' + value(change.after)));
  }
  for (const src of p.evidence || []) link($('proposal'),src.title,src.url);
  const confirm = node('button','Confirm ' + p.label);
  confirm.onclick = () => run(async ()=>{
    bind(await api(route('confirm'),{version:state.project.version,proposal_id:p.id}));
    notice('Saved. Review the result before continuing.');
  });
  $('proposal').append(confirm);
}
function render() {
  const rows = state?.lessons || lessons;
  const index = Math.max(0, rows.findIndex(l => l.id === lessonId));
  const current = state?.lesson || rows[index];
  lessonId = current.id;
  $('position').textContent = 'Lesson ' + (index+1) + ' of ' + rows.length;
  $('title').textContent = current.title;
  $('prompt').textContent = current.prompt;
  $('steps').replaceChildren(...(current.steps || []).map(s=>node('li',s)));
  $('completion').textContent = current.completion || '';
  $('drawing').hidden = (state && state.project.module_id !== 'ICHL-015') || !['welcome','geometry','drawings','variation','repair'].includes(lessonId);
  if (!$('drawing').hidden) {
    $('example').value = (state?.project.instance.spacing_in === 24 || (!state && ['variation','repair'].includes(lessonId))) ? 'OC24' : 'OC16';
    showDrawing();
  }
  const build = state?.project.build;
  const row = build?.manifest?.workstreams?.find(item=>item.id === current.workstream);
  $('result').hidden = !row;
  if (row) {
    const issues = [...(row.checks || []).filter(c=>!c.passed).map(c=>c.name), ...(row.gaps || [])];
    $('result').textContent = 'Generated revision ' + build.version + ' · ' + row.title + ' · ' + row.status.replaceAll('_',' ')
      + (issues.length ? '. ' + issues.join('. ') : '.');
  }
  $('outline').replaceChildren(); $('lesson').replaceChildren();
  for (const lesson of rows) {
    $('lesson').add(new Option(lesson.title,lesson.id));
    const b = node('button',lesson.title);
    if (lesson.id === lessonId) b.setAttribute('aria-current','step');
    b.onclick = () => requestLesson(lesson.id);
    $('outline').append(b);
  }
  $('lesson').value = lessonId;
  $('previous').disabled = index === 0;
  $('next').disabled = index === rows.length-1;
  $('previous').onclick = () => requestLesson(rows[index-1].id);
  $('next').onclick = () => requestLesson(rows[index+1].id);
  $('field-note').value = workshop && !workshopAccount ? '' : (notes()[lessonId] || '');
  $('refs').replaceChildren();
  for (const r of current.resources || []) link($('refs'),r.label,r.url);
  const urls = state?.links || {};
  if (state) {
    link($('refs'),'Open project workspace',urls.author || 'author.html?project=' + state.project.id);
    if (['export','wiki'].includes(lessonId)) {
      link($('refs'),'Open OSE wiki upload',urls.upload);
      link($('refs'),'Read current module page',urls.canonical);
      link($('refs'),'Review on the discussion page',urls.discussion);
      link($('refs'),'Download generated files for wiki upload',urls.publication);
      link($('refs'),'Download private project backup',urls.package);
      link($('refs'),'Download wiki draft',urls.wiki);
      link($('refs'),'Draft against the current wiki revision',urls.live_wiki);
    }
  }
  if (!current.resources?.length && (!state || state.project.module_id === 'ICHL-015')) {
    link($('refs'),'Inspect the wall example files','https://opensourceecology.github.io/iconic-tutor/ichl-015/');
  }
  const moduleId = state?.project.module_id || 'ICHL-015';
  for (const task of contributionTasks.filter(t=>t.module_id === moduleId && t.workstream === current.workstream)) {
    const query = new URLSearchParams({task:task.id});
    if (state) query.set('project',state.project.id);
    link($('refs'),task.title,'contribute.html?' + query);
  }
  const firstTask = contributionTasks.find(t => t.module_id === moduleId);
  const entry = $('contribution');
  entry.hidden = !firstTask;
  if (firstTask) {
    const query = new URLSearchParams({task:firstTask.id});
    if (state) query.set('project',state.project.id);
    entry.href = 'contribute.html?' + query;
  }
  $('chat').hidden = !state;
  $('ask-link').hidden = !state;
  $('project-label').hidden = !state;
  if (state) $('project-label').textContent = state.project.module_id + ' · ' + state.project.name + ' · Revision ' + state.project.version;
  drawMessages(); drawActions();
}
async function message(mode,text,actionId) {
  const body = {version:state.project.version, text, mode, lesson_id:lessonId};
  if (actionId) body.action_id = actionId;
  if (mode === 'frontier') {
    const task = params.get('task');
    if (task && state.project.id === params.get('project')) {
      const storage = contributionStorageKeys(task,state.project.id,workshop,workshopAccount);
      let claim;
      try { claim = JSON.parse(localStorage.getItem(storage.claim)); } catch {}
      if (!claim?.token) throw Error('Reopen the coach from your current task claim before using frontier credit here.');
      body.pilot_task = task;
      body.pilot_claim_token = claim.token;
    }
    const key = JSON.stringify([state.project.id, body]);
    if (retry?.key !== key) retry = {key, id:crypto.randomUUID()};
    body.request_id = retry.id;
  }
  notice(mode === 'guided' ? 'Opening lesson guidance…' : 'Waiting for the model…');
  try {
    bind(await api(route('message'),body));
    if (!actionId) $('question').value = '';
    retry = null; notice();
  } finally { if (mode === 'frontier') await credits?.refresh(); }
}
function showDrawing() { $('frame').src = 'data/coach/' + $('example').value + '.svg'; }
$('example').onchange = showDrawing;
$('lesson').onchange = e => requestLesson(e.target.value);
function updateMode() {
  const frontier = $('mode').value === 'frontier';
  $('send').textContent = frontier ? 'Ask frontier AI' : 'Ask';
  $('paid-notice').hidden = !frontier;
  if (frontier) {
    const rates = credits?.status()?.rates;
    if (!rates?.configured) {
      $('paid-notice').textContent = 'Refresh credit status to see the current price.';
      return;
    }
    const markup = (rates.markup_bps ?? 0) / 100;
    $('paid-notice').textContent = 'Your question, recent conversation and current project evidence will go to '
      + rates.model + '. Model rates per million tokens: input $' + rates.input_usd_per_mtok
      + (rates.cached_input_usd_per_mtok == null ? '' : ', cached input $' + rates.cached_input_usd_per_mtok)
      + ', output $' + rates.output_usd_per_mtok + '. OSE support adds ' + markup + '% of model usage. Uses test credit.';
  }
}
$('mode').onchange = updateMode;
$('ask').onsubmit = e => {e.preventDefault(); run(()=>message($('mode').value,$('question').value.trim()));};
$('field-note').oninput = () => {
  const memo = notes(); memo[lessonId] = $('field-note').value;
  try { localStorage.setItem(notesKey(),JSON.stringify(memo)); } catch { notice('Storage is full. Download your notes before leaving.',true); }
};
$('download-notes').onclick = () => {
  const memo = {...notes(),[lessonId]:$('field-note').value};
  const lines = [state?.project.name || 'ICHL-015 wall example', ...((state?.lessons || lessons)
    .filter(l=>memo[l.id]?.trim()).map(l=>l.title + '\n' + memo[l.id]))];
  const a = node('a'); a.download = 'ose-module-field-notes.txt';
  a.href = URL.createObjectURL(new Blob([lines.join('\n\n')],{type:'text/plain'}));
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
};
$('start').onsubmit = e => {e.preventDefault();run(async ()=>{
  const p = await api('/api/authoring/projects',{module_id:$('module').value,name:$('name').value});
  $('resume').add(new Option(p.name + ' · ' + p.module_id,p.id));
  await openProject(p.id);
});};
$('resume').onchange = e => { if(e.target.value) run(()=>openProject(e.target.value)); };
async function startLibrary() {
  const [catalog,saved] = await Promise.all([api('/api/authoring/modules'),api('/api/authoring/projects')]);
  for (const m of catalog.modules) $('module').add(new Option(m.id + ' · ' + m.title,m.id));
  $('module').value = 'ICHL-015';
  for (const p of saved.projects) $('resume').add(new Option(p.name + ' · ' + p.module_id,p.id));
  $('mode').querySelector('[value=free]').disabled = !catalog.ai_available;
  $('mode').value = catalog.ai_available ? 'free' : 'guided';
  $('availability').textContent = catalog.ai_available ? 'Open a project to talk with the configured OSE AI model.' : 'Open a project to use the lesson guide and run the compiler. OSE AI is offline.';
  $('library').hidden = false;
  $('library').open = true;
  if (params.get('project')) {
    try { await openProject(params.get('project')); }
    catch (error) { notice(error.message + ' Choose your own project above.',true); }
  }
  const {mountCredits} = await import('./coach-credits.js');
  credits = await mountCredits($('coach-credits'),status=>{
    if (workshop && status?.authenticated) {
      if (workshopAccount && workshopAccount !== status.account_storage_id) { location.replace('coach.html'); return; }
      workshopAccount = status.account_storage_id;
      $('field-note').value = notes()[lessonId] || '';
    }
    if (workshop && status && !status.authenticated) {
      location.replace('coach.html');
      return;
    }
    const option = $('mode').querySelector('[value=frontier]');
    option.disabled = !(status?.authenticated && status.rates?.configured && status.available_microusd > 0);
    if (option.disabled && $('mode').value === 'frontier') $('mode').value = catalog.ai_available ? 'free' : 'guided';
    updateMode();
  });
}
document.addEventListener('visibilitychange', () => {
  if (workshop && !document.hidden && workshopAccount) void credits?.refresh();
});
$('join').onsubmit = e => {e.preventDefault();run(async ()=>{
  await api('/api/credits/login',{code:$('join').elements.invite.value});
  $('join').reset(); $('join').hidden = true; await startLibrary(); $('notes').hidden = false;
});};
try {
  const [catalog,deployment,briefs] = await Promise.all([api('data/coach/lessons.json'),api('deployment.json'),api('data/contributions/tasks.json')]);
  contributionTasks = briefs.tasks;
  lessons = catalog.lessons;
  const resumeRequested = deployment.backend === 'same-origin' && params.has('project');
  if (!resumeRequested) render();
  workshop = !!deployment.workshop;
  live = deployment.backend === 'same-origin';
  if (workshop) {
    const account = await api('/api/credits/status');
    workshopAccount = account.account_storage_id || null;
    $('notes').hidden = !account.authenticated;
    if (account.authenticated) $('field-note').value = notes()[lessonId] || '';
  }
  if (live && workshop && !workshopAccount) {
    $('join').hidden = false;
    if (invitation) $('join').elements.invite.value = invitation;
    $('availability').textContent = 'Use your workshop invitation to save a project and talk to the tutor.';
  } else if (live) await startLibrary();
  else {
    $('availability').textContent = 'Public walkthrough · Read each lesson, inspect the example files and keep notes here. For conversation and CAD generation, ';
    link($('availability'),deployment.workshop_url ? 'enter the workshop' : 'open your Studio',deployment.workshop_url || 'http://127.0.0.1:8766/coach.html');
    $('availability').append(' or use the '); link($('availability'),'setup guide',guide); $('availability').append('.');
  }
} catch (e) { notice(e.message,true); }
finally { if (lessons.length && !state) render(); }
