// Exercise the credit panel without credentials, model requests, or a payment provider.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {dollars, stripeCheckoutURL} from '../web/js/coach-credits.js';

assert.equal(dollars(5_000_000),'$5.00');
assert.equal(dollars(1),'$0.000001');
assert.equal(dollars(-1234),'-$0.001234');
assert.equal(dollars(null),'Unavailable');
assert.throws(() => stripeCheckoutURL('https://checkout.stripe.com.example.org/c/test'));
assert.throws(() => stripeCheckoutURL('http://checkout.stripe.com/c/test'));
assert.throws(() => stripeCheckoutURL('https://victim@checkout.stripe.com/c/test'));

const origin = 'http://127.0.0.1:7342';
const source = await readFile(new URL('../web/js/coach-credits.js',import.meta.url),'utf8');
const css = await readFile(new URL('../web/css/coach-credits.css',import.meta.url),'utf8');
const guest = {authenticated:false, checkout_enabled:true, offer_cents:500, rates:{configured:true,
  model:'example-model',input_usd_per_mtok:2,output_usd_per_mtok:10,cached_input_usd_per_mtok:0.2,markup_bps:500}};
const member = {...guest, authenticated:true, account_label:'Volunteer tester', balance_microusd:5_000_000,
  held_microusd:100_000, available_microusd:4_900_000, history:[
    {kind:'frontier',status:'settled', amount_microusd:-10500, model_cost_microusd:10000,support_fee_microusd:500,
      markup_bps:500,usage_cost_microusd:10500,operator_covered_microusd:0, input_tokens:250,output_tokens:50,cached_tokens:12,model:'example-model'},
    {kind:'frontier',status:'settled', amount_microusd:-10000, model_cost_microusd:10000,support_fee_microusd:0,markup_bps:0},
    {kind:'frontier',status:'settled', amount_microusd:0},
    {kind:'frontier',status:'settled', amount_microusd:-4000, model_cost_microusd:4001,support_fee_microusd:201,
      markup_bps:500,usage_cost_microusd:4202,operator_covered_microusd:202},
    {kind:'test_checkout',status:'paid', amount_microusd:5000000},
    {kind:'frontier',status:'held', amount_microusd:0, reserved_microusd:100000, model:'example-model'},
  ]};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors = [];
  page.on('pageerror',e => errors.push(e.message));
  let state = guest;
  const checkoutIds = [];
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    assert.equal(url.origin,origin);
    switch (url.pathname) {
      case '/':
        return route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/credits.css"><section id="credits"></section><script type="module">import {mountCredits} from "/module.js";window.panel = await mountCredits(document.querySelector("#credits"));</script>'});
      case '/credits.css':
        return route.fulfill({contentType:'text/css',body:css});
      case '/module.js':
        return route.fulfill({contentType:'text/javascript',body:source});
      case '/api/credits/status':
        return route.fulfill({json:state});
      case '/api/credits/login':
        assert.deepEqual(request.postDataJSON(),{code:'local-test-code'});
        state = member;
        return route.fulfill({json:state});
      case '/api/credits/checkout':
        checkoutIds.push(request.postDataJSON().request_id);
        if (checkoutIds.length === 1) return route.fulfill({status:502,json:{error:'Temporary test processor failure'}});
        return route.fulfill({json:{url:'https://checkout.stripe.com/c/pay/dummy-test-session'}});
      case '/api/credits/logout':
        state = guest;
        return route.fulfill({json:state});
      default:
        throw Error('Unexpected request ' + url.pathname);
    }
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.panel?.status()?.authenticated === false);
  await page.locator('#credit-details summary').first().click();
  assert.match(await page.locator('#credit-rates').innerText(),/cached input \$0\.2/);
  assert.match(await page.locator('#credit-rates').innerText(),/5% OSE support fee to the model cost/);
  await page.locator('#credit-code').fill('local-test-code');
  await page.locator('#credit-login button').click();
  await page.waitForFunction(() => window.panel.status().authenticated);
  assert.equal(await page.locator('#credit-available').innerText(),'$4.90');
  assert.equal(await page.locator('#credit-held').innerText(),'$0.10');
  assert.equal(await page.locator('#credit-total').innerText(),'$5.00');
  await page.locator('#credit-history summary').click();
  assert.match(await page.locator('#credit-rows').innerText(),/250 input · 50 output tokens/);
  assert.match(await page.locator('#credit-rows').innerText(),/12 input tokens cached/);
  assert.match(await page.locator('#credit-rows').innerText(),/\$0\.10 reserved/);
  const rows = page.locator('#credit-rows tbody tr');
  const amount = index => rows.nth(index).locator('td').nth(1).innerText();
  assert.match(await amount(0),/-\$0\.0105\s+Model cost \$0\.01\s+OSE support fee \(5%\) \$0\.0005/);
  assert.match(await amount(1),/OSE support fee \(0%\) \$0\.00/);
  assert.match(await amount(2),/^\$0\.00\s+OSE support fee \(0%\) \$0\.00/);
  assert.match(await amount(3),/Usage total \$0\.004202\s+Covered by operator \$0\.000202/);
  assert.equal(await amount(4),'$5.00');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  assert.ok(!(await amount(5)).includes('support fee'));
  await page.locator('#credit-checkout').click();
  await page.waitForFunction(() => document.querySelector('#credit-error').textContent.includes('Temporary'));
  await page.locator('#credit-checkout').click();
  await page.locator('#credit-checkout-link').waitFor();
  assert.match(await page.locator('#credit-checkout-link').getAttribute('href'),/^https:\/\/checkout\.stripe\.com\//);
  assert.equal(checkoutIds.length,2);
  assert.equal(checkoutIds[0],checkoutIds[1]);
  assert.match(checkoutIds[0],/^[\da-f-]{36}$/);
  assert.equal(await page.locator('#credit-code').inputValue(),'');
  await page.locator('#credit-logout').click();
  await page.waitForFunction(() => !window.panel.status().authenticated);
  assert.equal(await page.locator('#credit-account').isVisible(),false);
  assert.equal(await page.locator('#credit-checkout-link').getAttribute('href'),null);
  assert.deepEqual(errors,[]);
  console.log('Credit panel verification passed: sign-in, rates, ledger, balances, idempotent test checkout and sign-out.');
} finally { await browser.close(); }
