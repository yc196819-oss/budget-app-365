// Text of a PDF statement, page by page. pdf.js is large, so it is loaded
// only when a PDF is picked, from our own server (strict CSP: no CDN).

const MAX_PAGES = 30;
let loading = null;

function pdfjs() {
  if (!loading) {
    loading = import('/app/vendor/pdf.js').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/app/vendor/pdf.worker.js';
      return lib;
    });
  }
  return loading;
}

export async function pdfText(arrayBuffer, onPage) {
  const lib = await pdfjs();
  // isEvalSupported: false keeps pdf.js from compiling code out of the file.
  const doc = await lib.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false }).promise;
  const pages = Math.min(doc.numPages, MAX_PAGES);
  let text = '';
  for (let i = 1; i <= pages; i++) {
    if (onPage) onPage(i, pages);
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  await doc.destroy();
  return text;
}
