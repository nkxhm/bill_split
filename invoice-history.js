const invoiceHistoryKey = 'linesplit.invoice-history.v1';
let invoiceRecords = [];
function readInvoiceRecords() {
  const saved = JSON.parse(localStorage.getItem(invoiceHistoryKey) || '[]');
  if (!Array.isArray(saved)) throw new Error('Invalid saved history');
  return saved.filter(record => record && typeof record.invoice === 'string' && record.invoice.trim() && typeof record.period === 'string' && Array.isArray(record.lines) && record.lines.every(line => typeof line.key === 'string' && typeof line.label === 'string' && Number.isSafeInteger(line.cents)));
}
function invoiceIdentity(value) { return value.trim().toLowerCase(); }
function buildInvoiceRecord(split) {
  return {
    invoice: $('invoice-number').value.trim(),
    period: $('billing-period').value.trim(),
    lines: split.shares.map((share, index) => {
      const label = persons[index].name.trim() || 'Person ' + (index + 1);
      const phone = findPhoneNumbers(label)[0];
      return {key: phone ? phone.key : 'name:' + label.toLowerCase(), label, cents: share.total};
    })
  };
}
function drawInvoiceHistory() {
  $('invoice-cost-box').hidden = !invoiceRecords.length;
  const head = $('invoice-cost-head'), body = $('invoice-line-costs');
  head.replaceChildren(); body.replaceChildren();
  const columns = new Map();
  invoiceRecords.forEach(record => record.lines.forEach(line => columns.set(line.key, line.label)));
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
  invoiceRecords.push(record);
  try {
    localStorage.setItem(invoiceHistoryKey, JSON.stringify(invoiceRecords));
    status.textContent = 'Invoice ' + record.invoice + ' added and saved in this browser.';
  } catch {
    status.textContent = 'Invoice added for this session, but browser storage is unavailable. It will not survive a reload.';
  }
  drawInvoiceHistory();
}
try { invoiceRecords = readInvoiceRecords(); } catch { /* Start with an empty session when storage cannot be read. */ }
drawInvoiceHistory();
