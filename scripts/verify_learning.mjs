import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { tracks } from '../web/js/learn-content.js';
const base = (process.env.STUDIO_PAGES_URL || 'http://127.0.0.1:8777/iconic-tutor/').replace(/\/?$/, '/');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() !== 'GET') writes.push(r.url()); });
  for (const id of ['wiki','freecad']) {
    await page.goto(`${base}learn.html?track=${id}`);
    for (const [i, item] of tracks[id].steps.entries()) {
      assert.equal(await page.locator('#step-title').textContent(), item.title);
      await page.locator('#questions button').first().click();
      assert((await page.locator('#answer').textContent()).length > 30);
      if (item.question) {
        await page.locator('.quiz button').nth((item.correct + 1) % item.options.length).click();
        assert.match(await page.locator('#feedback').textContent(), /Not quite/);
        await page.locator('.quiz button').nth(item.correct).click();
      } else await page.locator('.check-row input').check();
      if (i < tracks[id].steps.length - 1) await page.locator('#next').click();
    }
    await page.reload();
    assert.match(await page.locator('#progress').textContent(), /5 of 5/);
    assert.equal(await page.locator('#draft-section').isVisible(), id === 'wiki');
  }
  await page.goto(`${base}learn.html?track=wiki&step=3`);
  const values = {name:'Cabin test', author:'Tutor learner', id:'cabin_test', wiki:'https://example.org/wiki', cad:'https://example.org/cad', license:'Unknown', dimensions:'13 ft', description:'<script>alert(1)</script>', validation:'Not tested', limitations:'Needs review'};
  for (const [key, value] of Object.entries(values)) await page.locator(`[name="${key}"]`).fill(value);
  await page.locator('#design-form button').click();
  assert.match(await page.locator('#draft-status').textContent(), /Nothing has been submitted/);
  assert(!(await page.locator('#wiki-draft').inputValue()).includes('<script>'));
  assert.match(await page.locator('#review-open').getAttribute('href'), /vcs-library\/issues\/new/);
  const download = page.waitForEvent('download'); await page.locator('#download-review').click();
  assert.equal((await download).suggestedFilename(), 'design-review.md');
  await page.locator('[name="name"]').fill('Updated cabin');
  assert(!(await page.locator('#draft-output').isVisible()), 'stale outputs hidden');
  await page.reload(); assert.equal(await page.locator('[name="name"]').inputValue(), 'Updated cabin');
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page fits');
  await page.screenshot({path:'reports/learning-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'reports/learning-desktop.png',fullPage:true});
  await page.goto(`${base}studio.html`);
  assert.equal(await page.locator('a[href="learn.html?track=wiki"]').count(), 1);
  assert.equal(await page.locator('a[href="learn.html?track=freecad"]').count(), 1);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log('PASS both learning paths, quizzes, saved progress, draft safety/downloads, mobile and main-page links; no writes');
} finally { await browser.close(); }
