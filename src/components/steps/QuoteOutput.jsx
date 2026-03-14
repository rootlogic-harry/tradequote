import React, { useRef, useState, useEffect } from 'react';
import QuoteDocument from '../QuoteDocument.jsx';
import { formatCurrency, formatDate, calculateValidUntil } from '../../utils/quoteBuilder.js';
import { calculateAllTotals } from '../../utils/calculations.js';
import { saveQuote } from '../../utils/savedQuotesDB.js';
import useDragReorder from '../../hooks/useDragReorder.js';

export default function QuoteOutput({ state, dispatch, onBack, isReadOnly, showToast }) {
  const quoteRef = useRef(null);
  const { profile, jobDetails, reviewData, photos, extraPhotos = [] } = state;

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

  const handleDownloadPDF = async () => {
    const element = quoteRef.current;
    if (!element) return;

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
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let position = 0;
      let remainingHeight = imgHeight;

      while (remainingHeight > 0) {
        if (position > 0) pdf.addPage();

        pdf.addImage(imgData, 'JPEG', 0, -position, imgWidth, imgHeight);
        position += pageHeight;
        remainingHeight -= pageHeight;
      }

      // Photo appendix pages — 2 photos per page (filtered by selection)
      if (filteredPhotos.length > 0) {
        const margin = 10;
        const usableWidth = pageWidth - margin * 2;
        const maxPhotoHeight = (pageHeight - 50) / 2; // space for 2 photos + labels + header

        for (let i = 0; i < filteredPhotos.length; i += 2) {
          pdf.addPage();

          // Page header
          pdf.setFontSize(10);
          pdf.setTextColor(120, 120, 120);
          pdf.text('Site Photographs — ' + jobDetails.siteAddress, margin, 12);
          pdf.setDrawColor(200, 200, 200);
          pdf.line(margin, 15, pageWidth - margin, 15);

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
            const xPos = margin + (usableWidth - drawWidth) / 2;

            pdf.addImage(photo.data, 'JPEG', xPos, yPos, drawWidth, drawHeight);

            // Caption
            pdf.setFontSize(8);
            pdf.setTextColor(100, 100, 100);
            pdf.text(photo.label + ' — ' + jobDetails.siteAddress, margin, yPos + drawHeight + 5);

            yPos += drawHeight + 15;
          }
        }
      }

      const clientClean = jobDetails.clientName.replace(/[^a-zA-Z0-9]/g, '-');
      pdf.save(`Quote-${jobDetails.quoteReference}-${clientClean}.pdf`);
      showToast?.('PDF downloaded', 'success');
    } catch (err) {
      console.error('PDF generation failed:', err);
      showToast?.('PDF generation failed. Please try again.', 'error');
    }
  };

  const handleDownloadDocx = async () => {
    try {
      const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
              WidthType, AlignmentType, HeadingLevel, BorderStyle, ImageRun,
              PageBreak, convertInchesToTwip, SectionType } = await import('docx');

      if (!reviewData) return;

      const { damageDescription, measurements, scheduleOfWorks, materials,
              labourEstimate, additionalCosts = [] } = reviewData;

      const labour = {
        days: labourEstimate?.estimatedDays || 0,
        workers: labourEstimate?.numberOfWorkers || 0,
        dayRate: labourEstimate?.dayRate || profile.dayRate,
      };
      const totals = calculateAllTotals(materials, labour, additionalCosts, profile.vatRegistered);
      const validUntil = calculateValidUntil(jobDetails.quoteDate);

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

      // Table column widths in twips (A4 usable width ~9360 twips = 6.5in)
      const COL_DESC = 3500;  // ~37%
      const COL_QTY = 1100;   // ~12%
      const COL_UNIT_COL = 1060; // ~11%
      const COL_RATE = 1800;  // ~19%
      const COL_TOTAL = 1900; // ~20%

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
      children.push(
        new Paragraph({
          children: [txt(profile.companyName, { bold: true, size: 36, color: '1a1a1a', font: HEADING_FONT })],
          spacing: { after: 40 },
        }),
        new Paragraph({
          children: [txt('Dry Stone Walling', { size: 20, color: '888888' })],
        }),
      );

      if (profile.accreditations) {
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

      // Description of Damage
      children.push(
        new Paragraph({
          children: [txt('DESCRIPTION OF DAMAGE', { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
          spacing: { before: 300, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } },
        }),
        new Paragraph({
          children: [txt(damageDescription || '', { size: 22 })],
          spacing: { after: 300 },
        }),
      );

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

      // Material rows
      materials.forEach(mat => {
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

      // Labour row
      const labourDesc = labourEstimate?.description || `${labour.days} days \u00D7 ${labour.workers} workers`;
      tableRows.push(
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [txt(`Labour \u2014 ${labourDesc}`, { size: 22 })] })],
              borders: lightBorder,
              width: { size: COL_DESC, type: WidthType.DXA },
              columnSpan: 3,
            }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(`${formatCurrency(labour.dayRate)}/day`, { size: 22 })] })],
              borders: lightBorder,
              width: { size: COL_RATE, type: WidthType.DXA },
            }),
            new TableCell({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [monoTxt(formatCurrency(totals.labourTotal), { size: 22 })] })],
              borders: lightBorder,
              width: { size: COL_TOTAL, type: WidthType.DXA },
            }),
          ],
        })
      );

      // Additional costs
      additionalCosts.forEach(cost => {
        tableRows.push(
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [txt(cost.label, { size: 22 })] })],
                borders: lightBorder,
                width: { size: COL_DESC, type: WidthType.DXA },
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
          width: { size: 9360, type: WidthType.DXA },
        })
      );

      // Totals
      children.push(new Paragraph({ spacing: { before: 300 }, children: [] }));

      children.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            txt('Subtotal (ex VAT):   ', { size: 22, color: '666666' }),
            monoTxt(formatCurrency(totals.subtotal), { size: 22, bold: true }),
          ],
        })
      );

      if (profile.vatRegistered) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              txt('VAT (20%):   ', { size: 22, color: '666666' }),
              monoTxt(formatCurrency(totals.vatAmount), { size: 22, bold: true }),
            ],
          })
        );
      }

      children.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            txt('TOTAL:   ', { size: 32, bold: true, font: HEADING_FONT }),
            monoTxt(formatCurrency(totals.total), { size: 32, bold: true }),
          ],
          spacing: { before: 120, after: 400 },
          border: { top: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' } },
        })
      );

      // Notes & Conditions
      const defaultNotes = [
        'This costing is based on visible damage as observed during site inspection. Should additional damage be found upon dismantling, a supplementary cost will be agreed in writing before proceeding.',
        'All works to be carried out using traditional lime mortar techniques compatible with the existing construction. No cement-based mortars will be used.',
        'The client is responsible for confirming whether Listed Building Consent or other consents are required prior to commencement of works.',
        'This quotation is valid for 30 days from the date of issue.',
        'Payment terms: 50% deposit upon instruction, balance on satisfactory completion.',
      ];
      const notes = reviewData.notes && reviewData.notes.length > 0 ? reviewData.notes : defaultNotes;

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

      // Footer
      children.push(
        new Paragraph({
          children: [txt(`This quote is valid for 30 days from the date issued (until ${formatDate(validUntil)}).`, { size: 20, color: '888888' })],
          spacing: { before: 300 },
          border: { top: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' } },
        })
      );

      if (profile.vatRegistered && profile.vatNumber) {
        children.push(new Paragraph({
          children: [txt(`VAT No: ${profile.vatNumber}`, { size: 20, color: '888888' })],
        }));
      }

      children.push(
        new Paragraph({
          children: [txt(`${profile.fullName} \u2014 ${profile.accreditations || ''}`, { size: 20, color: '888888' })],
        }),
        new Paragraph({
          children: [txt(`Quote prepared with AI assistance \u2014 all figures reviewed and confirmed by ${profile.fullName}.`, { size: 20, italics: true, color: '888888' })],
          spacing: { after: 200 },
        }),
      );

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
            children,
          },
          ...photoPageSections,
        ],
      });

      const blob = await Packer.toBlob(doc);
      const clientClean = jobDetails.clientName.replace(/[^a-zA-Z0-9]/g, '-');
      const filename = `Quote-${jobDetails.quoteReference}-${clientClean}.docx`;

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
    }
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(
      `Quote ${jobDetails.quoteReference} \u2014 ${jobDetails.siteAddress}`
    );
    const body = encodeURIComponent(
      `Dear ${jobDetails.clientName},\n\nPlease find attached our quote (ref: ${jobDetails.quoteReference}) for dry stone walling works at ${jobDetails.siteAddress}.\n\nThis quote is valid for 30 days from the date issued.\n\nPlease do not hesitate to contact us should you have any questions.\n\nKind regards,\n${profile.fullName}\n${profile.companyName}\n${profile.phone}`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const handleNewQuote = () => {
    dispatch({ type: 'NEW_QUOTE' });
  };

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveQuote(state);
      setSaved(true);
      showToast?.('Quote saved', 'success');
    } catch (err) {
      console.error('Failed to save quote:', err);
      setSaveError('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-heading font-bold text-tq-accent mb-1">
        Your Quote
      </h2>
      <p className="text-tq-muted text-sm mb-6">
        Review the final document, then download as PDF or Word, or send via email.
      </p>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          onClick={handleDownloadPDF}
          className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors"
        >
          Download PDF
        </button>
        <button
          onClick={handleDownloadDocx}
          className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors"
        >
          Download Word
        </button>
        <button
          onClick={handleEmail}
          className="border border-tq-accent text-tq-accent hover:bg-tq-accent/10 font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors"
        >
          Send via Email
        </button>
        {!isReadOnly && (
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className={`border font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors ${
              saved
                ? 'border-tq-confirmed text-tq-confirmed'
                : saveError
                  ? 'border-red-500 text-red-400'
                  : 'border-tq-accent text-tq-accent hover:bg-tq-accent/10'
            }`}
          >
            {saving ? 'Saving...' : saved ? 'Saved \u2713' : saveError || 'Save Quote'}
          </button>
        )}
        {onBack ? (
          <button
            onClick={onBack}
            className="border border-tq-border text-tq-text hover:bg-tq-card font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors"
          >
            Back to Saved Quotes
          </button>
        ) : !isReadOnly && (
          <button
            onClick={handleNewQuote}
            className="border border-tq-border text-tq-text hover:bg-tq-card font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors"
          >
            Start New Quote
          </button>
        )}
      </div>

      <p className="text-tq-muted text-xs mb-6">
        Note: When sending via email, attach your downloaded PDF or Word document before sending.
      </p>

      {/* Photo selection & reorder grid */}
      {allPhotos.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-heading font-bold text-tq-text mb-3 uppercase tracking-wide">
            Photos to Include ({filteredPhotos.length}/{allPhotos.length})
            <span className="font-normal text-tq-muted ml-2 normal-case tracking-normal">
              Drag to reorder
            </span>
          </h3>
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
                  className={`relative rounded border-2 transition-all ${
                    isDropTarget
                      ? 'border-tq-accent ring-2 ring-tq-accent/50'
                      : isSelected
                        ? 'border-tq-confirmed ring-1 ring-tq-confirmed/40'
                        : 'border-tq-border opacity-50 grayscale'
                  } ${isDragged ? 'opacity-50 scale-105' : ''}`}
                >
                  {/* Drag handle — 6-dot grip icon, top-left */}
                  <span
                    {...getDragHandleProps(orderPos)}
                    className="absolute top-1 left-1 z-10 w-5 h-5 flex items-center justify-center rounded bg-black/40 text-white text-[10px] cursor-grab hover:bg-black/60 md:opacity-0 md:group-hover:opacity-100"
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

      {/* Quote Document — showPhotos=false to prevent white band artefact in PDF;
           photos are rendered separately in the PDF/Word appendix */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden" ref={quoteRef}>
        <QuoteDocument state={state} showPhotos={false} />
      </div>
    </div>
  );
}
