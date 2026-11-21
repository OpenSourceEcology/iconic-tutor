// Exercise the actual Studio server and CAD compiler against a disposable SQLite DB.
// A loopback provider returns one fixed proposal, without external network use.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const repo = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'ose-author-browser-'));
const listen = async server => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  return server.address().port;
};
const provider = createServer(async (request,response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  const context = JSON.parse(body.messages[1].content);
  response.setHeader('Content-Type','application/json');
  const answer = {reply:'Try the second wall configuration and regenerate.', sources:[context.sources[0].id],
    edits:[{path:'/instance/spacing_in',value:24}]};
  response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(answer)}}]}));
});
const modelPort = await listen(provider), reserve = createServer();
const port = await listen(reserve);
await new Promise(resolve=>reserve.close(resolve));
const base = 'http://127.0.0.1:' + port;
const server = spawn(process.env.PYTHON || 'python3', ['scripts/studio_server.py','--port',String(port)], {
  cwd:repo, env:{...process.env,STUDIO_AUTHORING_DB:path.join(temp,'projects.sqlite3'),
    STUDIO_LLM_MODEL:'test-provider',STUDIO_LLM_BASE_URL:'http://127.0.0.1:' + modelPort,STUDIO_LLM_API_KEY:''},
  stdio:['ignore','ignore','pipe'],
});
let logs = '';
server.stderr.on('data', chunk=>{ logs = (logs + chunk).slice(-4000); });
let browser;
try {
  for (let attempt=0; attempt<100; attempt++) {
    if (server.exitCode !== null) throw new Error('Studio exited. ' + logs);
    if (await fetch(base + '/deployment.json').then(r=>r.ok).catch(()=>false)) break;
    await delay(75);
  }
  browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [];
  page.on('pageerror', e=>errors.push(e.message));
  page.setDefaultTimeout(12000);
  const ready = async () => {
    await page.waitForFunction(()=>!document.querySelector('#project').inert && !document.querySelector('#library').inert);
    assert.notEqual(await page.locator('#notice').getAttribute('data-error'),'true',await page.locator('#notice').textContent());
  };
  const click = async selector => { await page.locator(selector).click(); await ready(); };
  const open = id => click(`[data-stream="${id}"]`);
  const generate = () => click('#generate');
  await page.goto(base + '/author.html');
  await page.locator('#project-name').fill('Browser wall');
  await click('#create-project button');
  assert.equal(await page.locator('#streams button').count(),11);
  assert(await page.locator('#generate').isEnabled(), 'Configure the CAD root or run scripts/setup_ichl.py first.');
  await generate();
  assert.equal(await page.locator('#inspect-member option').count(),7);
  await open('drawings');
  await page.locator('input[value="stud.at16.offset"]').check();
  await generate();
  assert.equal(await page.locator('#stream-status').textContent(),'Ready for review');
  assert.equal(await page.locator('#files img').count(),1);
  const image = await page.locator('#files img').getAttribute('src');
  assert.match(await (await page.request.get(base + image)).text(), /stud.at16.offset/);
  await open('geometry');
  await page.locator('#prompt').fill('Change the stud spacing to 24 inches.');
  await click('#ask');
  assert.equal(await page.locator('#spacing').inputValue(),'16','A proposal requires explicit acceptance.');
  assert.match(await page.locator('#conversation').textContent(), /\/instance\/spacing_in/);
  await click('#conversation button');
  assert.equal(await page.locator('#spacing').inputValue(),'24');
  await generate();
  assert.equal(await page.locator('#inspect-member option').count(),6);
  await open('drawings');
  assert.match(await page.locator('#stream-status').textContent(), /Validation failed/);
  await page.locator('input[value="stud.at16.offset"]').uncheck();
  await page.locator('input[value="stud.at24.offset"]').check();
  await generate();
  assert.equal(await page.locator('#stream-status').textContent(),'Ready for review');
  await open('connections');
  const schedule = page.locator('#editor fieldset').first();
  await schedule.getByRole('button',{name:/add stud-to-plate/i}).click();
  await schedule.getByLabel('Hardware ID').fill('fixture.hardware');
  await schedule.getByLabel('Fasteners per joint').fill('2');
  await schedule.getByLabel('Reviewed by').fill('Test fixture');
  await schedule.getByLabel('Evidence or source reference').fill('Synthetic UI test only');
  await page.locator('#notes').fill('Plate schedule still needs evidence.');
  await click('#save');
  await generate();
  assert.match(await page.locator('#validation').textContent(), /plate_fastening/);
  const revision = await page.locator('#revision').textContent();
  await page.reload();
  await page.locator('#stream-title').waitFor();
  assert.equal(await page.locator('#revision').textContent(),revision);
  assert.equal(await page.locator('#notes').inputValue(),'Plate schedule still needs evidence.');
  assert.equal(await page.getByLabel('Hardware ID').inputValue(),'fixture.hardware');
  for (const id of ['wiki','package']) {
    const pending = page.waitForEvent('download');
    await click('#' + id);
    const file = await pending;
    assert.match(file.suggestedFilename(),id === 'wiki' ? /\.wikitext$/ : /\.zip$/);
  }
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),'Mobile authoring fits the viewport.');
  await page.locator('#module').selectOption('ICHL-016');
  await page.locator('#project-name').fill('Window intake');
  await click('#create-project button');
  assert(await page.locator('#generate').isDisabled());
  await page.getByLabel('Supported scope').fill('Identify source drawings for the window module.');
  await click('#save');
  await page.reload();
  assert.equal(await page.getByLabel('Supported scope').inputValue(),'Identify source drawings for the window module.');
  // A remote wiki outage should leave the local notes and pinned evidence intact.
  await page.route('**/refresh-evidence', route => route.fulfill({status:502,
    json:{error:'Current wiki source is unavailable. Previous evidence is preserved.'}}));
  const retainedSources = await page.locator('#evidence details').count();
  await page.locator('#refresh-evidence').click();
  await page.waitForFunction(()=>document.querySelector('#notice').dataset.error === 'true');
  assert.match(await page.locator('#notice').textContent(), /previous evidence/i);
  assert.equal(await page.locator('#evidence details').count(),retainedSources);
  await page.unroute('**/refresh-evidence');
  await page.locator('#notes').fill('My unsaved change');
  const second = await browser.newPage();
  await second.goto(page.url());
  await second.locator('#notes').fill('Saved from another editor');
  await second.locator('#save').click();
  await second.waitForFunction(()=>document.querySelector('#notice')?.textContent.startsWith('Saved project'));
  await page.locator('#save').click();
  await page.locator('#conflict').waitFor();
  assert.equal(await page.locator('#notes').inputValue(),'My unsaved change');
  const backup = page.waitForEvent('download');
  await page.locator('#keep-draft').click();
  assert.match((await backup).suggestedFilename(), /form-values.json$/);
  await click('#reload-project');
  assert.equal(await page.locator('#notes').inputValue(),'Saved from another editor');
  await second.close();

  await page.route('**/deployment.json', route=>route.fulfill({json:{backend:null,workshop_url:'https://workshop.example/coach.html'}}));
  await page.goto(base + '/author.html');
  await page.locator('#public-example').waitFor();
  assert(await page.locator('#library').isHidden());
  assert.equal(await page.locator('#open-workspace').getAttribute('href'),'https://workshop.example/author.html');
  for (const variant of ['OC16','OC24']) {
    assert.ok(await page.locator('#public-example a[href$="' + variant + '.zip"]').isVisible());
    assert.ok(await page.locator('#public-example a[href$="' + variant + '/drawing.svg"]').isVisible());
  }
  assert.deepEqual(errors,[]);
  console.log('PASS wall authoring, proposal approval, variation, stale dimension repair, evidence, downloads, resume, mobile layout and second module intake.');
} finally {
  await browser?.close();
  server.kill();
  provider.close();
  await rm(temp,{recursive:true,force:true});
}
