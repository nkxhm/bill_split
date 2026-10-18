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
// Only accept numbers with account/charge context. Never fall back to all
// numbers in the document: activity tables contain other people's numbers.
function findAccountLines(pages) {
  const found = new Map();
  const summary = /\b(?:account summary|account overview|wireless summary|your (?:lines|devices|phone numbers)|lines on (?:your|this) account|(?:charges|cost|summary) (?:by|per|for each) (?:line|number)|(?:line|wireless|monthly|service) (?:summary|charges)|plans? (?:and|&) (?:devices|services)|bill(?:ing)? summary)\b/i;
  const activity = /\b(?:call(?:ing)? (?:history|detail|activity|log)|talk (?:activity|detail)|(?:voice|text|message|data|usage) (?:activity|detail|history)|detailed usage|numbers? (?:called|dialed)|incoming calls|outgoing calls)\b/i;
  const support = /\b(?:customer (?:service|care|support)|contact us|call us|questions|payment (?:options|address)|to pay|support|fax|tty)\b/i;
  const explicit = /\b(?:wireless|mobile|subscriber|telephone|phone|line)\s*(?:number|no\.?|#|:)\s*[:#]?\s*$/i;
  let inSummary = false;
  for (const page of pages) {
    // A page containing activity is never treated as a whole summary section.
    // Explicit summary rows before the activity heading may still qualify.
    const rows = page.split(/\n/);
    if (activity.test(page)) inSummary = false;
    let blocked = false;
    let supportRows = 0;
    for (const row of rows) {
      if (activity.test(row)) { blocked = true; inSummary = false; continue; }
      if (blocked) continue;
      if (summary.test(row)) { inSummary = true; supportRows = 0; }
      if (support.test(row)) { supportRows = 2; continue; }
      if (supportRows > 0) { supportRows--; continue; }
      const phones = findPhoneNumbers(row);
      for (const phone of phones) {
        const digits = phone.key;
        // Toll-free customer service numbers are not subscriber plan lines.
        if (/^(800|888|877|866|855|844|833|822)/.test(digits)) continue;
        const firstPhone = row.search(/(?:\+?1[\s.-]*)?\(?[2-9]\d{2}\)?[\s.-]*\d{3}[\s.-]*\d{4}/);
        const prefix = row.slice(0, firstPhone);
        if (inSummary || explicit.test(prefix)) found.set(phone.key, phone);
      }
    }
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
    const numbers = findAccountLines(chunks);
    const list = $('line-candidates');
    list.replaceChildren();
    for (const number of numbers) {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:10px;margin:12px 0';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.value = number.label; checkbox.style.width = 'auto';
      label.append(checkbox, document.createTextNode(number.label)); list.append(label);
    }
    $('line-import').hidden = !numbers.length;
    $('line-status').textContent = numbers.length
      ? numbers.length + ' account lines found in account/line summary sections. Review and select the lines to import.' + (pdf.numPages > 100 ? ' Only the first 100 pages were read.' : '')
      : 'No account lines could be confidently identified. Call history and talk activity are excluded. Add lines manually if the bill uses an unsupported layout or is scanned.';
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
