/**
 * DOCX export — builds the customer-facing Word document.
 *
 * Extracted from QuoteOutput.jsx (TRQ-118) so the component file stops
 * holding ~680 lines of doc-building logic. The function is async because
 * it dynamically imports the `docx` library (lazy-loaded for bundle
 * size) and decodes embedded image bytes.
 *
 * Browser-only: depends on `Image`, `atob`, `Uint8Array`. The `docx`
 * library itself is universal but its image decoding pipeline expects
 * the byte arrays we build here.
 *
 * Side effects (toast, setGeneratingDocx flag, downloadBlob) stay in
 * the caller. This function takes structured inputs and returns the
 * generated `Blob` — the caller decides how to surface progress and
 * errors and how to deliver the file (Web Share API on iOS, anchor
 * download elsewhere).
 *
 * @param {object} opts
 * @param {object} opts.jobDetails     — quoteDate, quoteReference, clientName, siteAddress
 * @param {object} opts.profile        — companyName, fullName, phone, email, address,
 *                                       tradingAddress, accreditations, logo (data URL),
 *                                       vatRegistered, vatNumber, showNotesOnQuote
 * @param {object} opts.term           — documentTerm result ({ title, lower, upper })
 * @param {object} opts.reviewData     — damageDescription, measurements, scheduleOfWorks,
 *                                       materials, labourEstimate, additionalCosts, notes
 * @param {object} opts.totals         — calculateAllTotals result ({ subtotal, vatAmount,
 *                                       total, labourTotal })
 * @param {Array} [opts.filteredPhotos] — ordered + selected site photos
 * @returns {Promise<Blob>}            — application/vnd.openxmlformats-officedocument.wordprocessingml.document
 */
import { formatCurrency, formatDate } from './quoteBuilder.js';
import { photoMaxDimensions } from './photoLayout.js';
import { DEFAULT_NOTES } from './defaultNotes.js';

export async function exportQuoteAsDocx({
  jobDetails,
  profile,
  term,
  reviewData,
  totals,
  filteredPhotos = [],
}) {
  if (!reviewData) {
    throw new Error('exportQuoteAsDocx: reviewData is required');
  }

  // Dynamic import keeps the docx library out of the main bundle.
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, AlignmentType, BorderStyle, ImageRun, TableLayoutType,
    convertInchesToTwip, SectionType, Footer, Header,
  } = await import('docx');

  const {
    damageDescription, measurements, scheduleOfWorks, materials,
    additionalCosts = [],
  } = reviewData;

  // Fonts
  const BODY_FONT = 'Calibri';
  const HEADING_FONT = 'Calibri';
  const MONO_FONT = 'Courier New';

  const lightBorder = {
    top:    { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
    left:   { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
    right:  { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
  };

  // Text-run helper with proper font embedding
  const txt = (text, opts = {}) => {
    const { font: fontName, ...rest } = opts;
    return new TextRun({
      text,
      font: { name: fontName || BODY_FONT },
      ...rest,
    });
  };
  const monoTxt = (text, opts = {}) => txt(text, { ...opts, font: MONO_FONT });

  // Table column widths in twips. A4 page = 11906 twips; with 1in
  // margins each side = 9026 twips usable. Sized conservatively to
  // 8800 so Pages doesn't collapse the Description column (TRQ-110).
  const COL_DESC = 3300;
  const COL_QTY = 1000;
  const COL_UNIT_COL = 1000;
  const COL_RATE = 1700;
  const COL_TOTAL = 1800;
  const COL_SPAN_4 = COL_DESC + COL_QTY + COL_UNIT_COL + COL_RATE; // 7000
  const COL_SPAN_5 = COL_SPAN_4 + COL_TOTAL;                       // 8800

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
      const logoImg = new Image();
      logoImg.src = profile.logo;
      await new Promise((resolve) => { logoImg.onload = resolve; logoImg.onerror = resolve; });
      const logoAspect = logoImg.width / logoImg.height;
      // 245×120 matches the 65×32mm logo on Mark's reference PDF
      // (was 200×80 ≈ 53×21mm at Word's 96dpi — felt undersized).
      const maxLogoW = 245;
      const maxLogoH = 120;
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
        }),
      );
    } catch (logoErr) {
      console.warn('Failed to add logo to Word document:', logoErr);
    }
  }

  // Company name (fallback to fullName if no logo + no company name)
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
        txt(
          `${term.title} ref: ${jobDetails.quoteReference} — ${jobDetails.clientName}, ${jobDetails.siteAddress}`,
          { size: 22, bold: true },
        ),
      ],
      spacing: { before: 300, after: 400 },
    }),
  );

  // Pages.app collapses paragraph-after spacing when adjacent to a
  // shaded paragraph — explicit empty paragraph guarantees the gap.
  children.push(new Paragraph({ children: [], spacing: { after: 400 } }));

  // Description of Damage
  children.push(
    new Paragraph({
      children: [txt('DESCRIPTION OF DAMAGE', { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
      spacing: { before: 300, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } },
    }),
  );

  // Numbered-section parsing — "1 — Component Name" headers go bold,
  // bodies render as plain paragraphs underneath.
  const descText = damageDescription || '';
  const descLines = descText.split('\n');
  const descHeaderPattern = /^\d+\s*[—–-]\s*(.+)$/;
  const hasHeaders = descLines.some((l) => descHeaderPattern.test(l));

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

  // TRQ-122 follow-up: raw transcript is NOT rendered — AI context only.

  // Measurements
  children.push(
    new Paragraph({
      children: [txt('MEASUREMENTS', { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
      spacing: { before: 300, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } },
    }),
  );

  measurements.forEach((m) => {
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

  const tableRows = [];

  // Header row
  tableRows.push(
    new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          children: [new Paragraph({ children: [txt('Description', { bold: true, size: 20, color: '666666' })] })],
          borders: lightBorder, width: { size: COL_DESC, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ children: [txt('Qty', { bold: true, size: 20, color: '666666' })] })],
          borders: lightBorder, width: { size: COL_QTY, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ children: [txt('Unit', { bold: true, size: 20, color: '666666' })] })],
          borders: lightBorder, width: { size: COL_UNIT_COL, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt('Rate', { bold: true, size: 20, color: '666666' })] })],
          borders: lightBorder, width: { size: COL_RATE, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt('Total', { bold: true, size: 20, color: '666666' })] })],
          borders: lightBorder, width: { size: COL_TOTAL, type: WidthType.DXA },
        }),
      ],
    }),
  );

  // Material rows (filter empty/£0 rows)
  materials
    .filter((mat) => mat.description?.trim() && mat.totalCost > 0)
    .forEach((mat) => {
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [txt(mat.description, { size: 22 })] })],
              borders: lightBorder, width: { size: COL_DESC, type: WidthType.DXA },
            }),
            new TableCell({
              children: [new Paragraph({ children: [txt(String(mat.quantity), { size: 22 })] })],
              borders: lightBorder, width: { size: COL_QTY, type: WidthType.DXA },
            }),
            new TableCell({
              children: [new Paragraph({ children: [txt(mat.unit || '—', { size: 22 })] })],
              borders: lightBorder, width: { size: COL_UNIT_COL, type: WidthType.DXA },
            }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(mat.unitCost), { size: 22 })] })],
              borders: lightBorder, width: { size: COL_RATE, type: WidthType.DXA },
            }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(mat.totalCost), { size: 22 })] })],
              borders: lightBorder, width: { size: COL_TOTAL, type: WidthType.DXA },
            }),
          ],
        }),
      );
    });

  // Labour row — total only (day rate hidden from client-facing output)
  tableRows.push(
    new TableRow({
      children: [
        new TableCell({
          children: [new Paragraph({ children: [txt('Labour', { size: 22 })] })],
          borders: lightBorder, width: { size: COL_SPAN_4, type: WidthType.DXA }, columnSpan: 4,
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(totals.labourTotal), { size: 22 })] })],
          borders: lightBorder, width: { size: COL_TOTAL, type: WidthType.DXA },
        }),
      ],
    }),
  );

  // Additional costs (each with its own label, no group header)
  additionalCosts.forEach((cost) => {
    tableRows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [txt(cost.label, { size: 22 })] })],
            borders: lightBorder, width: { size: COL_SPAN_4, type: WidthType.DXA }, columnSpan: 4,
          }),
          new TableCell({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(cost.amount), { size: 22 })] })],
            borders: lightBorder, width: { size: COL_TOTAL, type: WidthType.DXA },
          }),
        ],
      }),
    );
  });

  children.push(
    new Table({
      rows: tableRows,
      width: { size: COL_SPAN_5, type: WidthType.DXA },
      // Fixed layout + explicit columnWidths required; Pages/Word
      // otherwise ignore per-cell widths and auto-fit the Description
      // column down to one char per line.
      columnWidths: [COL_DESC, COL_QTY, COL_UNIT_COL, COL_RATE, COL_TOTAL],
      layout: TableLayoutType.FIXED,
    }),
  );

  // Totals — 3-column borderless table so Pages.app honours right-alignment.
  const TOT_SPACER = 4400;
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
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt(`Subtotal${profile.vatRegistered === true ? ' (ex VAT)' : ''}`, { size: 22, color: '666666' })] })],
          borders: noBorder, width: { size: TOT_LABEL, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(totals.subtotal), { size: 22 })] })],
          borders: noBorder, width: { size: TOT_VALUE, type: WidthType.DXA },
        }),
      ],
    }),
  );

  // VAT (conditional — strict boolean only)
  if (profile.vatRegistered === true) {
    totalsRows.push(
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph('')], borders: noBorder, width: { size: TOT_SPACER, type: WidthType.DXA } }),
          new TableCell({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt('VAT (20%)', { size: 22, color: '666666' })] })],
            borders: noBorder, width: { size: TOT_LABEL, type: WidthType.DXA },
          }),
          new TableCell({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(totals.vatAmount), { size: 22 })] })],
            borders: noBorder, width: { size: TOT_VALUE, type: WidthType.DXA },
          }),
        ],
      }),
    );
  }

  // TOTAL row — heavy top border, larger size, brand accent on the value
  totalsRows.push(
    new TableRow({
      children: [
        new TableCell({ children: [new Paragraph('')], borders: noBorder, width: { size: TOT_SPACER, type: WidthType.DXA } }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [txt('TOTAL', { size: 28, bold: true, font: HEADING_FONT, color: '1a1a1a' })] })],
          borders: totalRowBorder, width: { size: TOT_LABEL, type: WidthType.DXA },
        }),
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(totals.total), { size: 28, bold: true, color: 'd97706' })] })],
          borders: totalRowBorder, width: { size: TOT_VALUE, type: WidthType.DXA },
        }),
      ],
    }),
  );

  children.push(new Paragraph({ spacing: { before: 200 }, children: [] }));
  children.push(
    new Table({
      rows: totalsRows,
      width: { size: COL_SPAN_5, type: WidthType.DXA },
      columnWidths: [TOT_SPACER, TOT_LABEL, TOT_VALUE],
      layout: TableLayoutType.FIXED,
    }),
  );

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

  // Footer rendered via section footer (not inline paragraphs).
  const docFooterAddress = profile.tradingAddress || profile.address || '';
  const docFooterParts = [
    docFooterAddress,
    profile.vatRegistered && profile.vatNumber ? `VAT No: ${profile.vatNumber}` : null,
  ].filter(Boolean);
  const docFooter = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [txt(docFooterParts.join('  ·  '), { size: 16, color: '222222' })],
    })],
  });

  // Header — date · email · phone, three columns, justified (TRQ-169).
  const headerDateText = jobDetails.quoteDate ? formatDate(jobDetails.quoteDate) : '';
  const headerHasContent = !!(headerDateText || profile.email || profile.phone);
  const docHeader = headerHasContent
    ? new Header({
        children: [new Paragraph({
          tabStops: [
            { type: 'center', position: 4500 },
            { type: 'right', position: 9000 },
          ],
          children: [
            txt(headerDateText, { size: 18, color: '666666' }),
            txt('\t' + (profile.email || ''), { size: 18, color: '666666' }),
            txt('\t' + (profile.phone || ''), { size: 18, color: '666666' }),
          ],
        })],
      })
    : null;

  // Photo appendix — 2 photos per page, each in its own section.
  // Aspect-aware sizing per photoLayout.js. Heading only on the first
  // photo page (TRQ-177).
  const photoPageSections = [];

  if (filteredPhotos.length > 0) {
    for (let i = 0; i < filteredPhotos.length; i += 2) {
      const pageChildren = [];
      const isFirstPhotoPage = i === 0;

      if (isFirstPhotoPage) {
        pageChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [txt('SITE PHOTOGRAPHS', { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
            spacing: { after: 160 },
          }),
        );
      }

      for (let j = 0; j < 2 && i + j < filteredPhotos.length; j++) {
        const photo = filteredPhotos[i + j];
        try {
          const base64Data = photo.data.split(',')[1];
          const byteChars = atob(base64Data);
          const byteArray = new Uint8Array(byteChars.length);
          for (let k = 0; k < byteChars.length; k++) {
            byteArray[k] = byteChars.charCodeAt(k);
          }

          const img = new Image();
          img.src = photo.data;
          await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });

          // Aspect-aware sizing — see src/utils/photoLayout.js.
          const aspect = img.width / img.height;
          const { maxWidthMm, maxHeightMm } = photoMaxDimensions(aspect);
          const MM_TO_PX = 96 / 25.4; // Word renders at 96 DPI
          const maxW = maxWidthMm * MM_TO_PX;
          const maxH = maxHeightMm * MM_TO_PX;

          let drawW = maxW;
          let drawH = drawW / aspect;
          if (drawH > maxH) {
            drawH = maxH;
            drawW = drawH * aspect;
          }

          pageChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  data: byteArray,
                  transformation: {
                    width: Math.round(drawW),
                    height: Math.round(drawH),
                  },
                }),
              ],
              spacing: { before: 60, after: 120 },
            }),
          );
        } catch (photoErr) {
          console.warn('Failed to add photo to docx:', photo.label, photoErr);
        }
      }

      // Tighter margins on photo pages — see original TRQ-177 reasoning
      // in QuoteOutput history. 0.7in T/B + 0.5in L/R fits 2 landscape
      // photos + the heading on one A4 page.
      photoPageSections.push({
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            margin: {
              top:    convertInchesToTwip(0.7),
              bottom: convertInchesToTwip(0.7),
              left:   convertInchesToTwip(0.5),
              right:  convertInchesToTwip(0.5),
            },
          },
        },
        ...(docHeader ? { headers: { default: docHeader } } : {}),
        footers: { default: docFooter },
        children: pageChildren,
      });
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: { name: BODY_FONT }, size: 22 } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top:    convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left:   convertInchesToTwip(1),
              right:  convertInchesToTwip(1),
            },
          },
        },
        ...(docHeader ? { headers: { default: docHeader } } : {}),
        footers: { default: docFooter },
        children,
      },
      ...photoPageSections,
    ],
  });

  return Packer.toBlob(doc);
}
