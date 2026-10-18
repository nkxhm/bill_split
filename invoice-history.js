const invoiceHistoryKey = 'linesplit.invoice-history.v1';
let invoiceRecords = [];
function canonicalLineKey(line) {
  const phone = findPhoneNumbers(line.label)[0];
  if (phone) return phone.key + (line.key.endsWith(':number-share') || /\(Number Share\)/i.test(line.label) ? ':number-share' : '');
  const digits = line.key.replace(/\D/g, '');
  if (/^\d{10}$/.test(digits)) return digits;
  if (/^1\d{10}$/.test(digits)) return digits.slice(1);
  return line.key;
}
function readInvoiceRecords() {
  const saved = JSON.parse(localStorage.getItem(invoiceHistoryKey) || '[]');
  if (!Array.isArray(saved)) throw new Error('Invalid saved history');
  return saved.filter(record => record && typeof record.invoice === 'string' && record.invoice.trim() && typeof record.period === 'string' && Array.isArray(record.lines) && record.lines.every(line => typeof line.key === 'string' && typeof line.label === 'string' && Number.isSafeInteger(line.cents))).map(record => ({...record, lines:record.lines.map(line => ({...line, key:canonicalLineKey(line)}))}));
}
function invoiceIdentity(value) { return value.trim().toLowerCase(); }
function billingPeriodOrder(period) {
  // Sort by the end of the billing period; unknown periods appear last.
  const end = period.trim().split(/\s+(?:[-–—]|to|through)\s+/i).pop();
  if (!/\d{4}/.test(end)) return Infinity;
  const timestamp = Date.parse(end);
  return Number.isFinite(timestamp) ? timestamp : Infinity;
}
function sortInvoiceRecords() {
  invoiceRecords.sort((a,b) => {
    const first = billingPeriodOrder(a.period), second = billingPeriodOrder(b.period);
    return (first === second ? 0 : first - second) || a.invoice.localeCompare(b.invoice, undefined, {numeric:true});
  });
}
function buildInvoiceRecord(split) {
  return {
    invoice: $('invoice-number').value.trim(),
    period: $('billing-period').value.trim(),
    lines: split.shares.map((share, index) => {
      const label = persons[index].name.trim() || 'Person ' + (index + 1);
      const phone = findPhoneNumbers(label)[0];
      return {key: phone ? phone.key + (persons[index].isNumberShare ? ':number-share' : '') : 'name:' + label.toLowerCase(), label, cents: share.total};
    })
  };
}
function groupFamilyColumns(columns) {
  const families = [
    ['yuan xu', 'chao liu'],
    ['yang yang', 'anping xie'],
    ['luning zhuang', 'nicole xia', 'manning xia'],
    ['youwei bi']
  ];
  const phoneFamilies = [
    ['3522158189', '2677894600', '4452701573'],
    ['6086926374', '6086959107', '4437669050']
  ];
  const entries = [...columns.entries()];
  const nameOf = label => label.split(/[·(\d]/)[0].trim().toLowerCase().replace(/\s+/g, ' ');
  const parent = entries.map((_,i) => i);
  const root = i => parent[i] === i ? i : (parent[i] = root(parent[i]));
  const ranks = new Map();
  const groups = [
    ...families.map(names => names.flatMap(name => entries.map(([,label],i) => nameOf(label) === name ? i : -1).filter(i => i >= 0))),
    ...phoneFamilies.map(phones => phones.flatMap(phone => entries.map(([key,label],i) => canonicalLineKey({key,label}) === phone ? i : -1).filter(i => i >= 0)))
  ];
  groups.forEach((members,group) => members.forEach((i,position) => {
    if (!ranks.has(i)) ranks.set(i, group * 1000 + position);
    if (members.length) parent[root(i)] = root(members[0]);
  }));
  const used = new Set(), ordered = new Map();
  entries.forEach((_,i) => {
    const family = root(i);
    if (used.has(family)) return;
    used.add(family);
    entries.map((entry,index) => ({entry,index})).filter(item => root(item.index) === family)
      .sort((a,b) => (ranks.get(a.index) ?? a.index + 100000) - (ranks.get(b.index) ?? b.index + 100000))
      .forEach(({entry:[key,label]}) => ordered.set(key,label));
  });
  return ordered;
}
function drawInvoiceHistory() {
  sortInvoiceRecords();
  $('download-table').disabled = !invoiceRecords.length;
  $('invoice-cost-box').hidden = false;
  const head = $('invoice-cost-head'), body = $('invoice-line-costs');
  const foot = $('invoice-line-totals');
  head.replaceChildren(); body.replaceChildren(); foot.replaceChildren();
  let columns = new Map();
  invoiceRecords.forEach(record => record.lines.forEach(line => columns.set(line.key, line.label)));
  columns = groupFamilyColumns(columns);
  const header = document.createElement('tr');
  for (const label of ['Invoice number', 'Billing period', ...columns.values()]) {
    const th = document.createElement('th'); th.scope = 'col';
    th.style.cssText = 'padding:14px 12px;border-bottom:1px solid #dfe5da;min-width:145px;vertical-align:top';
    th.textContent = label; header.append(th);
  }
  head.append(header);
  for (const record of invoiceRecords) {
    const row = document.createElement('tr');
    const costs = new Map();
    record.lines.forEach(line => costs.set(line.key, (costs.get(line.key) || 0) + line.cents));
    // Retain the currency used when the snapshot was copied.
    const format = cents => new Intl.NumberFormat(undefined, {style:'currency', currency: record.currency || 'USD'}).format(cents/100);
    const values = [record.invoice, record.period || 'Not detected', ...[...columns.keys()].map(key => costs.has(key) ? format(costs.get(key)) : '—')];
    values.forEach((value, i) => {
      const td = document.createElement('td'); td.textContent = value;
      td.style.cssText = 'padding:16px 12px;border-bottom:1px solid #edf0e9;white-space:nowrap;' + (i > 1 ? 'font-weight:700' : '');
      row.append(td);
    });
    body.append(row);
  }
  if (invoiceRecords.length) {
    const row = document.createElement('tr');
    const title = document.createElement('th'); title.colSpan = 2; title.scope = 'row';
    title.textContent = 'Total cost'; title.style.cssText = 'padding:16px 12px;border-top:2px solid #bbcbbb'; row.append(title);
    for (const key of columns.keys()) {
      const totals = new Map();
      for (const record of invoiceRecords) {
        const currency = record.currency || 'USD';
        for (const line of record.lines) if (line.key === key) totals.set(currency, (totals.get(currency) || 0) + line.cents);
      }
      const cell = document.createElement('td');
      cell.style.cssText = 'padding:16px 12px;border-top:2px solid #bbcbbb;font-weight:700;white-space:nowrap';
      cell.textContent = [...totals.entries()].map(([currency,cents]) => new Intl.NumberFormat(undefined,{style:'currency',currency}).format(cents/100)).join(' + ');
      row.append(cell);
    }
    foot.append(row);
  }
}
function appendInvoiceRecord(split) {
  const record = buildInvoiceRecord(split);
  record.currency = $('currency').value;
  const status = $('invoice-history-status');
  $('invoice-cost-box').hidden = false;
  if (!record.invoice) { status.textContent = 'Record not added: this PDF has no detected invoice number.'; return; }
  try {
    // Include records saved in another tab before checking for duplicates.
    const disk = readInvoiceRecords();
    for (const saved of disk) if (!invoiceRecords.some(r => invoiceIdentity(r.invoice) === invoiceIdentity(saved.invoice))) invoiceRecords.push(saved);
  } catch { /* Keep this session's records if browser storage is unavailable. */ }
  if (invoiceRecords.some(saved => invoiceIdentity(saved.invoice) === invoiceIdentity(record.invoice))) {
    drawInvoiceHistory(); status.textContent = 'Invoice ' + record.invoice + ' is already saved. No duplicate was added.'; return;
  }
  // Match the phone identity, never the display name. Update saved labels
  // before date sorting so the just-appended record's name wins even when
  // importing an older billing period. Historical costs remain untouched.
  const currentLabels = new Map(record.lines.map(line => [canonicalLineKey(line), line.label]));
  for (const saved of invoiceRecords) {
    for (const line of saved.lines) {
      line.key = canonicalLineKey(line);
      if (currentLabels.has(line.key)) line.label = currentLabels.get(line.key);
    }
  }
  record.lines.forEach(line => { line.key = canonicalLineKey(line); });
  invoiceRecords.push(record);
  sortInvoiceRecords();
  try {
    localStorage.setItem(invoiceHistoryKey, JSON.stringify(invoiceRecords));
    status.textContent = 'Invoice ' + record.invoice + ' added and saved in this browser.';
  } catch {
    status.textContent = 'Invoice added for this session, but browser storage is unavailable. It will not survive a reload.';
  }
  drawInvoiceHistory();
}
function csvCell(value) {
  let text = String(value);
  // Preserve displayed text and prevent spreadsheet formula interpretation.
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
function invoiceTableCsv() {
  const rows = [];
  for (const section of ['invoice-cost-head', 'invoice-line-costs', 'invoice-line-totals']) {
    for (const row of $(section).children) {
      const values = [];
      for (const cell of row.children) {
        values.push(cell.textContent);
        for (let i = 1; i < (cell.colSpan || 1); i++) values.push('');
      }
      rows.push(values.map(csvCell).join(','));
    }
  }
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}
$('download-table').addEventListener('click', () => {
  if (!invoiceRecords.length) return;
  drawInvoiceHistory();
  const url = URL.createObjectURL(new Blob([invoiceTableCsv()], {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'linesplit-invoice-costs.csv';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('invoice-history-status').textContent = 'Invoice table downloaded as CSV, including the totals row.';
});
try { invoiceRecords = readInvoiceRecords(); } catch { /* Start with an empty session when storage cannot be read. */ }
$('reset-record').addEventListener('click', () => {
  try {
    localStorage.setItem(invoiceHistoryKey, '[]');
    invoiceRecords = [];
    drawInvoiceHistory();
    $('invoice-history-status').textContent = 'All saved invoice records have been erased.';
  } catch {
    $('invoice-history-status').textContent = 'Unable to erase browser storage. Records have not been cleared; please try again.';
  }
});
drawInvoiceHistory();
