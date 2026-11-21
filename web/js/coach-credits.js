// Account state comes only from the local Studio backend and its HttpOnly session cookie.
export function dollars(micros) {
  if (!Number.isSafeInteger(micros)) return 'Unavailable';
  return new Intl.NumberFormat('en-US', {
    style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:6,
  }).format(micros / 1_000_000);
}

export function stripeCheckoutURL(value) {
  const url = new URL(value);
  if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password) {
    throw Error('Studio returned an unexpected checkout address.');
  }
  return url.href;
}

async function api(path, payload) {
  const response = await fetch('/api/credits/' + path, {
    method: payload ? 'POST' : 'GET', cache:'no-store', credentials:'same-origin',
    ...(payload ? {headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)} : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw Error(body.error || 'Credit service unavailable (' + response.status + ').');
  if (path !== 'checkout' && typeof body.authenticated !== 'boolean') throw Error('The Studio credit service is unavailable here.');
  return body;
}

function node(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}

const kindLabels = {frontier:'Frontier question', test_checkout:'Test checkout', operator_test_grant:'Operator test credit'};

function feeRate(bps) {
  if (!Number.isSafeInteger(bps) || bps < 0) return '';
  return (bps / 100).toLocaleString('en-US', {maximumFractionDigits:2}) + '%';
}

function showUsageCosts(amount, row) {
  if (row.kind !== 'frontier' || row.status !== 'settled') return;
  if (Number.isSafeInteger(row.model_cost_microusd)) {
    amount.append(node('small','Model cost ' + dollars(row.model_cost_microusd)));
  }
  // Pre-fee ledgers recorded a single debit. Do not recompute a historical fee at today's rate.
  const historical = row.markup_bps == null && row.support_fee_microusd == null;
  const rate = historical ? '0%' : feeRate(row.markup_bps);
  const fee = historical ? 0 : row.support_fee_microusd;
  amount.append(node('small','OSE support fee' + (rate ? ' (' + rate + ')' : '') + ' ' + dollars(fee)));
  if (row.operator_covered_microusd > 0) {
    amount.append(node('small','Usage total ' + dollars(row.usage_cost_microusd)));
    amount.append(node('small','Covered by operator ' + dollars(row.operator_covered_microusd)));
  }
}

function transactionTable(rows) {
  if (!Array.isArray(rows) || !rows.length) return node('p','No transactions yet.');
  const table = node('table','');
  table.className = 'coach-credit-table';
  const tr = table.createTHead().insertRow();
  for (const heading of ['Activity','Balance change','Usage']) tr.append(node('th',heading));
  const body = table.createTBody();
  for (const row of rows) {
    const cells = body.insertRow();
    const activity = cells.insertCell();
    activity.append(node('strong',kindLabels[row.kind] || String(row.kind || 'Transaction').replaceAll('_',' ')));
    const date = row.at ? new Date(row.at) : null;
    if (date && Number.isFinite(date.valueOf())) activity.append(node('small',date.toLocaleString()));
    if (row.status) activity.append(node('small',row.status));
    const amount = cells.insertCell();
    amount.textContent = dollars(row.amount_microusd);
    showUsageCosts(amount,row);
    if (row.status === 'held' && row.reserved_microusd > 0) amount.append(node('small',dollars(row.reserved_microusd) + ' reserved'));
    const usage = cells.insertCell();
    if (row.model) usage.append(node('span',row.model));
    if (Number.isSafeInteger(row.input_tokens) && Number.isSafeInteger(row.output_tokens)) {
      usage.append(node('small',row.input_tokens.toLocaleString() + ' input · ' + row.output_tokens.toLocaleString() + ' output tokens'));
      if (row.cached_tokens > 0) usage.append(node('small',row.cached_tokens.toLocaleString() + ' input tokens cached'));
    } else usage.append(node('small','—'));
  }
  return table;
}

function rateText(rates) {
  if (!rates?.configured) return 'Frontier model rates have not been configured for this Studio.';
  const prices = [
    'input $' + rates.input_usd_per_mtok,
    ...(rates.cached_input_usd_per_mtok != null ? ['cached input $' + rates.cached_input_usd_per_mtok] : []),
    'output $' + rates.output_usd_per_mtok,
  ];
  const fee = feeRate(rates.markup_bps);
  const disclosure = fee ? 'New Frontier questions add a ' + fee + ' OSE support fee to the model cost.' :
    'This Studio has not reported an OSE support fee rate.';
  return rates.model + ' · ' + prices.join(' · ') + ' per million tokens. ' + disclosure;
}

export async function mountCredits(host, onChange = () => {}) {
  const state = {data:null, busy:false, checkoutId:null, checkoutURL:null};
  host.classList.add('credit-panel');
  host.innerHTML = `
    <details id="credit-details">
      <summary>AI usage and credits <span id="credit-brief"></span></summary>
      <div class="credit-body">
        <p>Guided lessons and the local model use no contributor credit. Frontier answers draw from a prepaid balance at the model rates below.</p>
        <p id="credit-rates"></p>
        <p id="credit-error" role="status" aria-live="polite"></p>
        <form id="credit-login" hidden>
          <label>Contributor access code<input id="credit-code" type="password" autocomplete="off" required></label>
          <button>Sign in to use credits</button>
          <small>Get a contributor access code from the Studio operator.</small>
        </form>
        <div id="credit-account" hidden>
          <p id="credit-owner"></p>
          <dl class="credit-balances">
            <div><dt>Available</dt><dd id="credit-available"></dd></div>
            <div><dt>Reserved for requests</dt><dd id="credit-held"></dd></div>
            <div><dt>Total balance</dt><dd id="credit-total"></dd></div>
          </dl>
          <div id="credit-purchase">
            <p id="credit-purchase-note"></p>
            <button id="credit-checkout" type="button"></button>
            <a id="credit-checkout-link" target="_blank" rel="noopener noreferrer" hidden>Open hosted test checkout ↗</a>
            <button id="credit-new-checkout" type="button" hidden>Prepare a new checkout link</button>
          </div>
          <details id="credit-history"><summary>Transaction history and token usage</summary><div id="credit-rows"></div></details>
          <button id="credit-logout" type="button">Sign out</button>
        </div>
        <button id="credit-refresh" type="button">Refresh credit status</button>
      </div>
    </details>`;
  const field = id => host.querySelector('#credit-' + id);
  const say = text => { field('error').textContent = text; };
  const clearCheckout = () => {
    state.checkoutId = null;
    state.checkoutURL = null;
    field('checkout-link').hidden = true;
    field('checkout-link').removeAttribute('href');
  };
  const render = () => {
    const data = state.data;
    const active = data?.authenticated === true;
    field('brief').textContent = active ? dollars(data.available_microusd) + ' available' : '';
    field('rates').textContent = data ? rateText(data.rates) : '';
    field('login').hidden = !data || active;
    field('account').hidden = !active;
    if (active) {
      field('owner').textContent = 'Signed in as ' + data.account_label;
      field('total').textContent = dollars(data.balance_microusd);
      field('available').textContent = dollars(data.available_microusd);
      field('held').textContent = dollars(data.held_microusd);
      field('rows').replaceChildren(transactionTable(data.history));
      const amount = dollars(data.offer_cents * 10000);
      field('checkout').textContent = 'Prepare ' + amount + ' test checkout';
      field('checkout').hidden = !data.checkout_enabled || Boolean(state.checkoutURL);
      field('checkout-link').hidden = !data.checkout_enabled || !state.checkoutURL;
      field('new-checkout').hidden = !data.checkout_enabled || !state.checkoutURL;
      field('purchase-note').textContent = data.checkout_enabled
        ? 'Test mode · Use Stripe test payment details. A verified processor event adds the full ' + amount + ' in test credit. Return here to refresh your balance.'
        : 'Hosted test checkout is unavailable on this Studio.';
    } else {
      for (const id of ['owner','total','available','held','rows']) field(id).replaceChildren();
    }
    for (const button of host.querySelectorAll('button')) button.disabled = state.busy;
  };
  const apply = data => {
    if (!data.authenticated || data.account_label !== state.data?.account_label ||
        (state.checkoutURL && data.balance_microusd > state.data?.balance_microusd)) clearCheckout();
    state.data = data;
    render();
    onChange(data);
  };
  async function work(fn) {
    if (state.busy) return;
    state.busy = true;
    say('');
    render();
    try { await fn(); } catch (err) { say(err.message); }
    finally { state.busy = false; render(); }
  }
  async function refresh() {
    await work(async () => {
      try { apply(await api('status')); }
      catch (error) { state.data = null; clearCheckout(); onChange(null); throw error; }
    });
    return state.data;
  }
  field('login').addEventListener('submit', e => {
    e.preventDefault();
    const code = field('code').value.trim();
    if (!code) return;
    field('code').value = '';
    void work(async () => { apply(await api('login',{code})); say('Contributor account connected.'); });
  });
  field('logout').onclick = () => work(async () => {
    apply(await api('logout',{}));
    say('Signed out of the credit account.');
  });
  field('refresh').onclick = refresh;
  field('new-checkout').onclick = () => {
    clearCheckout();
    render();
    field('checkout').focus();
    say('You can prepare a fresh test checkout link.');
  };
  field('checkout').onclick = () => work(async () => {
    // A timed-out request may already have created a session. Retry with the same ID.
    state.checkoutId ||= crypto.randomUUID();
    const result = await api('checkout',{request_id:state.checkoutId});
    state.checkoutURL = stripeCheckoutURL(result.url);
    field('checkout-link').href = state.checkoutURL;
    field('checkout-link').hidden = false;
    field('checkout-link').focus();
    say('Test checkout prepared. Open the processor page to continue.');
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.checkoutURL) void refresh();
  });
  await refresh();
  return {
    refresh,
    status:() => state.data,
    selectedModel:() => state.data?.rates?.configured ? state.data.rates.model : null,
    headers:() => ({}),
  };
}
