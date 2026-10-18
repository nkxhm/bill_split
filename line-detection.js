function findPhoneNumbers(text) {
  const numbers = new Map();
  const pattern = /(?<!\d)(?:\+?1[\s.-]*)?\(?([2-9]\d{2})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?!\d)/g;
  for (const match of text.matchAll(pattern)) {
    const key = match[1] + match[2] + match[3];
    if (!numbers.has(key)) numbers.set(key, {key, label: '(' + match[1] + ') ' + match[2] + '-' + match[3]});
    if (numbers.size >= 200) break;
  }
  return [...numbers.values()];
}
// Read only the charge-by-line section. No whole-document phone fallback.
function findAccountLines(pages) {
  const found = new Map();
  const compact = text => text.toLowerCase().replace(/[^a-z]/g, '');
  const isChargeHeading = text => /charges?bylinedetails?/.test(compact(text));
  const isActivity = text => /(?:talkactivity|callinghistory|callhistory|callactivity|talkdetails|voiceactivity|usageactivity|detailedusage|textactivity)/.test(compact(text));
  const stopHeading = /\b(?:call(?:ing)?\s+(?:history|details?|activity|log)|talk\s+(?:activity|details?)|(?:voice|text|message|data|usage)\s+(?:activity|details?|history)|detailed\s+usage|numbers?\s+(?:called|dialed)|incoming\s+calls|outgoing\s+calls|account\s+(?:summary|overview)|bill(?:ing)?\s+summary|payment\s+(?:options|details)|important\s+(?:information|messages))\b/i;
  const support = /\b(?:customer\s+(?:service|care|support)|contact us|call us|questions|to pay|support|fax|tty)\b/i;
  let priorPageInCharges = false;
  for (const page of pages) {
    const rows = page.split(/\n/);
    // Carry across only an explicitly marked continuation page. An unrelated
    // page without a charge-by-line heading never supplies candidates.
    let inCharges = priorPageInCharges && /continued/i.test(rows.slice(0, 5).join(' '));
    let blocked = false;
    let supportRows = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (stopHeading.test(row) || isActivity(row)) { inCharges = false; blocked = true; continue; }
      if (blocked && !isChargeHeading(row)) continue;
      if (isChargeHeading(row)) blocked = false;
      // Accommodate headings split into two PDF text rows.
      if (isChargeHeading(row)) { inCharges = true; continue; }
      if (isChargeHeading(row + ' ' + (rows[i+1] || ''))) { inCharges = true; continue; }
      if (!inCharges) continue;
      if (support.test(row)) { supportRows = 2; continue; }
      if (supportRows > 0) { supportRows--; continue; }
      // Subscriber numbers appear on their own device/line row. Reject
      // invoice IDs, agreement IDs, support text and activity table rows.
      if (!/^(?:(?:wireless|mobile|phone|line)\s*(?:number|no\.?|#|:)?\s*[:#]?\s*)?(?:\+?1[\s.-]*)?\(?[2-9]\d{2}\)?[\s.-]*\d{3}[\s.-]*\d{4}\s*$/i.test(row.trim())) continue;
      for (const phone of findPhoneNumbers(row)) {
        if (/^(800|888|877|866|855|844|833|822)/.test(phone.key)) continue;
        // Verizon places the subscriber's name and line total above the
        // device and number. Require that structure rather than guessing
        // from device descriptions or nearby charge labels.
        let name = '';
        for (let previous = i - 1; previous >= Math.max(0, i - 6); previous--) {
          const candidate = rows[previous].trim();
          if (isChargeHeading(candidate) || stopHeading.test(candidate) || isActivity(candidate) || findPhoneNumbers(candidate).length) break;
          const match = candidate.match(/^([\p{L}][\p{L}\p{M} .,'’\-]{1,79}?)\s+(?:[-−]?\$\s*[\d,]+\.\d{2})\s*$/u);
          if (!match) continue;
          const possible = match[1].trim().replace(/\s+/g, ' ');
          if (/\b(?:plan|devices?|surcharges?|taxes|fees|credit|discount|payment|service|charge|total|balance|unlimited|account|promo|agreement)\b/i.test(possible)) continue;
          name = possible;
          break;
        }
        const existing = found.get(phone.key);
        if (!existing || (!existing.name && name)) found.set(phone.key, {...phone, name});
      }
    }
    priorPageInCharges = inCharges;
  }
  return [...found.values()];
}
function pageText(items) {
  // Position-based rows keep table cells together even if PDF text items
  // are emitted in column order or omit hasEOL.
  const rows = new Map();
  for (const item of items) {
    if (!item.str || !item.transform) continue;
    const y = Math.round(item.transform[5] / 3) * 3;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(item);
  }
  return [...rows.entries()].sort((a,b) => b[0]-a[0]).map(([,row]) => row.sort((a,b) => a.transform[4]-b.transform[4]).map(item => item.str).join(' ')).join('\n');
}
function findBillTotal(pages) {
  // Read explicit bill-level labels, never paid amounts or individual line
  // totals. Remove letter spacing used by PDF headings before matching.
  const amount = '(?:US\\$|CA\\$|AU\\$|\\$|£|€)?([0-9]{1,3}(?:,[0-9]{3})*\\.[0-9]{2}|[0-9]+\\.[0-9]{2})(?![0-9])';
  const labels = [
    'totalamountdue', 'totalbalancedue',
    'your(?:january|february|march|april|may|june|july|august|september|october|november|december)?billis',
    'amountdue', 'totaldue'
  ];
  for (const label of labels) {
    const values = new Set();
    const pattern = new RegExp('(?<![a-z])' + label + '[:=]?' + amount, 'gi');
    for (const page of pages.slice(0, 5)) {
      const text = page.replace(/\s/g, '').toLowerCase();
      for (const match of text.matchAll(pattern)) {
        const value = Math.round(Number(match[1].replace(/,/g, '')) * 100);
        if (Number.isSafeInteger(value) && value >= 0) values.add(value);
      }
    }
    if (values.size === 1) return [...values][0];
    if (values.size > 1) return null;
  }
  return null;
}
let pdfLibrary;
async function recognizeLines(file, generation) {
  let task;
  try {
    $('line-status').textContent = 'Reading phone numbers from your PDF…';
    pdfLibrary ||= import('./vendor/pdf.mjs');
    const lib = await pdfLibrary;
    lib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', location.href).href;
    if (generation !== uploadGeneration) return;
    task = lib.getDocument({data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false});
    task.onPassword = () => { task.destroy(); if (generation === uploadGeneration) $('line-status').textContent = 'This PDF is password protected. Upload an unlocked copy or add lines manually.'; };
    const pdf = await task.promise;
    const chunks = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 100); pageNumber++) {
      if (generation !== uploadGeneration) return;
      $('line-status').textContent = 'Reading page ' + pageNumber + ' of ' + Math.min(pdf.numPages, 100) + '…';
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      chunks.push(pageText(content.items));
      page.cleanup();
    }
    if (generation !== uploadGeneration) return;
    const total = findBillTotal(chunks);
    if (total !== null) {
      $('bill').value = (total / 100).toFixed(2);
      update();
      $('total-source').textContent = 'Detected from PDF: ' + money(total) + '. Review the amount and selected currency; you can edit either.';
    } else {
      $('total-source').textContent = 'Could not identify a single total amount due. Enter the total bill amount manually.';
    }
    const numbers = findAccountLines(chunks);
    const list = $('line-candidates');
    list.replaceChildren();
    for (const number of numbers) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:10px;margin:12px 0';
      const checkbox = document.createElement('input');
      const display = number.name ? number.name + ' · ' + number.label : number.label;
      checkbox.type = 'checkbox'; checkbox.value = display; checkbox.style.width = 'auto';
      label.append(checkbox, document.createTextNode(display)); list.append(label);
    }
    $('line-import').hidden = !numbers.length;
    $('line-status').textContent = numbers.length
      ? numbers.length + ' account lines found in Charge by line details. Review and select the lines to import.' + (pdf.numPages > 100 ? ' Only the first 100 pages were read.' : '')
      : 'No account lines found in a recognized Charge by line details section. Call history and talk activity are excluded. Add lines manually if the bill uses an unsupported layout or is scanned.';
    $('pdf-status').textContent = file.name + ' · Ready to review.';
  } catch (error) {
    if (generation === uploadGeneration && !/password protected/.test($('line-status').textContent)) {
      $('line-status').textContent = 'Could not read phone numbers from this PDF. You can still preview it and add lines manually.';
    }
  } finally { if (task) await task.destroy().catch(() => {}); }
}
$('import-lines').addEventListener('click', () => {
  const selected = [...$('line-candidates').querySelectorAll('input:checked')].map(input => input.value);
  if (!selected.length) { $('line-status').textContent = 'Select at least one phone number to import.'; return; }
  persons = selected.map(name => ({name, extra: 0})); draw();
  $('line-status').textContent = selected.length + ' plan lines imported. You can edit their labels and individual extras below.';
  $('line-import').hidden = true;
});
