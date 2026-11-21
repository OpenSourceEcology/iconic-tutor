import {consumeInvitation} from './workshop-invite.js';
import {guides, intakeQuestions} from './author-guides.js';
import {editFields, el, field} from './author-editor.js';
import {showModel} from './author-model.js';

const $ = id => document.getElementById(id);
const root = '/api/authoring';
const invitation = consumeInvitation();
let workshopAccount = null;
let modules = [], contributionTasks = [], aiAvailable = false, project = null, draft = null;
let collect = () => {}, dirty = false, busy = false, rawMode = false;

const moduleInfo = () => modules.find(m => m.id === project.module_id);
const endpoint = action => `/projects/${encodeURIComponent(project.id)}${action ? '/' + action : ''}`;
const pretty = value => JSON.stringify(value, null, 2);
function notice(message, isError = false) {
  $('notice').textContent = message;
  $('notice').dataset.error = String(isError);
}
async function request(path, body) {
  const response = await fetch(root + path, body ? {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
  } : {cache:'no-store'});
  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status}).`;
    try { message = (await response.json()).error || message; } catch { /* plain HTTP error */ }
    if (response.status === 409) $('conflict').hidden = false;
    throw new Error(message);
  }
  return response;
}
async function json(path, body) { return (await request(path,body)).json(); }
async function run(action) {
  if (busy) return;
  busy = true;
  // Prevent edits made during an in-flight save from being overwritten by its result.
  $('author-join').inert = $('library').inert = $('project').inert = true;
  try { await action(); }
  catch(e) {
    notice(e.message, true);
    if (project) $('project-select').value = project.id;
  } finally { busy = false; $('author-join').inert = $('library').inert = $('project').inert = false; }
}
function projectOption(p) { return new Option(p.name + ' · ' + p.module_id, p.id); }
function bindProject(p) {
  project = p; draft = structuredClone(p.instance); dirty = rawMode = false; $('editor').inert = false;
  $('conflict').hidden = true;
  $('project').hidden = false;
  const sel = $('project-select');
  if (![...sel.options].some(o=>o.value === p.id)) sel.add(projectOption(p));
  sel.value = p.id;
  const url = new URL(location.href);
  url.searchParams.set('project', p.id);
  history.replaceState(null, '', url);
  $('open-coach').href = 'coach.html?' + new URLSearchParams({project:p.id});
  $('project-title').textContent = p.name;
  $('project-module').textContent = p.module_id + ' · ' + moduleInfo().title;
  const task = contributionTasks.find(t => t.module_id === p.module_id && t.workstream === p.active_workstream);
  $('task-entry').hidden = !task;
  if (task) {
    const link = $('task-entry').querySelector('a');
    link.href = 'contribute.html?' + new URLSearchParams({task:task.id, project:p.id});
    link.textContent = task.title;
  }
  $('revision').textContent = 'Saved revision ' + p.version;
  $('notes').value = p.notes?.[p.active_workstream] ?? '';
  $('instance').value = pretty(draft);
  $('generate').disabled = !moduleInfo().can_generate;
  $('generate').title = moduleInfo().can_generate ? '' : 'This module has no configured compiler.';
  $('publication').disabled = !p.build;
  $('package').disabled = false; $('wiki').disabled = false;
  $('streams').replaceChildren();
  for (const s of moduleInfo().workstreams) {
    const record = result(s.id);
    const button = el('button'), dot = el('span',undefined,'dot');
    dot.dataset.state = record?.status || '';
    const label = stateLabel(record);
    button.title = label; button.setAttribute('aria-label', s.title + ' · ' + label);
    if (s.id === p.active_workstream) button.setAttribute('aria-current', 'step');
    button.dataset.stream = s.id;
    button.append(dot, document.createTextNode(s.title));
    button.onclick = () => run(async () => {
      if (s.id !== p.active_workstream) { await save(s.id); notice('Opened ' + s.title + '.'); }
    });
    $('streams').append(button);
  }
  $('history').replaceChildren(...p.history.map(h => {
    const item = el('li');
    item.append(safeLink(root + endpoint('revisions/') + h.version, `r${h.version} · ${h.action}`), el('small',h.timestamp));
    return item;
  }));
  const stream = moduleInfo().workstreams.find(s=>s.id===p.active_workstream);
  $('stream-title').textContent = stream.title;
  const guide = moduleInfo().can_generate ? guides[stream.id] : {
    aim: 'Gather source material and open questions for the ' + stream.title.toLowerCase() + ' schema.',
    steps: ['Review the linked module evidence and its revision.', intakeQuestions[stream.id],
      'Save your findings and unresolved questions in the workstream notes.'],
    repair: 'If the registry lacks the needed evidence, record the specific source or reviewer needed to continue.',
  };
  $('guide').textContent = guide?.aim || 'Record the module inputs and their source evidence.';
  $('steps').replaceChildren();
  if (stream.dependencies?.length) $('steps').append(el('p','Uses ' + stream.dependencies.map(id => moduleInfo().workstreams.find(s=>s.id===id)?.title || id).join(', ') + '.','muted'));
  const steps = el('ol');
  for (const step of guide?.steps || []) steps.append(el('li',step));
  $('steps').append(steps);
  if (guide) $('steps').append(el('p',guide.repair));
  $('ai-state').textContent = aiAvailable ? 'The configured model receives this workstream and source excerpts. Review proposed edits before applying them.'
    : 'AI suggestions are offline. Use the authoring procedure and linked sources to work through this step.';
  $('ask').disabled = !aiAvailable;
  renderEditor(); renderResult(); renderEvidence($('evidence'),project.evidence); renderConversation();
  const refresh = p.last_evidence_refresh;
  $('refresh-receipt').textContent = refresh
    ? [refresh.timestamp, ...refresh.found, ...refresh.missing.map(name=>'Page missing: ' + name)].join(' · ')
    : 'Saved source revisions are available offline.';
  const manifest = project.build?.manifest;
  $('model-status').textContent = manifest?.members?.length ? `${manifest.variant} · ${manifest.members.length} generated framing members · build r${project.build.version}`
    : moduleInfo().can_generate ? 'Generate the project to inspect its named members.' : 'This module is open for evidence and scope intake. A model compiler has not been registered.';
  showModel($('model'), manifest?.members);
}
function result(streamId) { return project.build?.manifest?.workstreams?.find(w=>w.id===streamId); }
function stateLabel(record) {
  if (!record) return moduleInfo().can_generate ? 'Awaiting generation' : 'Module intake';
  return (project.build?.stale ? 'Previous build · ' : '') + ({
    ready_for_review:'Ready for review', blocked:'Needs evidence', invalid:'Validation failed',
  }[record.status] || record.status);
}
function markDirty(message) {
  dirty = true;
  $('revision').textContent = 'Unsaved changes';
  if (!rawMode) $('instance').value = pretty(draft);
  if (message) notice(message,true);
  else notice('Changes are local to this form until saved.');
}
function renderEditor() {
  const stream = moduleInfo().workstreams.find(s=>s.id===project.active_workstream);
  collect = editFields($('editor'),draft,stream,project.build?.manifest,markDirty);
  if (!moduleInfo().can_generate && 'scope' in draft) {
    const scope = el('textarea'); scope.rows = 3; scope.value = draft.scope;
    scope.oninput = () => { draft.scope = scope.value; markDirty(); };
    $('editor').append(field('Supported scope',scope));
  }
}
function readInstance() {
  if (rawMode) {
    try { draft = JSON.parse($('instance').value); }
    catch { throw new Error('Correct the JSON in Project instance before saving.'); }
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('Project instance must contain a JSON object.');
  } else collect();
  return draft;
}
async function save(active = project.active_workstream) {
  if (!dirty && active === project.active_workstream) return;
  const payload = {version:project.version, active_workstream:active};
  if (dirty) {
    payload.instance = readInstance();
    payload.notes = {[project.active_workstream]:$('notes').value};
  }
  bindProject(await json(endpoint('save'),payload));
}
function safeLink(url, label) {
  let target;
  try { target = new URL(url, location.href); } catch { return el('span',label); }
  if (!['http:','https:'].includes(target.protocol)) return el('span',label);
  const link = el('a',label); link.href = target.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}
function renderEvidence(target, sources = []) {
  target.replaceChildren();
  if (!sources.length) { target.append(el('p','No evidence attached.','muted')); return; }
  for (const s of sources) {
    const row = el('details',undefined,'source');
    row.append(el('summary',s.title || s.id));
    row.append(safeLink(s.url, 'Open source ↗'));
    if (s.revid || s.revision) row.append(el('small','Revision ' + (s.revid || s.revision) + (s.timestamp ? ' · ' + s.timestamp : '')));
    if (s.excerpt) row.append(el('pre',s.excerpt));
    target.append(row);
  }
}
function renderResult() {
  const record = result(project.active_workstream), box = $('validation');
  box.replaceChildren();
  $('stream-status').textContent = stateLabel(record); $('stream-status').dataset.state = record?.status || '';
  if (project.build?.stale) box.append(el('p','These results are from an earlier instance. Generate again to validate the saved changes.','issue'));
  for (const gap of record?.gaps || []) box.append(el('p',gap,'issue'));
  if (record?.checks?.length) {
    const details = el('details'), list = el('ul');
    details.open = record.checks.some(c => !c.passed);
    details.append(el('summary', `${record.checks.filter(c=>c.passed).length} of ${record.checks.length} software checks passed`));
    for (const c of record.checks) list.append(el('li',(c.passed ? 'Passed · ' : 'Failed · ') + c.name + (c.message ? ' · ' + c.message : '')));
    details.append(list); box.append(details);
  }
  const files = $('files'); files.replaceChildren();
  const artifacts = project.build?.artifacts || [];
  const selected = new Set(record?.files || []);
  const activeFiles = artifacts.filter(a=>selected.has(a.path));
  if (!activeFiles.length) files.append(el('p','No files generated for this workstream.','muted'));
  for (const artifact of activeFiles) {
    const item = el('div',undefined,'sheet-files');
    item.append(safeLink(artifact.url,artifact.path));
    if (artifact.path.endsWith('.svg')) {
      const img = el('img'); img.alt = 'Generated preview of ' + artifact.path; img.src = artifact.url;
      item.append(img);
    }
    files.append(item);
  }
  if (artifacts.length) {
    const details = el('details'); details.append(el('summary','All project files (' + artifacts.length + ')'));
    const list = el('ul');
    for (const a of artifacts) { const li = el('li'); li.append(safeLink(a.url,a.path)); list.append(li); }
    details.append(list); files.append(details);
  }
}
function renderConversation() {
  const panel = $('conversation'); panel.replaceChildren();
  const proposals = [...project.proposals].reverse().filter(p=>p.workstream===project.active_workstream);
  for (const p of proposals) {
    const box = el('article',undefined,'proposal');
    box.append(el('h4',p.prompt), el('p',p.reply));
    if (p.evidence?.length) { const refs = el('div'); renderEvidence(refs,p.evidence); box.append(refs); }
    if (p.diff?.length) {
      const table = el('table'), head = el('tr');
      for (const title of ['Field','Saved value','Proposed value']) head.append(el('th',title));
      table.append(head);
      for (const edit of p.diff) {
        const tr = el('tr');
        for (const cell of [edit.path,pretty(edit.before),pretty(edit.after)]) tr.append(el('td',cell));
        table.append(tr);
      }
      box.append(table);
    }
    if (p.status === 'pending') {
      const accept = el('button','Apply these edits');
      accept.onclick = () => run(async () => {
        await save(); bindProject(await json(endpoint('accept'),{version:project.version,proposal_id:p.id}));
        notice('Applied the selected proposal. Generate again to check the outputs.');
      });
      box.append(accept);
    } else box.append(el('small',`${p.status} · ${p.model || 'Tutor'}`));
    panel.append(box);
  }
}
$('instance').addEventListener('input',() => {
  rawMode = true; $('editor').inert = true; markDirty();
});
$('instance').addEventListener('change',() => {
  try { readInstance(); rawMode = false; renderEditor(); $('editor').inert = false; }
  catch(e) { notice(e.message,true); }
});
$('notes').oninput = () => markDirty();
$('save').onclick = () => run(async () => { await save(); notice('Saved project revision ' + project.version + '.'); });
$('generate').onclick = () => run(async () => {
  await save(); notice('Generating the module and checking outputs…');
  bindProject(await json(endpoint('generate'),{version:project.version}));
  notice('Generation finished. Inspect the checks and open questions for each workstream.');
});
$('refresh-evidence').onclick = () => run(async () => {
  await save();
  notice('Retrieving source revisions from the OSE wiki…');
  bindProject(await json(endpoint('refresh-evidence'),{version:project.version}));
  notice('Source lookup completed. Review the revision details under Source evidence.');
});
$('ask').onclick = () => run(async () => {
  const prompt = $('prompt').value.trim();
  if (!prompt) throw new Error('Enter a tutor question or change request.');
  await save(); notice('Waiting for the configured model…');
  bindProject(await json(endpoint('propose'),{version:project.version,workstream:project.active_workstream,prompt}));
  $('prompt').value = ''; notice('Tutor response saved.');
});
async function download(action, filename) {
  await save();
  const response = await request(endpoint('revisions/' + project.version + '/' + action));
  filename = response.headers.get('Content-Disposition')?.match(/filename="([^"/]+)"/)?.[1] || filename;
  downloadBlob(await response.blob(),filename);
  notice('Downloaded ' + filename + '.');
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = el('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
$('publication').onclick = () => run(()=>download('publication',project.module_id + '-generated.zip'));
$('package').onclick = () => run(()=>download('package',project.module_id + '-project.zip'));
$('wiki').onclick = () => run(()=>download('wiki' + ($('live-wiki').checked ? '?source=live' : ''),project.module_id + '.wikitext'));
$('keep-draft').onclick = () => {
  const backup = {module_id:project.module_id, base_version:project.version, active_workstream:project.active_workstream,
    instance_text:$('instance').value, notes:$('notes').value};
  downloadBlob(new Blob([pretty(backup)],{type:'application/json'}), project.module_id + '-form-values.json');
};
$('reload-project').onclick = () => run(async () => {
  bindProject(await json(endpoint())); $('editor').inert = false;
  notice('Loaded the latest saved revision.');
});
$('create-project').onsubmit = event => {
  event.preventDefault();
  run(async () => {
    if (project && dirty) await save();
    bindProject(await json('/projects',{module_id:$('module').value,name:$('project-name').value.trim()}));
    $('project-name').value = ''; $('prompt').value = '';
    notice('Project created. Select a workstream or generate the first package.');
  });
};
$('project-select').onchange = () => run(async () => {
  const next = $('project-select').value;
  if (!next) return;
  if (project && dirty) await save();
  bindProject(await json('/projects/' + encodeURIComponent(next)));
  $('prompt').value = '';
  notice('Resumed saved project.');
});
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
async function workshopStatus(code) {
  const response = code === undefined
    ? await fetch('/api/credits/status', {cache:'no-store'})
    : await fetch('/api/credits/login', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({code}),
    });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Could not verify your workshop session.');
  return result;
}
async function loadLibrary() {
  const [catalog, listing] = await Promise.all([json('/modules'),json('/projects')]);
  const tasks = await fetch('data/contributions/tasks.json?v=review-1').then(r => r.ok ? r.json() : null).catch(() => null);
  contributionTasks = tasks?.tasks || [];
  modules = catalog.modules; aiAvailable = catalog.ai_available;
  for (const m of modules) $('module').add(new Option(m.id + ' · ' + m.title, m.id));
  $('project-select').add(new Option('Choose a saved project','',true,true));
  $('project-select').options[0].disabled = true;
  for (const p of listing.projects) $('project-select').add(projectOption(p));
  $('library').hidden = false;
  const existing = new URLSearchParams(location.search).get('project');
  if (existing) {
    bindProject(await json('/projects/' + encodeURIComponent(existing))); notice('Resumed saved project.');
  } else notice('Create a project or resume a saved revision.');
}
$('author-join').onsubmit = event => {
  event.preventDefault();
  run(async () => {
    const form = $('author-join');
    const status = await workshopStatus(form.elements.invite.value.trim());
    workshopAccount = status.account_storage_id;
    form.reset();
    form.hidden = true;
    await loadLibrary();
  });
};

async function init() {
  const hosting = await fetch('deployment.json', {cache:'no-store'}).then(r=>r.json());
  if (hosting.backend !== 'same-origin') {
    $('public-example').hidden = false;
    if (hosting.workshop_url) {
      $('open-workspace').href = new URL('author.html', hosting.workshop_url).href;
      $('open-workspace').hidden = false;
      notice('Use your workshop invitation to create a project and generate your own package.');
    } else {
      notice('Explore the wall example below, or use the local setup guide to edit your own project.');
    }
    return;
  }
  if (hosting.workshop) {
    for (const link of document.querySelectorAll('[data-studio-home]')) {
      link.href = 'https://opensourceecology.github.io/iconic-tutor/studio.html';
    }
    const status = await workshopStatus();
    if (!status.authenticated) {
      const form = $('author-join');
      if (invitation) form.elements.invite.value = invitation;
      form.hidden = false;
      notice('Sign in with your workshop invitation to create or resume a module project.');
      return;
    }
    workshopAccount = status.account_storage_id;
  }
  await loadLibrary();
}

async function checkSession() {
  if (!workshopAccount || document.hidden) return;
  const status = await workshopStatus();
  if (status.account_storage_id !== workshopAccount) {
    dirty = false;
    location.reload();
  }
}
document.addEventListener('visibilitychange', () => checkSession().catch(e=>notice(e.message,true)));
window.addEventListener('pageshow', e => { if (e.persisted) checkSession().catch(err=>notice(err.message,true)); });
run(init);
