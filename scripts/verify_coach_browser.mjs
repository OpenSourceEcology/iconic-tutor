// Walk both a public visitor and an invited builder through their respective entry points.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const python = process.env.PYTHON || 'python3', root = await mkdtemp(path.join(tmpdir(),'ose-coach-'));
const args = ['scripts/coach_workshop.py','--data',root];
const invitation = execFileSync(python,[...args,'invite','Browser builder'],{encoding:'utf8'}).match(/Private invitation (\S+)/)[1];
const reserve = createServer();
await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
const port = reserve.address().port;
await new Promise(resolve=>reserve.close(resolve));
const base = 'http://127.0.0.1:' + port;
const workshop = spawn(python,[...args,'serve','--port',String(port)],{env:{...process.env,STUDIO_LLM_BASE_URL:'',STUDIO_FRONTIER_BASE_URL:''},stdio:['ignore','ignore','pipe']});
const stopped = new Promise(resolve=>workshop.once('exit',resolve));
let log = '', browser;
workshop.stderr.on('data',chunk=>{log=(log+chunk).slice(-2000);});
try {
  for (let i=0;i<100;i++) {
    if (workshop.exitCode !== null) throw Error(log);
    if (await fetch(base+'/deployment.json').then(r=>r.ok).catch(()=>false)) break;
    await delay(75);
  }
  browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[],publicApi=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/deployment.json',route=>route.fulfill({json:{backend:null}}));
  await page.route('**/api/**',route=>{publicApi.push(route.request().url());return route.abort();});
  await page.goto(base+'/coach.html');
  await page.getByRole('heading',{name:'Start a wall project'}).waitFor();
  await page.locator('#frame').evaluate(img=>img.decode());
  await page.locator('#example').selectOption('OC24');
  assert.match(await page.locator('#frame').getAttribute('src'),/OC24.svg/);
  await page.locator('#lesson').selectOption('qc');
  await page.locator('#field-note').fill('Ask the builder for the specimen record.');
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#field-note').value.includes('specimen record'));
  assert.equal(await page.locator('#chat').isVisible(),false);
  await page.locator('#lesson').selectOption('wiki');
  assert.ok(await page.getByRole('link',{name:/OSE file upload/}).isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(publicApi,[]);
  await page.unroute('**/deployment.json'); await page.unroute('**/api/**');
  await page.goto(base+'/coach.html');
  await page.locator('[name=invite]').fill(invitation);
  await page.getByRole('button',{name:'Join workshop'}).click();
  await page.locator('#start button').click();
  await page.locator('#chat').waitFor();
  async function lesson(id) {
    await page.locator('#lesson').selectOption(id);
    await page.waitForFunction(id=>new URL(location.href).searchParams.get('lesson')===id,id);
  }
  async function action(label) {
    await page.locator('#actions').getByRole('button',{name:label,exact:true}).click();
    await page.locator('#proposal').getByRole('button').click();
    await page.locator('#proposal').waitFor({state:'hidden'});
  }
  await lesson('geometry'); await action('Generate and check this wall');
  await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('ready for review'));
  await lesson('drawings'); await action('Dimension the offset of stud.at16');
  await lesson('variation'); await action('Change to 24-inch spacing');
  await lesson('repair');
  assert.match(await page.locator('#result').textContent(),/invalid|stud.at16/i);
  await action('Repair the obsolete stud dimension');
  assert.match(await page.locator('#result').textContent(),/ready for review/);
  await lesson('connections');
  await page.locator('#question').fill('Which source names the wall build and joint?');
  await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#question').value==='');
  assert.ok(await page.locator('#messages a').count()>0);
  await page.locator('#field-note').fill('Ask the build lead for a dated connection schedule.');
  await action('Save a workstream note');
  const projectId=new URL(page.url()).searchParams.get('project');
  const p=await (await page.request.get(base+'/api/authoring/projects/'+projectId)).json();
  assert.match(p.notes.connections,/dated connection/);
  await lesson('wiki');
  for (const label of ['Download private project backup','Download wiki draft','Download generated files for wiki upload']) {
    const promised=page.waitForEvent('download');
    await page.getByRole('link',{name:label,exact:true}).click();
    const file=await promised;
    assert.match(file.suggestedFilename(),/\.(zip|wikitext)$/);
  }
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#title').textContent.includes('wiki handoff'));
  assert.ok(await page.locator('#messages .message').count()>2);
  await page.locator('#library summary').click();
  await page.locator('#module').selectOption('ICHL-016');
  await page.locator('#name').fill('Window measurements');
  await page.locator('#start button').click();
  await page.waitForFunction(()=>document.querySelector('#project-label').textContent.includes('ICHL-016'));
  assert.equal(await page.locator('#actions').getByRole('button',{name:'Generate and check this wall'}).count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('PASS public lessons, mobile notes, workshop invitation, confirmed CAD edits, drawing repair, cited guidance, revision downloads and window intake.');
} finally { await browser?.close();workshop.kill();await stopped;await rm(root,{recursive:true,force:true}); }
