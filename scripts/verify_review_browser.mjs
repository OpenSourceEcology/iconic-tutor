// Exercise anonymous portable reviews and one submitted, two-account workshop review in a disposable DB.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const repo = fileURLToPath(new URL('..',import.meta.url));
const tmp = await mkdtemp(path.join(tmpdir(),'ose-review-browser-'));
const available = createServer();
await new Promise(resolve => available.listen(0,'127.0.0.1',resolve));
const port = available.address().port;
await new Promise(resolve => available.close(resolve));
const base = 'http://127.0.0.1:' + port;
const cmd = process.env.PYTHON || 'python3';
const args = ['scripts/coach_workshop.py','--data',tmp];
const cad = path.join(tmp,'cad');
const tool = path.join(cad,'ichl_wall');
await mkdir(path.join(tool,'instances'),{recursive:true});
await writeFile(path.join(tool,'instances/OC16.json'),JSON.stringify({module_id:'ICHL-015',spacing_in:16}));
await writeFile(path.join(tool,'catalog.json'),'{"module_id":"ICHL-015"}');
await writeFile(path.join(tool,'__main__.py'),`import json,sys
from pathlib import Path
args=sys.argv
spacing=json.loads(Path(args[args.index('--instance')+1]).read_text())['spacing_in']
out=Path(args[args.index('--out')+1]); out.mkdir()
(out/'drawing.svg').write_text('<svg><title>OC'+str(spacing)+'</title></svg>')
(out/'manifest.json').write_text(json.dumps({'module_id':'ICHL-015','variant':'OC'+str(spacing),'spacing_in':spacing,'workstreams':[{'id':'drawings','files':['drawing.svg'],'status':'verified'}]}))
`);
const server = spawn(cmd,[...args,'serve','--port',String(port)],{cwd:repo,stdio:'ignore',
  env:{...process.env,STUDIO_ICONIC_ROOT:cad,STUDIO_FREECAD_PYTHON:''}});
const stopped = new Promise(resolve=>server.once('exit',resolve));
let browser;
function invite(label,reviewer) {
  const out = execFileSync(cmd,[...args,'invite',label,...(reviewer?['--reviewer']:[])],{cwd:repo,encoding:'utf8'});
  return out.match(/Private invitation (\S+)/)[1];
}
async function dataFile(page, selector, json) {
  await page.locator(selector).setInputFiles({name:'handback.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(json))});
}
async function getDownload(page,selector) {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  const file = await pending;
  return JSON.parse(await readFile(await file.path(),'utf8'));
}
async function openTask(page) {
  await page.goto(base + '/contribute.html?task=wall-fastening');
  await page.locator('#workspace').waitFor();
}
async function draft(page) {
  if (!(await page.locator('#contributor').evaluate(el => el.readOnly))) await page.locator('#contributor').fill('Browser test contributor');
  await page.locator('#scope').fill('Browser test of the OC16 reference example.');
  await page.locator('#text').fill('Which build record identifies the applicable fastener?');
  await page.locator('#source-list input[value="standard-wall-card"]').check();
}
try {
  let ready = false;
  for (let n=0;n<100;n++) {
    if (await fetch(base+'/deployment.json').then(r=>r.ok).catch(()=>false)) { ready=true; break; }
    await delay(75);
  }
  assert.ok(ready);
  browser = await chromium.launch();
  const errors = [];
  async function pageFor(staticSite=false) {
    const context = await browser.newContext({viewport:{width:390,height:844}});
    await context.route('**/*',async route=>{
      const u = new URL(route.request().url());
      if (u.protocol !== 'blob:' && u.origin !== base) throw Error('Unexpected remote request ' + u.origin);
      if (staticSite && u.pathname.startsWith('/api/')) throw Error('Static review contacted an API');
      if (staticSite && u.pathname==='/deployment.json') return route.fulfill({json:{backend:null}});
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror',err=>errors.push(err.message));
    return page;
  }
  const author = await pageFor(true);
  await openTask(author); await draft(author);
  await author.locator('.lesson summary').click();
  await author.locator('#assistance').selectOption('independent');
  const file = await getDownload(author,'#download');
  assert.equal(file.draft.assistance,'independent');
  const reviewer = await pageFor(true);
  await reviewer.goto(base+'/review.html');
  await dataFile(reviewer,'#handoff-file',file);
  await reviewer.locator('#decision-form').waitFor();
  assert.equal(await reviewer.locator('#citations a').count(),1);
  assert.ok((await reviewer.locator('#citations a').getAttribute('href')).includes(file.draft.source_revisions['standard-wall-card']));
  assert.match(await reviewer.locator('#effects').innerText(),/downloaded handoff/);
  assert.equal(await reviewer.locator('#outcome option[value=accepted]').evaluate(el => el.disabled),true);
  await reviewer.locator('#reviewer').fill('Browser test reviewer');
  await reviewer.locator('#outcome').selectOption('needs_evidence');
  await reviewer.locator('#feedback').fill('Attach a dated build record that identifies the joint.');
  await reviewer.locator('#decide').click();
  const receipt = await getDownload(reviewer,'#download-receipt');
  await dataFile(author,'#receipt-file',receipt);
  await author.getByText('Reviewed handoff matches the open draft.').waitFor();
  assert.match(await author.locator('#receipt-result').innerText(),/Local, unverified review/);
  await author.locator('#text').fill('Changed after the portable review');
  await dataFile(author,'#receipt-file',receipt);
  await author.getByText('Reviewed handoff differs from the open draft.').waitFor();
  const changed = structuredClone(receipt);
  changed.submitted.draft.text = 'Different text in receipt';
  await dataFile(author,'#receipt-file',changed);
  await author.waitForFunction(() => document.querySelector('#notice').textContent.includes('fingerprint'));
  assert.equal(await reviewer.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
  const participant = await pageFor(), official = await pageFor();
  async function signIn(page,name,role) {
    const code = invite(name,role);
    await page.goto(base+'/review.html?task=wall-fastening#invite='+encodeURIComponent(code));
    await page.locator('#invite').waitFor();
    assert.equal(await page.locator('#invite').inputValue(),code);
    assert.equal(new URL(page.url()).hash,'');
    await page.locator('#review-login button').click();
    await page.locator('#review-queue').waitFor();
  }
  await signIn(participant,'Test participant',false);
  await signIn(official,'Test reviewer',true);
  async function post(route,data) {
    const r = await participant.request.post(base+route,{data});
    assert.ok(r.ok(),'Fixture project request failed with status '+r.status());
    return r.json();
  }
  const project = await post('/api/authoring/projects',{module_id:'ICHL-015',name:'Browser test project'});
  const projectRoute = '/api/authoring/projects/'+project.id;
  const first = await post(projectRoute+'/generate',{version:project.version});
  const edited = await post(projectRoute+'/save',{version:first.version,instance:{...project.instance,spacing_in:24}});
  await post(projectRoute+'/generate',{version:edited.version});
  await participant.goto(base+'/contribute.html?task=wall-fastening&project='+project.id);
  await participant.locator('#board').waitFor(); await draft(participant);
  await participant.locator('#claim').click();
  await participant.locator('#submit').click();
  await participant.locator('#task-decisions a').waitFor();
  await participant.locator('#task-decisions a').click();
  await participant.locator('#recorded').waitFor();
  assert.equal(await participant.locator('#decision-form').isVisible(),false);
  await official.locator('#reload-queue').click();
  await official.locator('#decision-form').waitFor();
  assert.match(await official.locator('#submission-ref').innerText(),/Round 1 · Submission revision/);
  assert.match(await official.locator('#effects').innerText(),/OC16 → OC24/);
  assert.match(await official.locator('#effects').innerText(),/drawing.svg/);
  await official.locator('#outcome').selectOption('needs_evidence');
  await official.locator('#feedback').fill('Please provide the build record for this joint.');
  await official.locator('#decide').click();
  await official.waitForFunction(()=>document.querySelector('#recorded').textContent.includes('Please provide the build record'));
  assert.equal(await official.locator('#decision-form').isVisible(),false);
  await participant.reload();
  await participant.getByText('Please provide the build record for this joint.',{exact:false}).waitFor();
  await participant.locator('#back-to-task').click();
  await participant.locator('#task-decisions a').waitFor();
  assert.match(await participant.locator('#task-decisions').innerText(),/Test reviewer/);
  assert.equal(await participant.locator('#claim').isEnabled(),true);
  await participant.locator('#claim').click();
  await participant.locator('#submit').click();
  await participant.waitForFunction(()=>document.querySelectorAll('#task-decisions a').length===2);
  await official.locator('#reload-queue').click();
  await official.waitForFunction(()=>document.querySelector('#round').options.length===3);
  const second = await official.locator('#round option').evaluateAll(rows=>rows.find(r=>r.textContent.includes('round 2')).value);
  await official.locator('#round').selectOption(second);
  await official.locator('#decision-form').waitFor();
  assert.match(await official.locator('#submission-ref').innerText(),/Round 2/);
  assert.match(await official.locator('#effects').innerText(),/OC16 → OC24/);
  await participant.locator('#task-select').selectOption('wall-lumber-quote');
  await participant.waitForURL(url=>url.searchParams.get('task')==='wall-lumber-quote');
  assert.equal(new URL(participant.url()).searchParams.get('project'),project.id);
  await participant.locator('#task-select').selectOption('window-opening');
  await participant.waitForURL(url=>url.searchParams.get('task')==='window-opening');
  assert.equal(new URL(participant.url()).searchParams.has('project'),false);
  assert.deepEqual(errors,[]);
  console.log('Review browser verification passed: portable receipt, source pin, workshop roles, decisions, feedback and resubmission.');
} finally {
  await browser?.close();
  server.kill(); await stopped;
  await rm(tmp,{recursive:true,force:true});
}
