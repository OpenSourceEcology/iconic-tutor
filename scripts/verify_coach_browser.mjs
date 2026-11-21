// Walk both a public visitor and an invited builder through their respective entry points.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {createServer as modelServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';

const python = process.env.PYTHON || 'python3', root = await mkdtemp(path.join(tmpdir(),'ose-coach-'));
const args = ['scripts/coach_workshop.py','--data',root];
const issued = execFileSync(python,[...args,'invite','Browser builder'],{encoding:'utf8'});
const invitation = issued.match(/Private invitation (\S+)/)[1], account = issued.match(/Account (\S+)/)[1];
execFileSync(python,['scripts/studio_credits.py','grant-test',account,'500',randomUUID()],{
  env:{...process.env,STUDIO_AUTHORING_DB:path.join(root,'workshop.sqlite3')},
});
let modelCalls = 0;
const provider = modelServer(async (request,response)=>{
  const chunks = [];
  for await (const c of request) chunks.push(c);
  const payload = JSON.parse(Buffer.concat(chunks)), context = JSON.parse(payload.messages.at(-1).content);
  modelCalls++;
  const reply = {reply:'Ask the purchasing lead for a dated quote.',sources:[context.sources[0].id],action_id:null};
  response.setHeader('Content-Type','application/json');
  response.end(JSON.stringify({id:'fixture-model-call',model:'fixture-frontier',choices:[{message:{content:JSON.stringify(reply)}}],
    usage:{prompt_tokens:200,completion_tokens:16}}));
});
await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
const reserve = createServer();
await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
const port = reserve.address().port;
await new Promise(resolve=>reserve.close(resolve));
const base = 'http://127.0.0.1:' + port;
const workshop = spawn(python,[...args,'serve','--port',String(port)],{env:{...process.env,STUDIO_LLM_BASE_URL:'',STUDIO_FRONTIER_BASE_URL:'http://127.0.0.1:'+provider.address().port+'/v1',
  STUDIO_OSE_SUPPORT_BPS:'500',STUDIO_FRONTIER_MODEL:'fixture-frontier',STUDIO_FRONTIER_API_KEY:'',STUDIO_FRONTIER_INPUT_USD_PER_MTOK:'1',STUDIO_FRONTIER_OUTPUT_USD_PER_MTOK:'4'},stdio:['ignore','ignore','pipe']});
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
  const taskEntry = base+'/coach.html?brief=wall-fastening&lesson=connections';
  await page.goto(taskEntry);
  await page.locator('#join').waitFor();
  assert.equal(await page.locator('#back-to-studio').getAttribute('href'),'https://opensourceecology.github.io/iconic-tutor/studio.html');
  assert.match(await page.locator('#availability').innerText(),/stud-to-plate/);
  await page.locator('[name=invite]').fill(invitation);
  await page.getByRole('button',{name:'Join workshop'}).click();
  await page.locator('#chat').waitFor();
  const projects = async ()=>(await (await page.request.get(base+'/api/authoring/projects')).json()).projects;
  assert.equal((await projects()).length,0);
  assert.match(await page.locator('#chat-context').innerText(),/stud end meeting the bottom/);
  await page.locator('#question').fill('Which sources should I compare for this joint?');
  const sent = page.waitForRequest(r=>r.url().endsWith('/message'));
  await page.locator('#send').click();
  assert.equal((await sent).postDataJSON().contribution_task,'wall-fastening');
  await page.waitForFunction(()=>document.querySelector('#question').value==='');
  const started = (await projects())[0];
  await page.goto(taskEntry);
  await page.waitForFunction(()=>document.querySelectorAll('#messages .message').length>=2);
  assert.equal(new URL(page.url()).searchParams.get('project'),started.id);
  assert.equal((await projects()).length,1);
  const editor = await browser.newPage();
  await editor.goto(base+'/author.html?project='+started.id+'#invite='+invitation);
  const signIn = editor.locator('#author-join');
  await signIn.waitFor();
  assert.equal(await editor.locator('#library').isVisible(),false);
  assert.equal(await signIn.locator('[name=invite]').inputValue(),invitation);
  assert.equal(new URL(editor.url()).hash,'');
  await signIn.getByRole('button',{name:'Join workshop'}).click();
  await editor.locator('#project-title').waitFor();
  assert.equal(await editor.locator('#project-title').textContent(),started.name);
  await editor.close();
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
  await lesson('bom');
  await page.locator('#mode').selectOption('frontier');
  assert.match(await page.locator('#paid-notice').textContent(),/fixture-frontier/);
  assert.match(await page.locator('#paid-notice').textContent(),/5%/);
  await page.locator('#question').fill('The supplier quote is missing. How do I check the price?');
  await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#messages').textContent.includes('Ask the purchasing lead'));
  await page.waitForFunction(()=>document.querySelector('#credit-rows').textContent.includes('200 input'));
  assert.equal(modelCalls,1);
  const ledger=await (await page.request.get(base+'/api/credits/status')).json();
  assert.equal(ledger.available_microusd,4999723);
  const charge=ledger.history.find(r=>r.kind==='frontier');
  assert.equal(charge.model_cost_microusd,264);
  assert.equal(charge.support_fee_microusd,13);
  await lesson('wiki');
  for (const label of ['Download private project backup','Download wiki draft','Download generated files for wiki upload']) {
    const promised=page.waitForEvent('download');
    await page.getByRole('link',{name:label,exact:true}).click();
    const file=await promised;
    assert.match(file.suggestedFilename(),/\.(zip|wikitext)$/);
  }
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#title').textContent.includes('wiki handoff'));
  await page.locator('#chat').waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('#messages .message').length>2);
  await page.locator('#library summary').click();
  await page.locator('#module').selectOption('ICHL-016');
  await page.locator('#name').fill('Window measurements');
  await page.locator('#start button').click();
  await page.waitForFunction(()=>document.querySelector('#project-label').textContent.includes('ICHL-016'));
  assert.equal(await page.locator('#actions').getByRole('button',{name:'Generate and check this wall'}).count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto(base+'/coach.html');
  await page.locator('#question').waitFor();
  assert.match(await page.locator('#chat-context').innerText(),/ICHL-015/);
  assert.equal(await page.locator('#library').getAttribute('open'),null);
  await page.goto(base+'/coach.html?brief=window-opening&lesson=interfaces');
  await page.locator('#chat').waitFor();
  assert.match(await page.locator('#chat-context').innerText(),/ICHL-016/);
  await page.locator('#question').fill('Which two parts meet here?');
  await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelector('#question').value==='');
  assert.match(await page.locator('#project-label').innerText(),/ICHL-016/);
  assert.equal(await page.locator('#lesson').inputValue(),'interfaces');
  assert.deepEqual(errors,[]);
  console.log('PASS public lessons, mobile notes, workshop invitation, confirmed CAD edits, drawing repair, cited guidance, revision downloads and window intake.');
} finally { await browser?.close();workshop.kill();await stopped; await new Promise(resolve=>provider.close(resolve));await rm(root,{recursive:true,force:true}); }
