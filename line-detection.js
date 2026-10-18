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
      chunks.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join(''));
      page.cleanup();
    }
    if (generation !== uploadGeneration) return;
    const numbers = findPhoneNumbers(chunks.join('\n'));
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
      ? numbers.length + ' unique phone numbers found. Select your plan lines to import below.' + (pdf.numPages > 100 ? ' Only the first 100 pages were read.' : '')
      : 'No readable North American phone numbers found. Scanned PDFs need OCR; add your lines manually.';
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
