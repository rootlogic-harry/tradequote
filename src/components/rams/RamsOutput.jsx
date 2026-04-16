import React, { useRef, useState } from 'react';
import RamsDocument from '../RamsDocument.jsx';
import { getRiskLevel } from '../../utils/ramsBuilder.js';
import { WORK_TYPE_LABELS } from '../../data/ramsConstants.js';
import { COMMON_PPE } from '../../data/ramsDefaults.js';
import { updateJobRams } from '../../utils/userDB.js';
import useDragReorder from '../../hooks/useDragReorder.js';

function formatDateSimple(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function RamsOutput({ rams, profile, dispatch, showToast, onBackToEditor, jobId, currentUserId }) {
  const ramsRef = useRef(null);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [generatingDocx, setGeneratingDocx] = useState(false);

  // Photo selection & reorder
  const allPhotos = rams.photos || [];
  const [photoOrder, setPhotoOrder] = useState(() => allPhotos.map((_, i) => i));
  const [selectedPhotoIndices, setSelectedPhotoIndices] = useState(() => new Set(allPhotos.map((_, i) => i)));

  const togglePhoto = (index) => {
    setSelectedPhotoIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const filteredPhotos = photoOrder
    .filter(i => selectedPhotoIndices.has(i))
    .map(i => allPhotos[i]);

  const { dragState, getItemProps, getDragHandleProps } = useDragReorder({
    items: photoOrder,
    onReorder: setPhotoOrder,
  });

  // Build a RAMS copy with filtered/reordered photos for the document
  const ramsForDoc = { ...rams, photos: filteredPhotos };

  const handleDownloadPDF = async () => {
    const element = ramsRef.current;
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

      // Photo appendix pages
      if (filteredPhotos.length > 0) {
        const margin = 10;
        const usableWidth = pageWidth - margin * 2;
        const maxPhotoHeight = (pageHeight - 50) / 2;

        for (let i = 0; i < filteredPhotos.length; i += 2) {
          pdf.addPage();
          pdf.setFontSize(10);
          pdf.setTextColor(120, 120, 120);
          pdf.text('Site Photographs \u2014 ' + rams.siteAddress, margin, 12);
          pdf.setDrawColor(200, 200, 200);
          pdf.line(margin, 15, pageWidth - margin, 15);

          let yPos = 22;
          for (let j = 0; j < 2 && i + j < filteredPhotos.length; j++) {
            const photo = filteredPhotos[i + j];
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

            const xPos = margin + (usableWidth - drawWidth) / 2;
            pdf.addImage(photo.data, 'JPEG', xPos, yPos, drawWidth, drawHeight);
            pdf.setFontSize(8);
            pdf.setTextColor(100, 100, 100);
            pdf.text(photo.label + ' \u2014 ' + rams.siteAddress, margin, yPos + drawHeight + 5);
            yPos += drawHeight + 15;
          }
        }
      }

      const clientClean = (rams.client || 'RAMS').replace(/[^a-zA-Z0-9]/g, '-');
      pdf.save(`RAMS-${rams.jobNumber}-${clientClean}.pdf`);
      showToast?.('PDF downloaded', 'success');
    } catch (err) {
      console.error('RAMS PDF generation failed:', err);
      showToast?.('PDF generation failed. Please try again.', 'error');
    } finally {
      setGeneratingPDF(false);
    }
  };

  const handleDownloadDocx = async () => {
    setGeneratingDocx(true);
    try {
      const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
              WidthType, AlignmentType, BorderStyle, ImageRun,
              SectionType, convertInchesToTwip } = await import('docx');

      const BODY_FONT = 'Calibri';
      const HEADING_FONT = 'Calibri';
      const MONO_FONT = 'Courier New';

      const lightBorder = {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        left: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' },
      };

      const txt = (text, opts = {}) => {
        const { font: fontName, ...rest } = opts;
        return new TextRun({ text, font: { name: fontName || BODY_FONT }, ...rest });
      };

      const monoTxt = (text, opts = {}) => txt(text, { ...opts, font: MONO_FONT });

      const sectionHeading = (title) => new Paragraph({
        children: [txt(title, { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
        spacing: { before: 300, after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } },
      });

      const children = [];

      // Logo
      if (profile?.logo) {
        try {
          const logoBase64 = profile.logo.split(',')[1];
          const logoBytes = atob(logoBase64);
          const logoArray = new Uint8Array(logoBytes.length);
          for (let k = 0; k < logoBytes.length; k++) logoArray[k] = logoBytes.charCodeAt(k);
          const logoImg = new Image();
          logoImg.src = profile.logo;
          await new Promise(resolve => { logoImg.onload = resolve; logoImg.onerror = resolve; });
          const logoAspect = logoImg.width / logoImg.height;
          let logoW = 200, logoH = logoW / logoAspect;
          if (logoH > 80) { logoH = 80; logoW = logoH * logoAspect; }
          children.push(new Paragraph({
            children: [new ImageRun({ data: logoArray, transformation: { width: Math.round(logoW), height: Math.round(logoH) } })],
            spacing: { after: 100 },
          }));
        } catch (e) { console.warn('Logo failed:', e); }
      }

      // Header
      children.push(
        new Paragraph({ children: [txt(rams.company || '', { bold: true, size: 36, font: HEADING_FONT })], spacing: { after: 40 } }),
        new Paragraph({ children: [txt('RISK ASSESSMENT & METHOD STATEMENT', { bold: true, size: 28, color: '444444', font: HEADING_FONT })], spacing: { after: 40 } }),
        new Paragraph({
          children: [txt(`${formatDateSimple(rams.documentDate)}  |  ${profile?.phone || ''}  |  ${profile?.email || ''}`, { size: 20, color: '666666' })],
          spacing: { after: 300 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' } },
        }),
      );

      // Reference
      children.push(new Paragraph({
        shading: { fill: 'F5F5F5' },
        children: [txt(`Job ref: ${rams.jobNumber} \u2014 ${rams.client}, ${rams.siteAddress}`, { size: 22, bold: true })],
        spacing: { before: 300, after: 400 },
      }));

      // Job Details
      children.push(sectionHeading('JOB DETAILS'));
      [
        ['Site Address', rams.siteAddress],
        ['Client', rams.client],
        ['Foreman', rams.foreman],
        ['Commencement', formatDateSimple(rams.commencementDate)],
        ['Completion', formatDateSimple(rams.projectedCompletionDate)],
      ].forEach(([label, value]) => {
        children.push(new Paragraph({
          children: [txt(`${label}: `, { size: 22, color: '666666' }), txt(value || '\u2014', { size: 22, bold: true })],
          spacing: { after: 40 },
        }));
      });

      // Work Stages
      children.push(sectionHeading('SCOPE OF WORKS & METHOD STATEMENT'));
      const groupedStages = {};
      (rams.workStages || []).forEach(s => {
        const key = s.type || 'custom';
        if (!groupedStages[key]) groupedStages[key] = [];
        groupedStages[key].push(s.stage);
      });
      Object.entries(groupedStages).forEach(([type, stages]) => {
        children.push(new Paragraph({
          children: [txt(WORK_TYPE_LABELS[type] || 'Custom', { bold: true, size: 22, color: '444444' })],
          spacing: { before: 120 },
        }));
        stages.forEach((s, i) => {
          children.push(new Paragraph({
            children: [txt(`${i + 1}. ${s}`, { size: 22 })],
            indent: { left: convertInchesToTwip(0.3) },
            spacing: { after: 40 },
          }));
        });
      });

      // Risk Assessments
      children.push(sectionHeading('RISK ASSESSMENT'));
      (rams.riskAssessments || []).forEach(ra => {
        const level = getRiskLevel(ra.riskRating);
        children.push(
          new Paragraph({
            children: [
              txt(ra.task, { bold: true, size: 22 }),
              txt(` \u2014 Risk Rating: ${ra.riskRating} (${level.label})`, { size: 20, color: '666666' }),
            ],
            spacing: { before: 160 },
          }),
          new Paragraph({ children: [txt(`Hazard: ${ra.hazardDescription}`, { size: 20 })], indent: { left: convertInchesToTwip(0.3) }, spacing: { after: 20 } }),
          new Paragraph({ children: [txt(`Who: ${ra.whoMightBeHarmed}`, { size: 20 })], indent: { left: convertInchesToTwip(0.3) }, spacing: { after: 20 } }),
          new Paragraph({ children: [txt(`Controls: ${(ra.existingControls || []).join(', ')}`, { size: 20 })], indent: { left: convertInchesToTwip(0.3) }, spacing: { after: 20 } }),
          new Paragraph({
            children: [monoTxt(`L:${ra.likelihood} x C:${ra.consequence} = ${ra.riskRating}`, { size: 20 })],
            indent: { left: convertInchesToTwip(0.3) },
            spacing: { after: 20 },
          }),
        );
        if (ra.furtherActionRequired) {
          children.push(new Paragraph({
            children: [txt(`Further Action: ${ra.furtherActionRequired}`, { size: 20, italics: true })],
            indent: { left: convertInchesToTwip(0.3) },
            spacing: { after: 40 },
          }));
        }
      });

      // Site Details sections
      const textSections = [
        ['WORKPLACE ACCESS', rams.workplaceAccess],
        ['WORKPLACE LIGHTING', rams.workplaceLighting],
        ['HAZARDOUS MATERIALS', rams.hazardousMaterials],
        ['WASTE MANAGEMENT', rams.wasteManagement],
        ['SPECIAL CONTROL MEASURES', rams.specialControlMeasures],
      ];
      textSections.forEach(([title, content]) => {
        if (content) {
          children.push(sectionHeading(title));
          children.push(new Paragraph({ children: [txt(content, { size: 22 })], spacing: { after: 200 } }));
        }
      });

      // PPE
      const ppeLabels = COMMON_PPE.filter(p => (rams.ppeRequirements || []).includes(p.id));
      if (ppeLabels.length > 0) {
        children.push(sectionHeading('PPE REQUIREMENTS'));
        children.push(new Paragraph({
          children: [txt(ppeLabels.map(p => p.label).join(', '), { size: 22 })],
          spacing: { after: 200 },
        }));
      }

      // Communication
      children.push(sectionHeading('COMMUNICATION'));
      if (rams.employeesOnJob?.length > 0) {
        children.push(new Paragraph({
          children: [txt('Employees on job: ', { size: 20, color: '666666' }), txt(rams.employeesOnJob.join(', '), { size: 22 })],
          spacing: { after: 40 },
        }));
      }
      if (rams.communicatedEmployees?.length > 0) {
        children.push(new Paragraph({
          children: [txt('RAMS communicated to: ', { size: 20, color: '666666' }), txt(rams.communicatedEmployees.join(', '), { size: 22 })],
          spacing: { after: 40 },
        }));
      }

      // Contact
      children.push(sectionHeading('EMERGENCY CONTACT'));
      children.push(new Paragraph({
        children: [txt(`${rams.contactTitle || 'Site Contact'}: ${rams.contactName || ''} \u2014 ${rams.contactNumber || ''}`, { size: 22 })],
        spacing: { after: 40 },
      }));
      children.push(new Paragraph({
        children: [txt('Emergency Services: ', { size: 20, color: '666666' }), monoTxt('999', { size: 22, bold: true })],
        spacing: { after: 200 },
      }));

      // Footer
      children.push(new Paragraph({
        children: [txt('This RAMS must be reviewed and briefed to all site operatives before work commences.', { size: 20, color: '888888' })],
        spacing: { before: 300 },
        border: { top: { style: BorderStyle.SINGLE, size: 2, color: 'CCCCCC' } },
      }));
      children.push(new Paragraph({
        children: [txt(`Document prepared with FastQuote \u2014 reviewed and approved by ${rams.foreman || profile?.fullName || ''}.`, { size: 20, italics: true, color: '888888' })],
        spacing: { after: 200 },
      }));

      // Photo appendix
      const photoPageSections = [];
      if (filteredPhotos.length > 0) {
        for (let i = 0; i < filteredPhotos.length; i += 2) {
          const pageChildren = [];
          pageChildren.push(new Paragraph({
            children: [txt('SITE PHOTOGRAPHS', { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
            spacing: { after: 200 },
          }));

          for (let j = 0; j < 2 && i + j < filteredPhotos.length; j++) {
            const photo = filteredPhotos[i + j];
            try {
              const base64Data = photo.data.split(',')[1];
              const byteChars = atob(base64Data);
              const byteArray = new Uint8Array(byteChars.length);
              for (let k = 0; k < byteChars.length; k++) byteArray[k] = byteChars.charCodeAt(k);

              const img = new Image();
              img.src = photo.data;
              await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });

              const maxW = 576, maxH = 365;
              const aspect = img.width / img.height;
              let drawW = maxW, drawH = drawW / aspect;
              if (drawH > maxH) { drawH = maxH; drawW = drawH * aspect; }

              pageChildren.push(
                new Paragraph({
                  children: [new ImageRun({ data: byteArray, transformation: { width: Math.round(drawW), height: Math.round(drawH) } })],
                  spacing: { before: 100, after: 40 },
                }),
                new Paragraph({
                  children: [txt(`${photo.label} \u2014 ${rams.siteAddress}`, { size: 18, color: '888888', italics: true })],
                  spacing: { after: 200 },
                }),
              );
            } catch (e) { console.warn('Photo failed:', photo.label, e); }
          }

          photoPageSections.push({ properties: { type: SectionType.NEXT_PAGE }, children: pageChildren });
        }
      }

      const doc = new Document({
        styles: { default: { document: { run: { font: { name: BODY_FONT }, size: 22 } } } },
        sections: [
          {
            properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1), right: convertInchesToTwip(1) } } },
            children,
          },
          ...photoPageSections,
        ],
      });

      const blob = await Packer.toBlob(doc);
      const clientClean = (rams.client || 'RAMS').replace(/[^a-zA-Z0-9]/g, '-');
      const filename = `RAMS-${rams.jobNumber}-${clientClean}.docx`;
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
      console.error('RAMS Word export failed:', err);
      showToast?.('Word export failed. Please try again.', 'error');
    } finally {
      setGeneratingDocx(false);
    }
  };

  const [saving, setSaving] = useState(false);

  const handleSaveRams = async () => {
    if (!jobId) {
      showToast?.('Save the quote first to link this RAMS', 'error');
      return;
    }
    setSaving(true);
    try {
      await updateJobRams(currentUserId, jobId, rams);
      showToast?.('RAMS saved', 'success');
    } catch (err) {
      console.error('Failed to save RAMS:', err);
      showToast?.('Failed to save RAMS', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-heading font-bold text-tq-accent mb-1">
        RAMS Preview
      </h2>
      <p className="text-tq-muted text-sm mb-6">
        Review your Risk Assessment &amp; Method Statement, then download as PDF or Word.
      </p>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          onClick={handleDownloadPDF}
          disabled={generatingPDF}
          className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {generatingPDF ? 'Generating PDF...' : 'Download PDF'}
        </button>
        <button
          onClick={handleDownloadDocx}
          disabled={generatingDocx}
          className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {generatingDocx ? 'Generating Word...' : 'Download Word'}
        </button>
        {jobId && (
          <button
            onClick={handleSaveRams}
            disabled={saving}
            className="border border-tq-accent text-tq-accent hover:bg-tq-accent/10 font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors"
          >
            {saving ? 'Saving...' : 'Save RAMS'}
          </button>
        )}
        <button
          onClick={onBackToEditor}
          className="border border-tq-border text-tq-text hover:bg-tq-card font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors"
        >
          Back to Editor
        </button>
      </div>

      {/* Photo selection grid */}
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
                  <span
                    {...getDragHandleProps(orderPos)}
                    className="absolute top-1 left-1 z-10 w-5 h-5 flex items-center justify-center rounded bg-black/40 text-white text-[10px] cursor-grab hover:bg-black/60"
                    style={{ touchAction: 'none' }}
                    title="Drag to reorder"
                  >
                    &#10303;
                  </span>
                  <img src={photo.data} alt={photo.label} className="w-20 h-20 object-cover rounded" />
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5 rounded-b">
                    {photo.label}
                  </span>
                  <button
                    onClick={() => togglePhoto(photoIdx)}
                    className={`absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold z-10 ${
                      isSelected ? 'bg-tq-confirmed text-white' : 'bg-tq-card text-tq-muted border border-tq-border'
                    }`}
                  >
                    {isSelected ? '\u2713' : ''}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* RAMS Document preview */}
      <div className="bg-white rounded-lg shadow-lg overflow-hidden" ref={ramsRef}>
        <RamsDocument rams={ramsForDoc} profile={profile} showPhotos={false} />
      </div>
    </div>
  );
}
