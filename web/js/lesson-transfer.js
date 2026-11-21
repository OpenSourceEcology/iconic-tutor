import {steps} from './contribute-core.js?v=review-1';

// A receiver can try a proposed teaching change without importing the originating
// module's answer, contributor identity, or project. Only the instruction travels.
const publicPage = 'https://opensourceecology.github.io/iconic-tutor/contribute.html';
const examples = new Map([['wall-fastening', 'ICHL-015'], ['window-opening', 'ICHL-016']]);
const maxInstruction = 600;

function makeLink(from, step, instruction) {
  if (!examples.has(from) || !steps.includes(step) || !instruction || instruction.length > maxInstruction) {
    throw Error('Choose a teaching step and enter a correction of 1–600 characters to share.');
  }
  const next = [...examples.keys()].find(id => id !== from);
  const link = new URL(publicPage);
  link.searchParams.set('task', next);
  link.hash = new URLSearchParams({from, step, instruction}).toString();
  return link;
}

function showIncoming() {
  const task = new URLSearchParams(location.search).get('task');
  const note = new URLSearchParams(location.hash.slice(1));
  const from = note.get('from');
  const step = note.get('step');
  const instruction = note.get('instruction')?.trim();
  if (!examples.has(task) || !examples.has(from) || task === from || !steps.includes(step) ||
      !instruction || instruction.length > maxInstruction) return;

  const aside = document.createElement('aside');
  aside.className = 'source-card';
  aside.setAttribute('aria-label', 'Lesson correction to try');
  const title = document.createElement('h2');
  title.textContent = 'Lesson correction to try';
  const context = document.createElement('p');
  context.textContent = 'Suggested during ' + examples.get(from) + ' · ' + step;
  const quote = document.createElement('blockquote');
  quote.textContent = instruction;
  const hint = document.createElement('p');
  hint.textContent = 'Try this instruction during the task. Use lesson feedback to record whether it helped.';
  aside.append(title, context, quote, hint);
  document.querySelector('#workspace .brief').after(aside);
}

const share = document.getElementById('lesson-transfer');
if (share) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Make a link to test this correction on another module';
  const result = document.createElement('p');
  result.setAttribute('aria-live', 'polite');
  share.append(button, result);
  const clear = () => result.replaceChildren();
  document.getElementById('lesson_feedback').addEventListener('input', clear);
  document.getElementById('lesson_step').addEventListener('change', clear);
  button.addEventListener('click', () => {
    try {
      const url = makeLink(document.getElementById('task-select').value,
        document.getElementById('lesson_step').value, document.getElementById('lesson_feedback').value.trim());
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = 'Try this instruction on ' + examples.get(url.searchParams.get('task'));
      const field = document.createElement('input');
      field.readOnly = true;
      field.value = url.href;
      field.setAttribute('aria-label', 'Lesson link to share');
      field.addEventListener('focus', () => field.select());
      result.replaceChildren(link, field);
    } catch (error) {
      result.textContent = error.message;
    }
  });
  showIncoming();
}
