import {chapters, sources, audiencePrompts, bookMarkdown} from './book-content.js?v=3';
const $ = s => document.querySelector(s);
const element = (tag, text, cls) => {const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el;};
function read(key, fallback) {try {return JSON.parse(localStorage.getItem(key)) ?? fallback;} catch {return fallback;}}
function save(key, data) {try {localStorage.setItem(key, JSON.stringify(data)); return true;} catch {return false;}}
const progressKey = 'iconic-book-reading-v1', storyKey = 'iconic-book-story-v1';
let readChapters = read(progressKey, []);
readChapters = Array.isArray(readChapters) ? [...new Set(readChapters.filter(id => chapters.some(c => c.id === id)))] : [];
function progress() {$('#reading-progress').textContent = `${readChapters.length} of ${chapters.length} chapters marked read`;}
function sourceLink(source) {const a = element('a', source.title + ' ↗'); a.href = source.url; a.target = '_blank'; a.rel = 'noopener'; return a;}
for (const chapter of chapters) {
  const anchor = element('a', chapter.title); anchor.href = `#chapter-${chapter.id}`; $('#contents').append(anchor);
  const section = element('section', '', 'book-chapter'); section.id = `chapter-${chapter.id}`;
  section.append(element('p', chapter.subtitle, 'eyebrow'), element('h2', chapter.title));
  for (const paragraph of chapter.paragraphs) section.append(element('p', paragraph));
  if (chapter.ladder) {const ladder = element('div', '', 'project-ladder'); for (const [label, title, text] of chapter.ladder) {const item = element('div'); item.append(element('span',label), element('h3',title), element('p',text)); ladder.append(item);} section.append(ladder);}
  section.append(element('p', chapter.question, 'chapter-question'));
  const references = element('div', '', 'chapter-sources'); references.append(document.createTextNode('Read the source: '));
  chapter.sources.forEach((id,index) => {if (index) references.append(document.createTextNode(' · ')); references.append(sourceLink(sources.find(s => s.id === id)));}); section.append(references);
  const button = element('button');
  const updateButton = () => {const marked = readChapters.includes(chapter.id); button.textContent = marked ? '✓ Read · click to unmark' : 'Mark chapter read'; button.setAttribute('aria-pressed', String(marked));};
  button.onclick = () => {readChapters = readChapters.includes(chapter.id) ? readChapters.filter(id => id !== chapter.id) : [...readChapters, chapter.id]; const saved = save(progressKey, readChapters); updateButton(); progress(); if (!saved) $('#reading-progress').textContent += ' · browser storage unavailable';};
  updateButton(); section.append(button); $('#chapters').append(section);
}
progress();
function renderSources() {
  const query = $('#source-search').value.toLowerCase().trim();
  const selected = sources.filter(s => (!$('#canon-only').checked || s.canon) && `${s.title} ${s.note} ${s.kind}`.toLowerCase().includes(query));
  $('#source-list').replaceChildren();
  for (const source of selected) {const card = element('article', '', 'source-card'); card.append(sourceLink(source), element('span', source.kind, `source-badge${source.canon ? ' canon' : ''}`), element('p', source.note)); $('#source-list').append(card);}
  $('#source-count').textContent = selected.length ? `${selected.length} of ${sources.length} reading-list pages` : 'No matching pages. Try another topic or clear the canon filter.';
}
$('#source-search').oninput = renderSources; $('#canon-only').onchange = renderSources; renderSources();
function download(text, filename) {const url = URL.createObjectURL(new Blob([text], {type:'text/markdown;charset=utf-8'})); const a = element('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);}
$('#download-book').onclick = () => download(bookMarkdown(), 'mini-ose-book.md');
$('#print-book').onclick = () => window.print();
// Print always includes the complete reading trail, not only a current filter.
let beforePrint = null;
window.addEventListener('beforeprint', () => {beforePrint = [$('#source-search').value, $('#canon-only').checked]; $('#source-search').value = ''; $('#canon-only').checked = false; renderSources();});
window.addEventListener('afterprint', () => {if (beforePrint) {[$('#source-search').value, $('#canon-only').checked] = beforePrint; beforePrint = null; renderSources();}});
const form = $('#story-form'); const prior = read(storyKey, {});
if (prior && typeof prior === 'object') {for (const el of form.elements) if (el.name && typeof prior[el.name] === 'string') el.value = prior[el.name]; if (Object.hasOwn(audiencePrompts,prior.audience)) $('#story-audience').value = prior.audience;}
function updatePrompt() {$('#audience-prompt').textContent = audiencePrompts[$('#story-audience').value];}
function saveStory() {const stored = save(storyKey,{...Object.fromEntries(new FormData(form)),audience:$('#story-audience').value}); $('#story-status').textContent = stored ? 'Saved in this browser.' : 'Browser storage unavailable. Download your draft before leaving this page.';}
$('#story-audience').onchange = () => {updatePrompt(); saveStory();}; form.oninput = saveStory; updatePrompt();
form.onsubmit = event => {event.preventDefault(); const data = Object.fromEntries(new FormData(form)); if (Object.values(data).some(value => !value.trim())) {$('#story-status').textContent = 'Please complete each part of your story.'; return;} const text = `# My OSE story draft\n\nAudience: ${$('#story-audience').selectedOptions[0].text}\n\n## Possibility\n${data.possibility}\n\n## Example and source\n${data.example}\n\n## Uncertainty / evidence still needed\n${data.unknown}\n\n## Invitation\n${data.invitation}\n\nReading guide: https://opensourceecology.github.io/iconic-tutor/book.html\n`; download(text,'my-ose-story.md'); $('#story-status').textContent = 'Story downloaded.';};
// Chapters are inserted synchronously; honor a direct chapter link on first load.
if (location.hash) {let id = location.hash.slice(1); try {id = decodeURIComponent(id);} catch { /* Ignore malformed URL escapes. */ } const target = document.getElementById(id); if (target) target.scrollIntoView();}
