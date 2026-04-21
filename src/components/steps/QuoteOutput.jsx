import React, { useRef, useState, useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QuoteDocument from '../QuoteDocument.jsx';
import { buildQuoteFilename } from '../../utils/quoteFilename.js';
import { formatCurrency, formatDate } from '../../utils/quoteBuilder.js';
import { calculateAllTotals } from '../../utils/calculations.js';
import { saveJob as saveQuote, updateJob } from '../../utils/userDB.js';
import useDragReorder from '../../hooks/useDragReorder.js';
import { DEFAULT_NOTES } from '../../utils/defaultNotes.js';

export default function QuoteOutput({ state, dispatch, onBack, isReadOnly, showToast, onCreateRams, onSaved, isAdminPlan = false }) {
  const quoteRef = useRef(null);
  const { profile, jobDetails, reviewData, photos = {}, extraPhotos = [] } = state;

  // Collect all available photos for appendix (slots + extras)
  const allPhotos = [];
  if (photos.overview) allPhotos.push({ label: 'Overview', data: photos.overview.data });
  if (photos.closeup) allPhotos.push({ label: 'Close-up', data: photos.closeup.data });
  if (photos.sideProfile) allPhotos.push({ label: 'Side Profile', data: photos.sideProfile.data });
  if (photos.referenceCard) allPhotos.push({ label: 'Reference Card', data: photos.referenceCard.data });
  if (photos.access) allPhotos.push({ label: 'Access & Approach', data: photos.access.data });
  extraPhotos.forEach((p, i) => {
    allPhotos.push({ label: p.label || `Extra ${i + 1}`, data: p.data });
  });

  // Photo order — controls display sequence (indices into allPhotos)
  const [photoOrder, setPhotoOrder] = useState(() => allPhotos.map((_, i) => i));
  // Photo selection — Set for O(1) toggle, decoupled from order
  const [selectedPhotoIndices, setSelectedPhotoIndices] = useState(() => new Set(allPhotos.map((_, i) => i)));

  const togglePhoto = (index) => {
    setSelectedPhotoIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Derive filteredPhotos: respect order, then filter by selection
  const filteredPhotos = photoOrder
    .filter(i => selectedPhotoIndices.has(i))
    .map(i => allPhotos[i]);

  // Drag-to-reorder hook
  const { dragState, getItemProps, getDragHandleProps } = useDragReorder({
    items: photoOrder,
    onReorder: setPhotoOrder,
  });

  // Compute position number for each selected photo (in display order)
  const orderBadges = {};
  let pos = 1;
  for (const idx of photoOrder) {
    if (selectedPhotoIndices.has(idx)) {
      orderBadges[idx] = pos++;
    }
  }

  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [generatingDocx, setGeneratingDocx] = useState(false);

  // Browser-native print path (Phase 1 fallback). Uses the @media print
  // stylesheet + the hidden .print-root clone of QuoteDocument rendered
  // with showPhotos and selectedPhotos. Works around all the rasterisation
  // failure modes of the html2canvas path: selectable text, Chrome's
  // page-break-inside: avoid honoured on every section.
  const handlePrint = () => {
    setTimeout(() => window.print(), 50);
  };

  // Server-side PDF (Phase 2 — preferred). Renders the same QuoteDocument
  // markup via renderToStaticMarkup, POSTs it to /api/.../pdf where
  // Puppeteer loads our print.css and returns a native selectable-text PDF.
  // One-click download, no print dialog ceremony.
  const [generatingServerPdf, setGeneratingServerPdf] = useState(false);
  const handleDownloadPdfServer = async () => {
    if (!state.currentUserId) {
      showToast?.('Save the quote first, then download PDF.', 'error');
      return;
    }
    setGeneratingServerPdf(true);
    try {
      const quoteHtml = renderToStaticMarkup(
        <QuoteDocument state={state} showPhotos selectedPhotos={filteredPhotos} />
      );
      // TRQ-122: filename is "{Client} - {Property} - {Postcode}" —
      // customer-readable, backend ref lives in the DB.
      const title = buildQuoteFilename({
        clientName: jobDetails.clientName,
        siteAddress: jobDetails.siteAddress,
      });
      const jobId = savedJobId || state.savedJobId || 'draft';
      const res = await fetch(`/api/users/${state.currentUserId}/jobs/${jobId}/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteHtml, title }),
      });
      if (!res.ok) {
        let msg = `PDF failed (${res.status})`;
        try { const j = await res.json(); msg = j.error || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast?.('PDF downloaded', 'success');
    } catch (err) {
      console.error('Server PDF failed:', err);
      showToast?.(`${err.message}. Try "Save as PDF" via browser print.`, 'error');
    } finally {
      setGeneratingServerPdf(false);
    }
  };

  const handleDownloadPDF = async () => {
    const element = quoteRef.current;
    if (!element) return;

    setGeneratingPDF(true);
    try {
      const canvas = await window.html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new window.jspdf.jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const usableWidth = pageWidth - margin * 2;
      const usableHeight = pageHeight - margin * 2;
      const imgWidth = usableWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      // Slice the canvas into page-sized chunks to prevent overlap at page breaks
      const pxPerMm = canvas.width / imgWidth;
      let yOffsetMm = 0;
      let pageNum = 0;

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

        // Footer on every page
        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        const footerParts = [profile.companyName, profile.address, profile.vatRegistered && profile.vatNumber ? `VAT No: ${profile.vatNumber}` : null].filter(Boolean);
        pdf.text(footerParts.join('  ·  '), pageWidth / 2, pageHeight - 8, { align: 'center' });

        yOffsetMm += usableHeight;
        pageNum++;
      }

      // Photo appendix pages — 2 photos per page (filtered by selection)
      if (filteredPhotos.length > 0) {
        const photoMargin = 15;
        const usableWidth = pageWidth - photoMargin * 2;
        const maxPhotoHeight = (pageHeight - 50) / 2; // space for 2 photos + labels + header

        for (let i = 0; i < filteredPhotos.length; i += 2) {
          pdf.addPage();

          // Page header
          pdf.setFontSize(10);
          pdf.setTextColor(120, 120, 120);
          pdf.text('Site Photographs — ' + jobDetails.siteAddress, photoMargin, 12);
          pdf.setDrawColor(200, 200, 200);
          pdf.line(photoMargin, 15, pageWidth - photoMargin, 15);

          let yPos = 22;

          for (let j = 0; j < 2 && i + j < filteredPhotos.length; j++) {
            const photo = filteredPhotos[i + j];

            // Load image to get dimensions
            const img = new Image();
            img.src = photo.data;
            await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });

            const aspectRatio = img.width / img.height;
            let drawWidth = usableWidth;
            let drawHeight = drawWidth / aspectRatio;

            if (drawHeight > maxPhotoHeight) {
              drawHeight = maxPhotoHeight;
              drawWidth = drawHeight * aspectRatio;
            }

            // Centre horizontally
            const xPos = photoMargin + (usableWidth - drawWidth) / 2;

            pdf.addImage(photo.data, 'JPEG', xPos, yPos, drawWidth, drawHeight);

            // Caption
            pdf.setFontSize(8);
            pdf.setTextColor(100, 100, 100);
            pdf.text(photo.label + ' — ' + jobDetails.siteAddress, photoMargin, yPos + drawHeight + 5);

            yPos += drawHeight + 15;
          }

          // Footer on photo pages
          pdf.setFontSize(8);
          pdf.setTextColor(150, 150, 150);
          const photoFooterParts = [profile.companyName, profile.address, profile.vatRegistered && profile.vatNumber ? `VAT No: ${profile.vatNumber}` : null].filter(Boolean);
          pdf.text(photoFooterParts.join('  ·  '), pageWidth / 2, pageHeight - 8, { align: 'center' });
        }
      }

      // TRQ-122: matching filename format used by the Puppeteer path
      const filename = buildQuoteFilename({
        clientName: jobDetails.clientName,
        siteAddress: jobDetails.siteAddress,
      });
      pdf.save(`${filename}.pdf`);
      showToast?.('PDF downloaded', 'success');
    } catch (err) {
      console.error('PDF generation failed:', err);
      showToast?.('PDF generation failed. Please try again.', 'error');
    } finally {
      setGeneratingPDF(false);
    }
  };

  const handleDownloadDocx = async () => {
    setGeneratingDocx(true);
    try {
      const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
              WidthType, AlignmentType, BorderStyle, ImageRun, TableLayoutType,
              convertInchesToTwip, SectionType, Footer } = await import('docx');

      if (!reviewData) return;

      const { damageDescription, measurements, scheduleOfWorks, materials,
              labourEstimate, additionalCosts = [] } = reviewData;

      const labour = {
        days: labourEstimate?.estimatedDays || 0,
        workers: labourEstimate?.numberOfWorkers || 0,
        dayRate: labourEstimate?.dayRate || profile.dayRate,
      };
      const totals = calculateAllTotals(materials, labour, additionalCosts, profile.vatRegistered);
      // Fonts
      const BODY_FONT = 'Calibri';
      const HEADING_FONT = 'Calibri';
      const MONO_FONT = 'Courier New';

      const lightBorder = {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        left: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
      };

      // Helper — text run with proper font embedding
      const txt = (text, opts = {}) => {
        const { font: fontName, ...rest } = opts;
        return new TextRun({
          text,
          font: { name: fontName || BODY_FONT },
          ...rest,
        });
      };

      const monoTxt = (text, opts = {}) => txt(text, { ...opts, font: MONO_FONT });

      // Table column widths in twips. A4 page = 11906 twips, with our 1in
      // margins each side that leaves 9026 twips usable. Previously this
      // table was 9360 — wider than usable width — which made Pages (and
      // sometimes Word) collapse the Description column to ~1ch. Sized
      // conservatively to 8800 to give a 226-twip (~4mm) safety margin.
      const COL_DESC = 3300;  // ~37%
      const COL_QTY = 1000;   // ~11%
      const COL_UNIT_COL = 1000; // ~11%
      const COL_RATE = 1700;  // ~19%
      const COL_TOTAL = 1800; // ~20%
      const COL_SPAN_4 = COL_DESC + COL_QTY + COL_UNIT_COL + COL_RATE; // 7000
      const COL_SPAN_5 = COL_SPAN_4 + COL_TOTAL;                       // 8800

      // Build main document children
      const children = [];

      // Logo in Word header
      if (profile.logo) {
        try {
          const logoBase64 = profile.logo.split(',')[1];
          const logoBytes = atob(logoBase64);
          const logoArray = new Uint8Array(logoBytes.length);
          for (let k = 0; k < logoBytes.length; k++) {
            logoArray[k] = logoBytes.charCodeAt(k);
          }
          // Get logo dimensions for proportional sizing
          const logoImg = new Image();
          logoImg.src = profile.logo;
          await new Promise(resolve => { logoImg.onload = resolve; logoImg.onerror = resolve; });
          const logoAspect = logoImg.width / logoImg.height;
          const maxLogoW = 200;
          const maxLogoH = 80;
          let logoW = maxLogoW;
          let logoH = logoW / logoAspect;
          if (logoH > maxLogoH) {
            logoH = maxLogoH;
            logoW = logoH * logoAspect;
          }
          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: logoArray,
                  transformation: { width: Math.round(logoW), height: Math.round(logoH) },
                }),
              ],
              spacing: { after: 100 },
            })
          );
        } catch (logoErr) {
          console.warn('Failed to add logo to Word document:', logoErr);
        }
      }

      // Header
      const headerName = profile.companyName?.trim() || (!profile.logo ? profile.fullName : '');
      if (headerName) {
        children.push(
          new Paragraph({
            children: [txt(headerName, { bold: true, size: 36, color: '1a1a1a', font: HEADING_FONT })],
            spacing: { after: 40 },
          }),
        );
      }

      if (profile.accreditations?.trim()) {
        children.push(new Paragraph({
          children: [txt(profile.accreditations, { size: 20, color: '888888' })],
        }));
      }

      children.push(
        new Paragraph({
          children: [
            txt(`${formatDate(jobDetails.quoteDate)}  |  ${profile.phone}  |  ${profile.email}`, { size: 20, color: '666666' }),
          ],
          spacing: { after: 300 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' } },
        }),
      );

      // Reference line
      children.push(
        new Paragraph({
          shading: { fill: 'F5F5F5' },
          children: [
            txt(`Quote ref: ${jobDetails.quoteReference} \u2014 ${jobDetails.clientName}, ${jobDetails.siteAddress}`, {
              size: 22, bold: true,
            }),
          ],
          spacing: { before: 300, after: 400 },
        }),
      );

      // Pages.app collapses paragraph-after spacing when adjacent to a
      // shaded paragraph, so the quote-ref block appeared flush against
      // the next heading. An explicit empty paragraph guarantees the gap.
      children.push(new Paragraph({ children: [], spacing: { after: 400 } }));

      // Description of Damage
      children.push(
        new Paragraph({
          children: [txt('DESCRIPTION OF DAMAGE', { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
          spacing: { before: 300, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } },
        }),
      );

      // Parse description: detect numbered section headers (e.g. "1 — Component Name")
      const descText = damageDescription || '';
      const descLines = descText.split('\n');
      const descHeaderPattern = /^\d+\s*[—–-]\s*(.+)$/;
      let hasHeaders = descLines.some(l => descHeaderPattern.test(l));

      if (hasHeaders) {
        let bodyBuf = [];
        const flushDescBody = () => {
          const content = bodyBuf.join('\n').trim();
          if (content) {
            children.push(new Paragraph({
              children: [txt(content, { size: 22 })],
              spacing: { after: 120 },
            }));
          }
          bodyBuf = [];
        };
        for (const line of descLines) {
          if (descHeaderPattern.test(line)) {
            flushDescBody();
            children.push(new Paragraph({
              children: [txt(line, { bold: true, size: 22 })],
              spacing: { before: 200, after: 60 },
            }));
          } else {
            bodyBuf.push(line);
          }
        }
        flushDescBody();
      } else {
        children.push(new Paragraph({
          children: [txt(descText, { size: 22 })],
          spacing: { after: 300 },
        }));
      }

      children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));

      // TRQ-122 follow-up: raw transcript is NOT rendered on the DOCX export
      // — it's AI context only. The transcript stays visible to the tradesman
      // in ReviewEdit.jsx "Video Transcript (read-only)" accordion but never
      // reaches the customer's PDF/DOCX/email.

      // Measurements
      children.push(
        new Paragraph({
          children: [txt('MEASUREMENTS', { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
          spacing: { before: 300, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } },
        }),
      );

      measurements.forEach(m => {
        children.push(new Paragraph({
          bullet: { level: 0 },
          children: [
            txt(`${m.item}: `, { size: 22 }),
            monoTxt(m.confirmed ? m.value : '(unconfirmed)', { size: 22, bold: true }),
          ],
          spacing: { after: 60 },
        }));
      });

      children.push(new Paragraph({ spacing: { after: 300 }, children: [] }));

      // Schedule of Works
      children.push(
        new Paragraph({
          children: [txt('SCHEDULE OF WORKS', { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
          spacing: { before: 300, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } },
        }),
      );

      scheduleOfWorks.forEach((step, i) => {
        children.push(
          new Paragraph({
            children: [txt(`${i + 1}. ${step.title}`, { bold: true, size: 22 })],
            spacing: { before: 120 },
          }),
          new Paragraph({
            children: [txt(step.description, { size: 22 })],
            indent: { left: convertInchesToTwip(0.3) },
            spacing: { after: 120 },
          }),
        );
      });

      children.push(new Paragraph({ spacing: { after: 300 }, children: [] }));

      // Cost Breakdown
      children.push(
        new Paragraph({
          children: [txt('COST BREAKDOWN', { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
          spacing: { before: 300, after: 200 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } },
        }),
      );

      // Cost table with fixed DXA widths
      const tableRows = [];

      // Header row
      tableRows.push(
        new TableRow({
          tableHeader: true,
          children: [
            new TableCell({
              children: [new Paragraph({ children: [txt('Description', { bold: true, size: 20, color: '666666' })] })],
              borders: lightBorder,
              width: { size: COL_DESC, type: WidthType.DXA },
            }),
            new TableCell({
              children: [new Paragraph({ children: [txt('Qty', { bold: true, size: 20, color: '666666' })] })],
              borders: lightBorder,
              width: { size: COL_QTY, type: WidthType.DXA },
            }),
            new TableCell({
              children: [new Paragraph({ children: [txt('Unit', { bold: true, size: 20, color: '666666' })] })],
              borders: lightBorder,
              width: { size: COL_UNIT_COL, type: WidthType.DXA },
            }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt('Rate', { bold: true, size: 20, color: '666666' })] })],
              borders: lightBorder,
              width: { size: COL_RATE, type: WidthType.DXA },
            }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt('Total', { bold: true, size: 20, color: '666666' })] })],
              borders: lightBorder,
              width: { size: COL_TOTAL, type: WidthType.DXA },
            }),
          ],
        })
      );

      // Material rows (filter empty/£0 rows)
      materials.filter(mat => mat.description?.trim() && mat.totalCost > 0).forEach(mat => {
        tableRows.push(
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [txt(mat.description, { size: 22 })] })],
                borders: lightBorder,
                width: { size: COL_DESC, type: WidthType.DXA },
              }),
              new TableCell({
                children: [new Paragraph({ children: [txt(String(mat.quantity), { size: 22 })] })],
                borders: lightBorder,
                width: { size: COL_QTY, type: WidthType.DXA },
              }),
              new TableCell({
                children: [new Paragraph({ children: [txt(mat.unit || '\u2014', { size: 22 })] })],
                borders: lightBorder,
                width: { size: COL_UNIT_COL, type: WidthType.DXA },
              }),
              new TableCell({
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(mat.unitCost), { size: 22 })] })],
                borders: lightBorder,
                width: { size: COL_RATE, type: WidthType.DXA },
              }),
              new TableCell({
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(mat.totalCost), { size: 22 })] })],
                borders: lightBorder,
                width: { size: COL_TOTAL, type: WidthType.DXA },
              }),
            ],
          })
        );
      });

      // Labour row — hide day rate from client-facing output
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [txt('Labour', { size: 22 })] })],
              borders: lightBorder,
              width: { size: COL_SPAN_4, type: WidthType.DXA },
              columnSpan: 4,
            }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(totals.labourTotal), { size: 22 })] })],
              borders: lightBorder,
              width: { size: COL_TOTAL, type: WidthType.DXA },
            }),
          ],
        })
      );

      // Additional costs (each with its own label, no group header)
      additionalCosts.forEach(cost => {
        tableRows.push(
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [txt(cost.label, { size: 22 })] })],
                borders: lightBorder,
                width: { size: COL_SPAN_4, type: WidthType.DXA },
                columnSpan: 4,
              }),
              new TableCell({
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(cost.amount), { size: 22 })] })],
                borders: lightBorder,
                width: { size: COL_TOTAL, type: WidthType.DXA },
              }),
            ],
          })
        );
      });

      children.push(
        new Table({
          rows: tableRows,
          width: { size: COL_SPAN_5, type: WidthType.DXA },
          // Fixed layout + explicit columnWidths is required, otherwise Word /
          // Pages ignores the per-cell widths and auto-fits based on content,
          // which collapsed the Description column so text wrapped one char
          // per line. Total width must also fit within the page's usable area
          // (9026 twips on 1-inch-margin A4) — we use 8800 with safety.
          columnWidths: [COL_DESC, COL_QTY, COL_UNIT_COL, COL_RATE, COL_TOTAL],
          layout: TableLayoutType.FIXED,
        })
      );

      // Totals — built as a 3-column table (spacer / label / value) because
      // Pages.app silently ignores AlignmentType.RIGHT on plain paragraphs.
      // A fixed-layout table is the only reliable way to push totals to the
      // right edge across both Word and Pages.
      const TOT_SPACER = 4400; // pushes the totals block to the right
      const TOT_LABEL = 2400;
      const TOT_VALUE = 2000;
      const noBorder = {
        top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      };
      const totalRowBorder = {
        top:    { style: BorderStyle.SINGLE, size: 8, color: '333333' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      };

      const totalsRows = [];

      // Subtotal
      totalsRows.push(
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph('')], borders: noBorder, width: { size: TOT_SPACER, type: WidthType.DXA } }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt('Subtotal (ex VAT)', { size: 22, color: '666666' })] })],
              borders: noBorder,
              width: { size: TOT_LABEL, type: WidthType.DXA },
            }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(totals.subtotal), { size: 22 })] })],
              borders: noBorder,
              width: { size: TOT_VALUE, type: WidthType.DXA },
            }),
          ],
        })
      );

      // VAT (conditional)
      if (profile.vatRegistered) {
        totalsRows.push(
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph('')], borders: noBorder, width: { size: TOT_SPACER, type: WidthType.DXA } }),
              new TableCell({
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt('VAT (20%)', { size: 22, color: '666666' })] })],
                borders: noBorder,
                width: { size: TOT_LABEL, type: WidthType.DXA },
              }),
              new TableCell({
                children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(totals.vatAmount), { size: 22 })] })],
                borders: noBorder,
                width: { size: TOT_VALUE, type: WidthType.DXA },
              }),
            ],
          })
        );
      }

      // TOTAL row — heavy top border, larger size, brand accent on the value
      totalsRows.push(
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph('')], borders: noBorder, width: { size: TOT_SPACER, type: WidthType.DXA } }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt('TOTAL', { size: 28, bold: true, font: HEADING_FONT, color: '1a1a1a' })] })],
              borders: totalRowBorder,
              width: { size: TOT_LABEL, type: WidthType.DXA },
            }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(totals.total), { size: 28, bold: true, color: 'd97706' })] })],
              borders: totalRowBorder,
              width: { size: TOT_VALUE, type: WidthType.DXA },
            }),
          ],
        })
      );

      // Spacer above the totals block
      children.push(new Paragraph({ spacing: { before: 200 }, children: [] }));

      children.push(
        new Table({
          rows: totalsRows,
          width: { size: COL_SPAN_5, type: WidthType.DXA },
          columnWidths: [TOT_SPACER, TOT_LABEL, TOT_VALUE],
          layout: TableLayoutType.FIXED,
        })
      );

      // Generous breathing room between TOTAL and the next section (Notes).
      children.push(new Paragraph({ spacing: { after: 600 }, children: [] }));

      // Notes & Conditions — respect profile toggle
      if (profile.showNotesOnQuote !== false) {
        const notes = reviewData.notes && reviewData.notes.length > 0 ? reviewData.notes : DEFAULT_NOTES;

        children.push(
          new Paragraph({
            children: [txt('NOTES & CONDITIONS', { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
            spacing: { before: 400, after: 120 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } },
          }),
        );

        notes.forEach((note, i) => {
          children.push(new Paragraph({
            children: [txt(`${i + 1}. ${note}`, { size: 20 })],
            spacing: { after: 80 },
          }));
        });

        children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
      }

      // Footer — now rendered via section footers (not inline paragraphs)
      const docFooterParts = [profile.companyName, profile.address, profile.vatRegistered && profile.vatNumber ? `VAT No: ${profile.vatNumber}` : null].filter(Boolean);
      const docFooter = new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [txt(docFooterParts.join('  ·  '), { size: 16, color: '999999' })],
        })],
      });

      // Photo appendix — 2 photos per page, each in its own section with page breaks
      const photoPageSections = [];

      if (filteredPhotos.length > 0) {
        for (let i = 0; i < filteredPhotos.length; i += 2) {
          const pageChildren = [];

          // Header for each photo page
          pageChildren.push(
            new Paragraph({
              children: [txt('SITE PHOTOGRAPHS', { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
              spacing: { after: 200 },
            })
          );

          for (let j = 0; j < 2 && i + j < filteredPhotos.length; j++) {
            const photo = filteredPhotos[i + j];
            try {
              const base64Data = photo.data.split(',')[1];
              const byteChars = atob(base64Data);
              const byteArray = new Uint8Array(byteChars.length);
              for (let k = 0; k < byteChars.length; k++) {
                byteArray[k] = byteChars.charCodeAt(k);
              }

              // Get image dimensions
              const img = new Image();
              img.src = photo.data;
              await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });

              // Size to fit — max 6in wide, max 4in tall (2 photos per page)
              const maxW = 6 * 96;  // 576px at 96dpi
              const maxH = 3.8 * 96; // 365px — leaves room for caption + header
              const aspect = img.width / img.height;

              let drawW = maxW;
              let drawH = drawW / aspect;
              if (drawH > maxH) {
                drawH = maxH;
                drawW = drawH * aspect;
              }

              pageChildren.push(
                new Paragraph({
                  children: [
                    new ImageRun({
                      data: byteArray,
                      transformation: {
                        width: Math.round(drawW),
                        height: Math.round(drawH),
                      },
                    }),
                  ],
                  spacing: { before: 100, after: 40 },
                }),
                new Paragraph({
                  children: [txt(`${photo.label} \u2014 ${jobDetails.siteAddress}`, { size: 18, color: '888888', italics: true })],
                  spacing: { after: 200 },
                }),
              );
            } catch (photoErr) {
              console.warn('Failed to add photo to docx:', photo.label, photoErr);
            }
          }

          photoPageSections.push({
            properties: { type: SectionType.NEXT_PAGE },
            footers: { default: docFooter },
            children: pageChildren,
          });
        }
      }

      const doc = new Document({
        styles: {
          default: {
            document: {
              run: { font: { name: BODY_FONT }, size: 22 },
            },
          },
        },
        sections: [
          {
            properties: {
              page: {
                margin: {
                  top: convertInchesToTwip(1),
                  bottom: convertInchesToTwip(1),
                  left: convertInchesToTwip(1),
                  right: convertInchesToTwip(1),
                },
              },
            },
            footers: { default: docFooter },
            children,
          },
          ...photoPageSections,
        ],
      });

      const blob = await Packer.toBlob(doc);
      // TRQ-122: matching filename format used by the PDF paths
      const filename = `${buildQuoteFilename({
        clientName: jobDetails.clientName,
        siteAddress: jobDetails.siteAddress,
      })}.docx`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast?.('Word document downloaded', 'success');
    } catch (err) {
      console.error('Word export failed:', err);
      showToast?.('Word export failed. Please try again.', 'error');
    } finally {
      setGeneratingDocx(false);
    }
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(
      `Quote ${jobDetails.quoteReference} \u2014 ${jobDetails.siteAddress}`
    );
    // TRQ-122 follow-up: the raw transcript is AI context only, never
    // pasted into customer-facing output (PDF, DOCX, email body).
    const body = encodeURIComponent(
      `Dear ${jobDetails.clientName},\n\nPlease find attached our quote (ref: ${jobDetails.quoteReference}) for dry stone walling works at ${jobDetails.siteAddress}.\n\nPlease do not hesitate to contact us should you have any questions.\n\nKind regards,\n${profile.fullName}\n${profile.companyName}\n${profile.phone}`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const handleNewQuote = () => {
    dispatch({ type: 'NEW_QUOTE' });
  };

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(!!state.savedJobId);
  const [saveError, setSaveError] = useState(state.quoteSaveError || null);
  const [savedJobId, setSavedJobId] = useState(state.savedJobId || null);

  // Sync from auto-save reducer state
  useEffect(() => {
    if (state.savedJobId && !savedJobId) {
      setSavedJobId(state.savedJobId);
      setSaved(true);
    }
    if (state.quoteSaveError && !saveError) {
      setSaveError(state.quoteSaveError);
    }
  }, [state.savedJobId, state.quoteSaveError]);

  // "Saved" stays visible persistently — the button text confirms the quote is stored.
  // Only resets when user explicitly re-saves (which sets saving=true then saved=true again).

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const existingId = savedJobId || state.savedJobId;
      let id;
      if (existingId) {
        // Job already exists — update in place instead of creating a duplicate
        await updateJob(state.currentUserId, existingId, state);
        id = existingId;
      } else {
        id = await saveQuote(state.currentUserId, state);
      }
      setSaved(true);
      setSavedJobId(id);
      dispatch({ type: 'QUOTE_SAVED', jobId: id });
      showToast?.('Quote saved', 'success');
      onSaved?.();
    } catch (err) {
      console.error('Failed to save quote:', err);
      setSaveError(err.message || 'Failed to save');
      showToast?.(err.message || 'Failed to save quote', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Header with back navigation */}
      <div className="flex items-center gap-3 mb-1">
        {!isReadOnly && !onBack && (
          <button
            onClick={() => dispatch({ type: 'BACK_TO_REVIEW' })}
            className="flex items-center gap-1 text-sm font-heading uppercase tracking-wide hover:text-tq-accent transition-colors"
            style={{ color: 'var(--tq-muted)', minHeight: 44, padding: '8px 0' }}
            title="Back to Review & Edit"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            <span className="hidden fq:inline">Review</span>
          </button>
        )}
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm font-heading uppercase tracking-wide hover:text-tq-accent transition-colors"
            style={{ color: 'var(--tq-muted)', minHeight: 44, padding: '8px 0' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            <span className="hidden fq:inline">Back</span>
          </button>
        )}
        <h2 className="page-title" style={{ fontSize: 28 }}>
          Your Quote
        </h2>
      </div>
      <p className="text-tq-muted text-sm mb-6">
        Review the final document, then download as PDF or Word, or send via email.
      </p>

      {/* Primary actions: export/download */}
      <div className="flex flex-col fq:flex-row flex-wrap gap-3 mb-4">
        <button
          onClick={handleDownloadPdfServer}
          disabled={generatingServerPdf}
          className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
          title="Crisp PDF with selectable text, rendered server-side by Chromium"
        >
          {generatingServerPdf ? 'Generating PDF...' : 'Download PDF'}
        </button>
        <button
          onClick={handlePrint}
          className="btn-ghost"
          title="Uses your browser's print dialog — fallback if Download PDF fails"
        >
          Save via print
        </button>
        <button
          onClick={handleDownloadDocx}
          disabled={generatingDocx}
          className="btn-ghost disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {generatingDocx ? 'Generating Word...' : 'Download Word'}
        </button>
        <button onClick={handleEmail} className="btn-ghost">
          Send via Email
        </button>
        {!isReadOnly && (
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className={`btn-ghost ${
              saved
                ? 'border-tq-confirmed text-tq-confirmed'
                : saveError
                  ? 'border-red-500 text-red-400'
                  : ''
            }`}
          >
            {saving ? 'Saving...' : saved ? 'Saved \u2713' : 'Save Quote'}
          </button>
        )}
        {saveError && !saving && (
          <span className="text-xs self-center" style={{ color: 'var(--tq-error-txt, #f87171)' }}>
            Save failed — your work is preserved in this tab.
          </span>
        )}
      </div>

      {/* Secondary actions: edit, RAMS, new quote */}
      <div className="flex flex-wrap gap-3 mb-4">
        {!isReadOnly && state.quoteMode === 'quick' && (
          <button onClick={() => dispatch({ type: 'BACK_TO_REVIEW' })} className="btn-ghost text-sm">
            Full Review & Edit
          </button>
        )}
        {!isReadOnly && (
          <button onClick={() => dispatch({ type: 'SET_STEP', step: 2 })} className="btn-ghost text-sm" style={{ color: 'var(--tq-muted)' }}>
            Edit Job Details
          </button>
        )}
        {!isReadOnly && onCreateRams && isAdminPlan && (
          <button
            onClick={() => onCreateRams(savedJobId)}
            disabled={!savedJobId}
            className="btn-ghost text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderColor: 'var(--tq-accent)', color: 'var(--tq-accent)' }}
            title={savedJobId ? 'Create RAMS for this job' : 'Save the quote first to create a RAMS'}
          >
            Create RAMS
          </button>
        )}
        {!isReadOnly && !onBack && (
          <button onClick={handleNewQuote} className="btn-ghost text-sm" style={{ color: 'var(--tq-muted)' }}>
            Start New Quote
          </button>
        )}
      </div>

      <p className="text-tq-muted text-xs mb-6">
        Tip: When emailing, attach your downloaded PDF or Word document before sending.
      </p>

      {/* Photo selection & reorder grid */}
      {allPhotos.length > 0 && (
        <div className="mb-6">
          <div className="eyebrow mb-3">
            Photos to Include ({filteredPhotos.length}/{allPhotos.length})
            <span className="font-normal text-tq-muted ml-2" style={{ textTransform: 'none', letterSpacing: 'normal' }}>
              Drag to reorder
            </span>
          </div>
          <div className="flex gap-3 flex-wrap">
            {photoOrder.map((photoIdx, orderPos) => {
              const photo = allPhotos[photoIdx];
              if (!photo) return null;
              const isSelected = selectedPhotoIndices.has(photoIdx);
              const isDragged = dragState.dragIndex === orderPos;
              const isDropTarget = dragState.isDragging && dragState.overIndex === orderPos;

              return (
                <div
                  key={photoIdx}
                  {...getItemProps(orderPos)}
                  className={`relative rounded transition-all ${isDragged ? 'opacity-50 scale-105' : ''}`}
                  style={{
                    border: isDropTarget
                      ? '2px solid var(--tq-accent)'
                      : isSelected
                        ? '2px solid var(--tq-accent)'
                        : '2px solid var(--tq-border)',
                    opacity: isSelected ? 1 : 0.6,
                  }}
                >
                  {/* Drag handle — 6-dot grip icon, top-left */}
                  <span
                    {...getDragHandleProps(orderPos)}
                    className="absolute top-1 left-1 z-10 w-5 h-5 flex items-center justify-center rounded bg-black/40 text-white text-[10px] cursor-grab hover:bg-black/60 fq:opacity-0 fq:group-hover:opacity-100"
                    style={{ touchAction: 'none' }}
                    title="Drag to reorder"
                  >
                    ⠿
                  </span>

                  {/* Order badge — position number for selected photos */}
                  {isSelected && orderBadges[photoIdx] != null && (
                    <span className="absolute top-1 left-1/2 -translate-x-1/2 z-10 w-5 h-5 rounded-full bg-tq-accent text-tq-bg flex items-center justify-center text-[10px] font-bold">
                      {orderBadges[photoIdx]}
                    </span>
                  )}

                  <img
                    src={photo.data}
                    alt={photo.label}
                    className="w-20 h-20 object-cover rounded"
                  />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5 rounded-b">
                    {photo.label}
                  </span>

                  {/* Selection toggle — checkmark, top-right */}
                  <button
                    onClick={() => togglePhoto(photoIdx)}
                    className={`absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold z-10 ${
                      isSelected ? 'bg-tq-confirmed text-white' : 'bg-tq-card text-tq-muted border border-tq-border'
                    }`}
                  >
                    {isSelected ? '✓' : ''}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quote Document — showPhotos=false to prevent white band artefact in
           the legacy html2canvas PDF; photos are rendered separately in that
           path's PDF/Word appendix. */}
      <div className="bg-white shadow-lg overflow-hidden" ref={quoteRef} style={{ borderRadius: 2 }}>
        <QuoteDocument state={state} showPhotos={false} />
      </div>

      {/* Print-only clone — full quote + photo appendix rendered inline so
           the browser's print engine (native page-break-inside: avoid CSS)
           paginates cleanly. Hidden on screen via `.print-only`. */}
      <div className="print-root print-only" aria-hidden="true">
        <QuoteDocument state={state} showPhotos selectedPhotos={filteredPhotos} />
      </div>
    </div>
  );
}
