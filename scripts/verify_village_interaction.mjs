// Regression for direct HTTP/Tailscale placement, first-add framing and 3D navigation.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.STUDIO_URL||'http://127.0.0.1:8766';
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-webgl']});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
// Also reproduce the missing API when this test is run on secure localhost.
await page.addInitScript(()=>Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true}));
const snapshot=()=>page.locator('#village-3d').evaluate(el=>({
  position:el.dataset.cameraPosition.split(',').map(Number),
  target:el.dataset.cameraTarget.split(',').map(Number),
}));
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const relative=c=>c.position.map((v,i)=>v-c.target[i]);
async function drag(){
  const canvas=page.locator('#village-3d canvas');await canvas.scrollIntoViewIfNeeded();
  const b=await canvas.boundingBox();await page.mouse.move(b.x+b.width*.6,b.y+b.height*.55);await page.mouse.down();
  await page.mouse.move(b.x+b.width*.6+80,b.y+b.height*.55+35,{steps:14});await page.mouse.up();await page.waitForTimeout(1000);
}
try{
  await page.goto(base+'/village.html');await page.locator('#cabin-icon').waitFor();
  assert.equal(await page.evaluate(()=>typeof crypto.randomUUID),'undefined');
  // Open 3D while empty, then place the very first cabin: it must enter the view.
  await page.locator('#tab-3d').click();await page.locator('#add').click();
  assert.equal(await page.locator('#count').textContent(),'1 / 12 cabins');
  await page.waitForFunction(()=>document.querySelector('#village-3d').dataset.renderedInstances==='1');
  assert.match(await page.locator('#notice').textContent(),/placed and selected/);
  let c=await snapshot();assert(distance(c.position,c.target)>6000,'camera fitted to full cabin');
  const sourceCenter=[Number(await page.locator('#pos-x').inputValue())*304.8,Number(await page.locator('#pos-y').inputValue())*304.8];
  assert(Math.abs(c.target[0]-sourceCenter[0])<1);assert(Math.abs(c.target[1]-sourceCenter[1])<1);
  await page.locator('#cabin-icon').click();assert.equal(await page.locator('#count').textContent(),'2 / 12 cabins');
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('iconic-tutor-village-v1')));
  assert.notDeepEqual([state.instances[0].x,state.instances[0].y],[state.instances[1].x,state.instances[1].y],'new cabins do not stack invisibly');
  assert.equal(new Set(state.instances.map(i=>i.id)).size,2);
  await page.locator('#undo').click();assert.equal(await page.locator('#count').textContent(),'1 / 12 cabins');await page.locator('#redo').click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#pan-view').getAttribute('aria-pressed'),'true');
  const panBefore=await snapshot();await drag();const panAfter=await snapshot();
  assert(distance(panBefore.target,panAfter.target)>100,'left drag pans target');
  assert(distance(relative(panBefore),relative(panAfter))<1,'pan preserves viewing direction');
  await page.locator('#orbit-view').click();const orbitBefore=await snapshot();await drag();const orbitAfter=await snapshot();
  assert(distance(orbitBefore.target,orbitAfter.target)<1,'orbit preserves target');
  assert(distance(relative(orbitBefore),relative(orbitAfter))>100,'orbit changes viewing direction');
  assert.match(await page.locator('#view-help').textContent(),/Drag to orbit/);
  const canvas=await page.locator('#village-3d canvas').boundingBox();await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);
  const zoomBefore=await snapshot();await page.mouse.wheel(0,-200);await page.waitForTimeout(700);const zoomAfter=await snapshot();
  assert(distance(zoomAfter.position,zoomAfter.target)<distance(zoomBefore.position,zoomBefore.target),'wheel zooms');
  await page.locator('#tab-plan').click();assert.equal(await page.locator('#navigation-3d').isVisible(),false);assert.equal(await page.locator('[data-cabin]').count(),2);
  await page.locator('#add').click();assert.equal(await page.locator('[data-cabin]').count(),3);
  // A failed placement preserves both the project and the useful failure notice.
  await page.locator('#file').setInputFiles({name:'small.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...state,site:{width:40,depth:40},instances:[{id:'cabin-1',x:20,y:20,rotation:0}]}))});
  await page.waitForFunction(()=>document.querySelector('#notice').textContent==='Village project opened.');
  await page.locator('#add').click();assert.equal(await page.locator('#count').textContent(),'1 / 12 cabins');assert.match(await page.locator('#notice').textContent(),/No free placement/);
  await page.locator('#courtyard').click();assert(await page.locator('#add').isDisabled());
  await page.reload();await page.locator('[data-cabin]').first().waitFor();assert.equal(await page.locator('[data-cabin]').count(),12);
  assert.deepEqual(errors,[]);
  await fs.mkdir('reports/village-browser',{recursive:true});await fs.writeFile('reports/village-browser/interaction-receipt.json',JSON.stringify({passed:true,url:base,secureContext:await page.evaluate(()=>isSecureContext),missingUUIDTested:true,pan:true,orbit:true,zoom:true,manualPlacement:true,errors},null,2));
  console.log('PASS HTTP/Tailscale manual placement, visible first 3D cabin, pan/orbit/zoom, undo and failure preservation.');
}finally{await browser.close();}
