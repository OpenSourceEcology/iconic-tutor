import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {contributionStorageKeys, emptyDraft, handoffFormat, readDraft, readHandoff, readiness, staleSources, steps, suggestedLesson, volunteerClaim, wikitext} from '../web/js/contribute-core.js';

assert.deepEqual(contributionStorageKeys('wall-fastening','p1',false), {
  draft:'ose.contribution.1.wall-fastening.p1',claim:'ose.contribution.claim.wall-fastening',
});
assert.throws(() => contributionStorageKeys('wall-fastening','',true,null));
const keyA = contributionStorageKeys('wall-fastening','',true,'a'.repeat(64));
const keyB = contributionStorageKeys('wall-fastening','',true,'b'.repeat(64));
assert.notEqual(keyA.claim,keyB.claim);
assert.notEqual(keyA.draft,keyB.draft);

const {tasks} = JSON.parse(readFileSync(new URL('../web/data/contributions/tasks.json', import.meta.url)));
const task = tasks[0], source = task.sources[0];
const draft = {
  ...emptyDraft(task.id), contributor:'Test builder', scope:'Reference wall OC16.',
  text:'Which build record covers the stud end?', source_ids:[source.id],
  source_revisions:{[source.id]:source.revision}, active_seconds:32,
};
assert.deepEqual(readiness(task,draft), []);
assert.match(wikitext(task,draft), /Open question/);
assert(wikitext(task,draft).includes(source.url));
assert.match(volunteerClaim(task,draft), /Test builder/);

const proposed = {...draft, kind:'answer'};
assert(readiness(task,proposed).length > 0);
for (const link of [source.url + '#extra', source.url.replace(source.revision,'main'), 'https://wiki.opensourceecology.org/wiki/Iconic_CAD_Workflow_Example']) {
  assert(readiness(task,{...proposed, additional_source:link}).some(issue=>issue.includes('independent')));
}
assert.deepEqual(readiness(task,{...proposed, additional_source:'https://example.org/review/001'}), []);
assert(readiness(task,{...draft, additional_source:'javascript:alert(1)'}).length > 0);
assert(readiness(task,{...draft, additional_source:'https://secret@example.org'}).length > 0);
assert(readiness(task,{...draft, additional_source:'https://example.org/%F0'}).length > 0);
assert(!wikitext(task,{...draft, text:'</nowiki><script>bad</script>\n== pretend heading =='}).includes('<script>'));
assert(!wikitext(task,{...draft, additional_source:'https://example.org/]bad'}).includes('/]bad'));

const old = {...draft, source_revisions:{[source.id]:'old'}};
assert.deepEqual(staleSources(task,old),[source.id]);
assert.throws(()=>wikitext(task,old), /changed sources/);
assert.deepEqual(readHandoff(JSON.stringify({format:handoffFormat, draft:old}),tasks),old);
assert.throws(()=>readHandoff('{}',tasks), /handoff/);
assert.throws(()=>readHandoff('X'.repeat(80001),tasks), /80 KB/);
assert.throws(()=>readDraft({...draft, source_ids:['__proto__']},task.id));
assert.throws(()=>readDraft({...draft, help:{x:1}},task.id));
assert.throws(()=>readDraft(draft,tasks[1].id), /different task/);

assert.match(suggestedLesson(task,steps[2],'Could not identify the build'),/Could not identify the build/);
assert.match(wikitext(task,{...draft,lesson_step:steps[2],lesson_feedback:'Compare the records by build.'}), /Suggested lesson correction/);
assert(readiness(task,{...draft,lesson_feedback:'Example',lesson_step:''}).length > 0);
console.log('PASS contribution drafts, scope evidence, revision drift, lesson feedback, safe wiki export and handoff.');

for (const t of tasks.filter(t => t.answer_evidence)) {
  const d = {...emptyDraft(t.id),kind:'answer',contributor:'Test participant',scope:'Review scope',
    text:'Proposed observation',source_ids:[t.sources[0].id],source_revisions:{[t.sources[0].id]:t.sources[0].revision}};
  assert(readiness(t,d).includes(t.answer_evidence));
  assert(readiness(t,{...d,additional_source:t.sources[0].url}).includes(t.answer_evidence));
  assert.deepEqual(readiness(t,{...d,additional_source:'https://example.org/build-record/1'}),[]);
  assert.deepEqual(readiness(t,{...d,kind:'question'}),[]);
}
