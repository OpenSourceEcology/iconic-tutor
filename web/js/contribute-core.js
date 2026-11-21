// The same draft travels between the static site, local Studio and a second contributor.
export const limits = {
  contributor: 100, scope: 3000, text: 3000, additional_source: 2000,
  help: 3000, lesson_step: 300, lesson_feedback: 3000,
};
export const handoffFormat = 'ose-module-contribution/v1';
export const steps = ['Compare the sources', 'Identify the applicable build', 'Write the contribution', 'Hand off the result'];

export function emptyDraft(taskId) {
  return {
    task_id: taskId, kind: 'question', contributor: '', scope: '', text: '', source_ids: [],
    source_revisions: {}, additional_source: '', active_seconds: 0, help: '', lesson_step: '', lesson_feedback: '',
  };
}

export function readDraft(data, taskId) {
  if (!data || data.task_id !== taskId) throw Error('This draft belongs to a different task.');
  const draft = emptyDraft(taskId);
  if (!['answer', 'question'].includes(data.kind)) throw Error('Unknown contribution type.');
  draft.kind = data.kind;
  if (data.assistance !== undefined && !['unreported','independent','assisted'].includes(data.assistance)) {
    throw Error('Invalid assistance selection.');
  }
  if (data.assistance && data.assistance !== 'unreported') draft.assistance = data.assistance;
  for (const [key, limit] of Object.entries(limits)) {
    const value = data[key] ?? '';
    if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw Error('Invalid field: ' + key);
    draft[key] = value;
  }
  if (!Number.isInteger(data.active_seconds) || data.active_seconds < 0 || data.active_seconds > 31536000) {
    throw Error('Invalid active time.');
  }
  draft.active_seconds = data.active_seconds;
  if (!Array.isArray(data.source_ids) || data.source_ids.length > 64 ||
      data.source_ids.some(id => typeof id !== 'string' || !/^[\w.-]{1,100}$/.test(id) || ['__proto__','constructor','prototype'].includes(id))) {
    throw Error('Invalid source selection.');
  }
  if (!data.source_revisions || typeof data.source_revisions !== 'object' || Array.isArray(data.source_revisions)) {
    throw Error('Source revisions are missing.');
  }
  draft.source_ids = [...new Set(data.source_ids)];
  for (const id of draft.source_ids) {
    const revision = Object.hasOwn(data.source_revisions, id) ? data.source_revisions[id] : '';
    if (typeof revision !== 'string' || revision.length > 160) throw Error('Invalid source revision.');
    draft.source_revisions[id] = revision;
  }
  return draft;
}

export function readHandoff(text, tasks) {
  if (text.length > 80000) throw Error('Choose a handoff file smaller than 80 KB.');
  const data = JSON.parse(text);
  if (data?.format !== handoffFormat || !data.draft) throw Error('Choose an Iconic Tutor contribution handoff.');
  const task = tasks.find(t => t.id === data.draft.task_id);
  if (!task) throw Error('This task is missing from the catalog.');
  return readDraft(data.draft, task.id);
}

export function staleSources(task, draft) {
  return draft.source_ids.filter(id => !task.sources.some(s => s.id === id && s.revision === draft.source_revisions[id]));
}

function sourceURL(value) {
  try {
    const url = new URL(value);
    decodeURIComponent(url.pathname); // Reject malformed percent escapes before comparing source paths.
    if (/\s/.test(value) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    // Preserve address semantics while excluding MediaWiki link/HTML delimiters.
    return url.href.replace(/[\s\[\]<>{}|"'\x60]/g, char => encodeURIComponent(char).replace(/'/g, '%27'));
  } catch { return ''; }
}

function sameReference(value, source) {
  const candidate = new URL(value);
  const original = new URL(source.url);
  const path = decodeURIComponent(candidate.pathname).replace(/\/$/, '');
  if (candidate.hostname === original.hostname && path === decodeURIComponent(original.pathname).replace(/\/$/, '') &&
      candidate.search === original.search) return true;
  if (source.kind === 'wiki' && candidate.hostname === original.hostname) {
    const title = source.wiki_page?.replaceAll('_', ' ');
    if (candidate.searchParams.get('oldid') === source.revision) return true;
    return (path.startsWith('/wiki/') && path.slice(6).replaceAll('_', ' ') === title) ||
      (path === '/index.php' && candidate.searchParams.get('title')?.replaceAll('_', ' ') === title);
  }
  if (source.kind === 'git' && ['github.com','raw.githubusercontent.com'].includes(candidate.hostname)) {
    const repo = original.pathname.split('/').slice(0,3).join('/').toLowerCase() + '/';
    return path.toLowerCase().startsWith(repo) && path.endsWith('/' + source.repo_path);
  }
  return false;
}

export function suggestedLesson(task, step, obstacle) {
  const instructions = [
    'Show the exact quote and revision, then ask what the source establishes and what is still missing.',
    'Ask for a build identifier and a source connecting it to the joint or interface. Show where to record uncertainty.',
    'Compare an open question with a reviewable answer. Have the contributor identify which one their evidence supports.',
    'Have the next contributor open the handoff and identify the recorded scope, citations and remaining question.',
  ];
  const instruction = instructions[steps.indexOf(step)];
  if (!instruction || !obstacle.trim()) throw Error('Select the teaching step and describe where you needed help.');
  return ('During “' + step + '” for ' + task.module_id + ', address this obstacle: “' + obstacle.trim().slice(0,450) +
    '”. ' + instruction);
}

export function readiness(task, draft) {
  const issues = [];
  if (!draft.contributor.trim()) issues.push('Enter a contributor name.');
  if (!draft.scope.trim()) issues.push('Describe the build or scope.');
  if (!draft.text.trim()) issues.push(draft.kind === 'question' ? 'Write the question for the next contributor.' : 'Write the supported answer.');
  if (!draft.source_ids.length && !draft.additional_source.trim()) issues.push('Cite at least one source.');
  if (draft.additional_source.trim() && !sourceURL(draft.additional_source.trim())) issues.push('Enter an http or https source URL without sign-in details.');
  if ((task.answer_evidence || task.id === 'wall-fastening') && draft.kind === 'answer') {
    const extra = sourceURL(draft.additional_source.trim()).split('#')[0];
    if (!extra || task.sources.some(s => sameReference(extra, s))) {
      issues.push(task.answer_evidence || 'Cite an independent build or reviewer record for the proposed fastening answer.');
    }
  }
  if (staleSources(task, draft).length) issues.push('Review changed sources before preparing current wikitext.');
  if (draft.lesson_feedback.trim() && !draft.lesson_step.trim()) issues.push('Choose the teaching step for your suggested correction.');
  return issues;
}

function literal(value) {
  // Encode the characters that could terminate nowiki before wrapping contributor input.
  // Collapse newlines to keep each value within its own wiki list item.
  return '<nowiki>' + value.trim().replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replace(/\s+/g, ' ') + '</nowiki>';
}

export function wikitext(task, draft) {
  const issues = readiness(task, draft);
  if (issues.length) throw Error(issues.join(' '));
  const lines = [
    '=== ' + literal(task.module_id + ' · ' + task.title) + ' ===',
    "* '''Contributor''' — " + literal(draft.contributor),
    "* '''Applicable build or scope''' — " + literal(draft.scope),
    "* '''" + (draft.kind === 'question' ? 'Open question' : 'Proposed answer for review') + "''' — " + literal(draft.text),
    "* '''Sources'''",
  ];
  for (const id of draft.source_ids) {
    const source = task.sources.find(s => s.id === id);
    const url = sourceURL(source.url);
    if (!url) throw Error('Invalid catalog source URL.');
    lines.push('** [' + url + ' Source] — ' + literal(source.title + ' · ' + source.revision));
  }
  if (draft.additional_source.trim()) lines.push('** [' + sourceURL(draft.additional_source.trim()) + ' Contributor source]');
  if (draft.lesson_feedback.trim()) {
    lines.push("* '''Suggested lesson correction''' — " + literal(draft.lesson_step + ' — ' + draft.lesson_feedback));
  }
  return lines.join('\n');
}

export function volunteerClaim(task, draft) {
  if (!draft.contributor.trim()) throw Error('Enter your contributor name before copying a claim.');
  return "* " + literal(draft.contributor) + " is investigating " + literal(task.module_id + ' · ' + task.title) +
    ". Please add any relevant build evidence to this discussion.";
}

// Public and single-user Studio installs retain their existing browser drafts.
export function contributionStorageKeys(task, project, workshop, accountId) {
  if (workshop && (typeof accountId !== 'string' || !/^[0-9a-f]{64}$/.test(accountId))) {
    throw Error('Sign in to this workshop before opening a contribution draft.');
  }
  const prefix = workshop ? 'ose.workshop.' + accountId + '.' : 'ose.';
  return {
    draft: prefix + 'contribution.1.' + task + '.' + project,
    claim: prefix + 'contribution.claim.' + task,
  };
}
