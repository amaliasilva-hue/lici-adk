/**
 * Split a PDF File into chunks each at most `maxBytes` in size.
 * Uses pdf-lib to copy pages into new documents.
 * Returns an array of File objects named "<original>_parte_N.pdf".
 */
export async function splitPdf(file: File, maxBytes = 25 * 1024 * 1024): Promise<File[]> {
  const { PDFDocument } = await import('pdf-lib');

  const srcBytes = await file.arrayBuffer();
  const srcDoc = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();

  // If file is already small enough, return as-is
  if (file.size <= maxBytes) return [file];

  const chunks: File[] = [];
  let pageStart = 0;

  while (pageStart < totalPages) {
    let pageEnd = totalPages; // try all remaining pages first
    let chunkBytes: Uint8Array | null = null;

    // Binary search for how many pages fit in maxBytes
    let lo = pageStart + 1;
    let hi = totalPages;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const candidate = await PDFDocument.create();
      const indices = Array.from({ length: mid - pageStart }, (_, i) => pageStart + i);
      const copied = await candidate.copyPages(srcDoc, indices);
      copied.forEach(p => candidate.addPage(p));
      const bytes = await candidate.save();
      if (bytes.length <= maxBytes) {
        chunkBytes = bytes;
        pageEnd = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // Edge case: a single page is already > maxBytes — include it anyway
    if (!chunkBytes) {
      const candidate = await PDFDocument.create();
      const copied = await candidate.copyPages(srcDoc, [pageStart]);
      copied.forEach(p => candidate.addPage(p));
      chunkBytes = await candidate.save();
      pageEnd = pageStart + 1;
    }

    const baseName = file.name.replace(/\.pdf$/i, '');
    const partName = `${baseName}_parte_${chunks.length + 1}.pdf`;
    chunks.push(new File([chunkBytes.buffer as ArrayBuffer], partName, { type: 'application/pdf' }));
    pageStart = pageEnd;
  }

  return chunks;
}
