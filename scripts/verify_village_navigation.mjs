import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.STUDIO_URL||'http://127.0.0.1:8766';
const browser=await chromium.launch({args:['--use-angle=swiftshader','--enable-webgl']});
try{
  await fs.mkdir('reports/village-browser',{recursive:true});
  const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],viewRequests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/js/studio-view.js'))viewRequests.push(r.url());});
  await page.goto(base+'/studio.html');await page.locator('.village-lesson-link').waitFor();
  assert.equal(await page.locator('.site-credit a').getAttribute('href'),'https://www.goodancestor.com');
  assert.match(await page.locator('.site-credit').textContent(),/Designed by GoodAncestor Foundation/);
  await page.setViewportSize({width:390,height:1000});assert(await page.locator('.village-nav-link').isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'main page mobile overflow');
  await page.locator('.village-lesson-link').click();await page.locator('#cabin-icon').waitFor();
  assert.equal(await page.locator('.site-credit a').getAttribute('href'),'https://www.goodancestor.com');
  await page.setViewportSize({width:1440,height:1100});await page.locator('#courtyard').click();await page.locator('#tab-3d').click();
  await page.waitForFunction(()=>document.querySelector('#village-3d').dataset.renderedInstances==='12');
  assert.equal(await page.locator('#pan-view').isDisabled(),false);
  assert(viewRequests.every(url=>new URL(url).searchParams.has('v')),'viewer module must have a release cache key');
  await page.screenshot({path:'reports/village-browser/navigation-3d.png',fullPage:true});
  await page.close();
  // Reproduce a stale cached viewer that predates navigation controls. Rendering
  // must keep working; missing optional controls must not be called WebGL failure.
  const stale=await browser.newPage();stale.on('pageerror',e=>errors.push(e.message));
  await stale.route('**/js/studio-view.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('    setNavigationMode,\n','')});});
  await stale.goto(base+'/village.html');await stale.locator('#cabin-icon').waitFor();await stale.locator('#courtyard').click();await stale.locator('#tab-3d').click();
  await stale.waitForFunction(()=>document.querySelector('#village-3d').dataset.renderedInstances==='12');
  assert(await stale.locator('#pan-view').isDisabled());assert.match(await stale.locator('#view-help').textContent(),/Drag to orbit/);
  assert.equal(await stale.locator('#notice').evaluate(el=>el.classList.contains('error')),false);
  await stale.close();assert.deepEqual(errors,[]);
  console.log('PASS main-page village entry, both Foundation credits, mobile navigation, versioned 3D and stale-viewer recovery.');
}finally{await browser.close();}
