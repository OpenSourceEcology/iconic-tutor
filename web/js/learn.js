import { tracks } from './learn-content.js?v=1';
import { makeDrafts } from './learn-core.js?v=1';
const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const trackID = params.get('track') === 'freecad' ? 'freecad' : 'wiki';
const track = tracks[trackID];
const storageKey = `iconic-tutor-learning-${trackID}-v1`;
function read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
let done = read(storageKey, []);
done = Array.isArray(done) ? done.filter(x => Number.isInteger(x) && x >= 0 && x < track.steps.length) : [];
let step = Math.max(0, Math.min(track.steps.length - 1, Number.parseInt(params.get('step'), 10) || 0));
$('#title').textContent = track.title;
document.title = `${trackID === 'wiki' ? 'Wiki & design sharing' : 'FreeCAD & assistance'} · Iconic Tutor`;
$('#intro').textContent = track.intro;
$(`[data-track="${trackID}"]`).setAttribute('aria-current', 'page');
$('#draft-section').hidden = trackID !== 'wiki';
for (const [label, href] of track.sources) {
  const a = document.createElement('a'); a.textContent = `${label} ↗`; a.href = href; a.target = '_blank'; a.rel = 'noopener'; $('#sources').append(a);
}
function complete() {
  if (!done.includes(step)) done.push(step);
  const saved = save(storageKey, done);
  renderPath();
  if (!saved) $('#feedback').textContent += ' Progress could not be saved in this browser.';
}
function renderPath() {
  $('#progress').textContent = `${done.length} of ${track.steps.length} steps completed`;
  $('#steps').replaceChildren();
  track.steps.forEach((item, index) => {
    const button = document.createElement('button'); button.textContent = `${done.includes(index) ? '✓' : index + 1} · ${item.title}`;
    if (index === step) button.setAttribute('aria-current', 'step');
    button.onclick = () => { step = index; render(true); }; $('#steps').append(button);
  });
}
function render(focus = false) {
  const item = track.steps[step]; renderPath();
  $('#step-number').textContent = `${trackID === 'wiki' ? 'SHARED KNOWLEDGE' : 'FREECAD'} / ${String(step + 1).padStart(2, '0')}`;
  $('#step-title').textContent = item.title;
  $('#instruction').innerHTML = item.html; // Repository-authored lesson content only.
  $('#exercise').replaceChildren(); $('#feedback').textContent = ''; $('#answer').textContent = '';
  if (item.question) {
    const box = document.createElement('div'); box.className = 'quiz';
    const heading = document.createElement('h3'); heading.textContent = 'Check your understanding'; box.append(heading);
    const q = document.createElement('p'); q.textContent = item.question; box.append(q);
    item.options.forEach((label, index) => { const button = document.createElement('button'); button.textContent = label; button.onclick = () => {
      if (index === item.correct) { $('#feedback').textContent = `That’s right. ${item.explanation}`; complete(); }
      else $('#feedback').textContent = `Not quite. ${item.explanation} Try again.`;
    }; box.append(button); }); $('#exercise').append(box);
  } else {
    const label = document.createElement('label'); label.className = 'check-row'; const input = document.createElement('input'); input.type = 'checkbox'; input.checked = done.includes(step);
    input.onchange = () => { if (input.checked) { $('#feedback').textContent = 'Step recorded. Continue when you are ready.'; complete(); } else { done = done.filter(x => x !== step); save(storageKey, done); renderPath(); } };
    label.append(input, document.createTextNode(item.checklist)); $('#exercise').append(label);
  }
  $('#questions').replaceChildren();
  for (const [question, answer] of item.help) { const button = document.createElement('button'); button.textContent = question; button.onclick = () => { $('#answer').textContent = answer; }; $('#questions').append(button); }
  $('#back').disabled = step === 0; $('#next').disabled = step === track.steps.length - 1;
  history.replaceState(null, '', `?track=${trackID}&step=${step}`);
  if (focus) $('#step-title').focus();
}
$('#back').onclick = () => { if (step > 0) { step--; render(true); } };
$('#next').onclick = () => { if (step < track.steps.length - 1) { step++; render(true); } };
$('#reset-progress').onclick = () => { done = []; save(storageKey, done); render(); };
const form = $('#design-form');
const draftKey = 'iconic-tutor-contribution-draft-v1';
const prior = read(draftKey, {});
if (prior && typeof prior === 'object') for (const element of form.elements) if (element.name && typeof prior[element.name] === 'string') element.value = prior[element.name];
let drafts = null;
form.addEventListener('input', () => {
  const saved = save(draftKey, Object.fromEntries(new FormData(form)));
  drafts = null; $('#draft-output').hidden = true;
  $('#draft-status').textContent = saved ? 'Draft inputs saved in this browser. Rebuild after changes.' : 'Browser storage unavailable. Keep this tab open and download your draft.';
});
form.addEventListener('submit', event => {
  event.preventDefault();
  try {
    drafts = makeDrafts(Object.fromEntries(new FormData(form)));
    $('#wiki-draft').value = drafts.wiki; $('#review-draft').value = drafts.review;
    $('#wiki-open').href = drafts.wikiURL; $('#review-open').href = drafts.issueURL;
    $('#draft-output').hidden = false;
    $('#draft-status').textContent = 'Drafts ready. Nothing has been submitted. Review and download before opening a destination.';
  } catch (error) { $('#draft-status').textContent = error.message; $('#draft-output').hidden = true; }
});
function download(kind, extension) {
  if (!drafts) return;
  const url = URL.createObjectURL(new Blob([drafts[kind]], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `design-${kind}.${extension}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('#download-wiki').onclick = () => download('wiki', 'wiki');
$('#download-review').onclick = () => download('review', 'md');
render();
