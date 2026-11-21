// Real Studio for shared claims, then the same UI with the static deployment setting.
// Network requests outside the loopback server are blocked; the wiki remains untouched.
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const repo = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'ose-contribution-browser-'));
const reserve = createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const base = 'http://127.0.0.1:' + port;
const wall = base + '/contribute.html?task=wall-fastening';
const studio = spawn(process.env.PYTHON || 'python3', ['scripts/studio_server.py', '--port', String(port)], {
  cwd:repo, env:{...process.env, STUDIO_AUTHORING_DB:path.join(temp,'studio.sqlite3')}, stdio:['ignore','ignore','pipe'],
});
const stopped = new Promise(resolve => studio.once('exit',resolve));
let logs = '';
studio.stderr.on('data', chunk => { logs = (logs + chunk).slice(-4000); });
const errors = [];
const remoteRequests = [];
let browser;

async function contextFor(staticSite) {
  const context = await browser.newContext({viewport:{width:390,height:844}, acceptDownloads:true,
    permissions:['clipboard-read','clipboard-write']});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base && url.protocol !== 'blob:') {
      remoteRequests.push(url.href);
      return route.abort();
    }
    if (staticSite && url.pathname === '/deployment.json') return route.fulfill({json:{backend:null}});
    if (staticSite && url.pathname.startsWith('/api/')) throw Error('Unexpected backend request on static pilot: ' + url.pathname);
    return route.continue();
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return context;
}
async function question(page) {
  await page.locator('#contributor').fill('Browser volunteer');
  await page.locator('#scope').fill('Identified standard wall example; build revision still unknown.');
  await page.locator('#text').fill('Which build record identifies the connection under review?');
  await page.locator('#source-list input[value="standard-wall-card"]').check();
}
async function importFile(page, json) {
  await page.locator('#import-file').setInputFiles({
    name:'wall-handoff.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(json)),
  });
}

try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (studio.exitCode !== null) throw Error('Studio exited: ' + logs);
    if (await fetch(base + '/deployment.json').then(r => r.ok).catch(() => false)) { ready = true; break; }
    await delay(75);
  }
  assert.ok(ready,'Studio must be ready before browser verification');
  browser = await chromium.launch();
  const context = await contextFor(true);
  const page = await context.newPage();
  await page.goto(wall);
  await page.locator('#copy-claim').waitFor();
  assert.equal(await page.locator('#board').isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.match(await page.locator('#discussion').getAttribute('href'), /title=Talk%3AICHL-015/);
  assert.match(await page.locator('#edit-wiki').getAttribute('href'), /action=edit/);
  await question(page);
  await page.locator('#kind').selectOption('answer');
  assert.equal(await page.locator('#copy-wiki').isDisabled(),true);
  assert.match(await page.locator('#missing').innerText(),/independent build/);
  await page.locator('#kind').selectOption('question');
  await page.locator('.lesson summary').click();
  await page.locator('#help').fill('I needed help finding the revision date.');
  await page.locator('#lesson_step').selectOption('Compare the sources');
  await page.locator('#suggest-lesson').click();
  await page.locator('#use-suggestion').click();
  assert.match(await page.locator('#lesson_feedback').inputValue(),/revision date/);
  const instruction = 'Open the pinned revision and compare the build identifier to the example.';
  await page.locator('#lesson_feedback').fill(instruction);
  await page.locator('#lesson-transfer button').click();
  const transfer = new URL(await page.getByLabel('Lesson link to share').inputValue());
  assert.equal(transfer.searchParams.get('task'),'window-opening');
  const other = await context.newPage();
  await other.goto(base + transfer.pathname.slice(transfer.pathname.lastIndexOf('/')) + transfer.search + transfer.hash);
  assert.equal(await other.locator('aside[aria-label="Lesson correction to try"] blockquote').innerText(),instruction);
  await other.locator('#workspace').waitFor();
  assert.equal(await other.locator('#scope').inputValue(),'');
  assert.equal(await other.locator('#text').inputValue(),'');
  assert.equal(await other.locator('#contributor').inputValue(),'');
  await other.close();
  await page.locator('#copy-wiki').click();
  const wiki = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(wiki,/Open question/);
  assert.ok(wiki.includes(instruction));
  await page.locator('#timer').click();
  await page.waitForFunction(() => document.querySelector('#time').textContent !== '0:00');
  await page.locator('#timer').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(),'wall-fastening-handoff.json');
  const handoff = JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(handoff.draft.lesson_feedback,instruction);
  assert.ok(handoff.draft.active_seconds >= 1);
  const id = handoff.draft.source_ids[0];
  assert.ok(handoff.draft.source_revisions[id]);
  await page.reload();
  await page.locator('#workspace').waitFor();
  assert.equal(await page.locator('#text').inputValue(),handoff.draft.text);
  assert.equal(await page.locator('#lesson_feedback').inputValue(),instruction);
  await context.close();

  const second = await contextFor(false);
  const receiver = await second.newPage();
  await receiver.goto(wall);
  await receiver.locator('#board').waitFor();
  assert.equal(await receiver.locator('#text').inputValue(),'');
  handoff.draft.source_revisions[id] = 'old-source-revision';
  await importFile(receiver,handoff);
  await receiver.locator('#apply-import').click();
  assert.equal(await receiver.locator('#reconcile').isVisible(),true);
  assert.equal(await receiver.locator('#copy-wiki').isDisabled(),true);
  await receiver.locator('#confirm-sources').click();
  assert.equal(await receiver.locator('#copy-wiki').isEnabled(),true);
  await receiver.locator('#claim').click();
  await receiver.waitForFunction(() => !document.querySelector('#save-shared').disabled);
  await receiver.locator('#save-shared').click();
  await receiver.waitForFunction(() => !document.querySelector('#submit').disabled);
  await receiver.locator('#submit').click();
  await receiver.waitForFunction(() => document.querySelector('#shared-status').textContent.includes('ready for review'));
  const record = await fetch(base + '/api/contributions/tasks/wall-fastening').then(r => r.json());
  assert.equal(record.status,'ready_for_review');
  assert.equal(record.handoffs.at(-1).draft.lesson_feedback,instruction);
  assert.notEqual(record.draft.source_revisions[id],'old-source-revision');
  await receiver.goto(base + '/contribute.html?task=window-opening');
  await importFile(receiver,handoff);
  await receiver.waitForFunction(() => document.querySelector('#notice').textContent.includes('before importing'));
  assert.equal(await receiver.locator('#apply-import').isVisible(),false);
  // Use the same browser profile for two actual accounts with the same display name.
  // Enable the invite-only presentation here. test_coach_workshop.py exercises gateway authorization.
  const workshop = await contextFor(false);
  await workshop.route('**/deployment.json', route => route.fulfill({json:{backend:'same-origin',workshop:true}}));
  const makeCode = () => {
    const invitation = execFileSync(process.env.PYTHON || 'python3',
      ['scripts/studio_credits.py','create-account','Workshop participant'],
      {cwd:repo,env:{...process.env,STUDIO_AUTHORING_DB:path.join(temp,'studio.sqlite3')},encoding:'utf8'});
    const match = invitation.match(/(?:code[: ]+)\s*(\S+)/i);
    assert.ok(match,'Test account must provide an invitation');
    return match[1];
  };
  const signIn = async code => {
    const response = await workshop.request.post(base + '/api/credits/login',{data:{code}});
    assert.equal(response.status(),200);
  };
  const codeA = makeCode(), codeB = makeCode();
  const sharedBrowser = await workshop.newPage();
  await sharedBrowser.goto(wall);
  await sharedBrowser.getByText('Open workshop sign-in').waitFor();
  assert.equal(await sharedBrowser.locator('#workspace').isVisible(),false);
  await signIn(codeA);
  await sharedBrowser.reload();
  await sharedBrowser.locator('#board').waitFor();
  await sharedBrowser.locator('#contributor').fill('Workshop participant');
  await sharedBrowser.locator('#text').fill('Private question from participant A');
  await sharedBrowser.locator('#claim').click();
  await sharedBrowser.waitForFunction(() => !document.querySelector('#save-shared').disabled);
  await signIn(codeB);
  await sharedBrowser.reload();
  await sharedBrowser.locator('#board').waitFor();
  assert.equal(await sharedBrowser.locator('#text').inputValue(),'');
  assert.equal(await sharedBrowser.locator('#save-shared').isDisabled(),true);
  await sharedBrowser.locator('#text').fill('Independent question from participant B');
  await signIn(codeA);
  await sharedBrowser.reload();
  await sharedBrowser.locator('#board').waitFor();
  assert.equal(await sharedBrowser.locator('#text').inputValue(),'Private question from participant A');
  assert.equal(await sharedBrowser.locator('#save-shared').isEnabled(),true);
  // An account change in another tab must not use the previous participant's shared claim.
  await signIn(codeB);
  await sharedBrowser.locator('#save-shared').click();
  await sharedBrowser.waitForFunction(() => document.querySelector('#text').value === 'Independent question from participant B');
  assert.equal(await sharedBrowser.locator('#save-shared').isDisabled(),true);
  await workshop.close();
  assert.deepEqual(errors,[]);
  assert.deepEqual(remoteRequests,[]);
  console.log('Contribution browser verification passed: mobile static pilot, lesson transfer, download, resume, revision review, Studio handoff and workshop account switching.');
} finally {
  await browser?.close();
  studio.kill();
  await stopped;
  await rm(temp,{recursive:true,force:true});
}
