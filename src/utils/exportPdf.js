/**
 * Client-side PDF export (the html2canvas + jsPDF path).
 *
 * Extracted from QuoteOutput.jsx (TRQ-118) so the component file stops
 * holding ~125 lines of canvas-slicing + page-chrome logic that has
 * nothing to do with rendering the UI. The function is async because
 * canvas serialisation and image decoding both await.
 *
 * Browser-only: uses `window.html2canvas` + `window.jspdf` (loaded
 * elsewhere via the existing CDN script tags in index.html) plus the
 * DOM (`<canvas>`, `Image`). Don't call from Node / SSR.
 *
 * Returns a `Blob` (application/pdf). Side effects — toast, the
 * setGeneratingPDF flag, downloadBlob — stay in the caller; this
 * function is pure(-ish) so the caller can decide how to surface
 * progress and errors.
 *
 * Page composition is unchanged from the original implementation:
 *   1. Slice the captured canvas into A4-page-sized chunks (no overlap
 *      at page breaks).
 *   2. Footer band on every page (company name + address + VAT if reg'd).
 *   3. Photo appendix — 2 photos per page, aspect-preserved, max 2
 *      photos per page, with their own header + footer.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.element        — the DOM node to capture (QuoteDocument)
 * @param {object} opts.jobDetails          — siteAddress, clientName, etc.
 * @param {object} opts.profile             — companyName, address, vatRegistered, vatNumber
 * @param {Array} [opts.filteredPhotos]     — site photos to render as appendix pages
 * @returns {Promise<Blob>}
 */
export async function exportQuoteAsPdf({
  element,
  jobDetails,
  profile,
  filteredPhotos = [],
}) {
  if (!element) throw new Error('exportQuoteAsPdf: element is required');
  if (!window.html2canvas || !window.jspdf?.jsPDF) {
    throw new Error('exportQuoteAsPdf: html2canvas / jsPDF not available on window');
  }

  const canvas = await window.html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
  });

  const pdf = new window.jspdf.jsPDF('p', 'mm', 'a4');
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 15;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;
  const imgWidth = usableWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // Slice the captured canvas into page-sized chunks so the main quote
  // body never overlaps a page break.
  const pxPerMm = canvas.width / imgWidth;
  let yOffsetMm = 0;
  let pageNum = 0;

  const footerParts = (() => {
    const parts = [
      profile.companyName,
      profile.address,
      profile.vatRegistered && profile.vatNumber ? `VAT No: ${profile.vatNumber}` : null,
    ].filter(Boolean);
    return parts.join('  ·  ');
  })();

  const drawFooter = () => {
    pdf.setFontSize(8);
    pdf.setTextColor(150, 150, 150);
    pdf.text(footerParts, pageWidth / 2, pageHeight - 8, { align: 'center' });
  };

  while (yOffsetMm < imgHeight) {
    if (pageNum > 0) pdf.addPage();

    const sliceHeightMm = Math.min(usableHeight, imgHeight - yOffsetMm);
    const srcYPx = Math.round(yOffsetMm * pxPerMm);
    const srcHPx = Math.round(sliceHeightMm * pxPerMm);

    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = srcHPx;
    const ctx = sliceCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, srcYPx, canvas.width, srcHPx, 0, 0, canvas.width, srcHPx);

    const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(sliceData, 'JPEG', margin, margin, imgWidth, sliceHeightMm);

    drawFooter();

    yOffsetMm += usableHeight;
    pageNum++;
  }

  // Photo appendix pages — 2 photos per page, aspect-preserved.
  if (filteredPhotos.length > 0) {
    const photoMargin = 15;
    const photoUsableWidth = pageWidth - photoMargin * 2;
    const maxPhotoHeight = (pageHeight - 50) / 2; // header + footer leaves ~50mm chrome

    for (let i = 0; i < filteredPhotos.length; i += 2) {
      pdf.addPage();

      // Header
      pdf.setFontSize(10);
      pdf.setTextColor(120, 120, 120);
      pdf.text('Site Photographs — ' + jobDetails.siteAddress, photoMargin, 12);
      pdf.setDrawColor(200, 200, 200);
      pdf.line(photoMargin, 15, pageWidth - photoMargin, 15);

      let yPos = 22;

      for (let j = 0; j < 2 && i + j < filteredPhotos.length; j++) {
        const photo = filteredPhotos[i + j];

        // Need image dimensions to preserve aspect ratio. Resolve on
        // both load + error so a corrupt photo doesn't block the run.
        const img = new Image();
        img.src = photo.data;
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
        });

        const aspectRatio = img.width / img.height;
        let drawWidth = photoUsableWidth;
        let drawHeight = drawWidth / aspectRatio;

        if (drawHeight > maxPhotoHeight) {
          drawHeight = maxPhotoHeight;
          drawWidth = drawHeight * aspectRatio;
        }

        const xPos = photoMargin + (photoUsableWidth - drawWidth) / 2;
        pdf.addImage(photo.data, 'JPEG', xPos, yPos, drawWidth, drawHeight);

        yPos += drawHeight + 15;
      }

      drawFooter();
    }
  }

  return pdf.output('blob');
}
