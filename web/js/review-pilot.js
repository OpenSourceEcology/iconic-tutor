const labels = {accepted:'Accepted for documentation', needs_evidence:'Needs more evidence', open_question:'Open question', pending:'Pending'};

function element(tag, value) {
  const item = document.createElement(tag);
  if (value != null) item.textContent = String(value);
  return item;
}

function amount(metric, receiptCount) {
  if (metric.microusd === null) return 'Unavailable';
  const usd = '$' + (metric.microusd / 1000000).toFixed(6);
  return metric.receipts < receiptCount ? usd + ' (' + metric.receipts + ' of ' + receiptCount + ' receipts)' : usd;
}

function duration(seconds) {
  if (!seconds) return 'Unreported';
  return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
}

export async function showPilot(host, fetcher = fetch) {
  host.replaceChildren();
  host.hidden = true;
  let report;
  try {
    const response = await fetcher('/api/contributions/reviews/pilot',{cache:'no-store'});
    if (!response.ok) return;
    report = await response.json();
  } catch { return; }
  host.append(element('h2','Pilot measurements'));
  host.hidden = false;
  if (!report.rounds.length) {
    host.append(element('p','Measurements appear here when contributors submit a review round.'));
    return;
  }
  const counts = Object.entries(report.outcomes).map(([key,value]) => (labels[key] || key) + ' ' + value).join(' · ');
  host.append(element('p',report.tasks + ' tasks · ' + report.rounds.length + ' submitted rounds · ' + counts));
  host.append(element('p','Recorded frontier model usage ' + amount(report.model_cost,report.receipt_count) +
    ' · Recorded credit charged ' + amount(report.credit_charge,report.receipt_count) + ' · ' + report.receipt_count + ' linked receipts.'));
  host.append(element('p','Time and help are reported by the contributor. A resubmitted draft can include earlier timer readings. ' +
    'Frontier amounts cover paid coach requests linked to an active task claim and saved by the submitted project revision. ' +
    'Local operating costs and outside AI usage are unmeasured.'));
  const table = element('table');
  const heading = table.createTHead().insertRow();
  for (const title of ['Task and round','Outcome','Reported independence','Active time','Help reported','Model usage (USD)','Credit charged (USD)']) {
    const th = element('th',title); th.scope = 'col'; heading.append(th);
  }
  const body = table.createTBody();
  for (const row of report.rounds) {
    const tr = body.insertRow();
    const a = element('a',row.module_id + ' · ' + row.title + ' · round ' + row.round);
    a.href = 'review.html?review=' + encodeURIComponent(row.review_id);
    tr.insertCell().append(a);
    for (const value of [labels[row.outcome] || row.outcome, row.assistance, duration(row.active_seconds), row.help || 'Unreported',
      amount(row.model_cost,row.receipt_count),amount(row.credit_charge,row.receipt_count)]) tr.insertCell().textContent = value;
  }
  const scroll = element('div'); scroll.style.overflowX = 'auto'; scroll.append(table); host.append(scroll);
}
