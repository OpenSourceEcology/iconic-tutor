import assert from 'node:assert/strict';
import { makeDrafts, safeURL, wikiText } from '../web/js/learn-core.js';
import { tracks } from '../web/js/learn-content.js';
const data = {name:'Cabin & test', author:'A', id:'cabin_test', layer:'module', wiki:'https://example.org/wiki', cad:'https://example.org/source', license:'Unknown — review needed', dimensions:'13 ft', description:'[[Category:Test]] <script>alert(1)</script>', validation:'Not tested', limitations:'Fit review needed'};
const draft = makeDrafts(data);
assert.match(draft.wiki, /not yet accepted/);
assert(!draft.wiki.includes('<script>'));
assert(!draft.wiki.includes('[[Category:Test]]'));
assert.equal(new URL(draft.issueURL).searchParams.get('body'), draft.review);
assert.equal(safeURL('javascript:alert(1)'), '');
assert.equal(safeURL('https://user:secret@example.org'), '');
assert.throws(() => makeDrafts({...data, cad:'file:///private/file'}));
assert.throws(() => makeDrafts({...data, id:'not valid'}));
assert.throws(() => makeDrafts({...data, author:''}));
assert(!wikiText('{{template}}').includes('{{'));
assert(new URL(makeDrafts({...data, description:'x'.repeat(6000)}).issueURL).searchParams.get('body').includes('paste'));
for (const track of Object.values(tracks)) for (const step of track.steps) {
  assert(step.help.length >= 2);
  assert(step.checklist || step.options[step.correct]);
}
console.log('PASS learning content and draft safety');
