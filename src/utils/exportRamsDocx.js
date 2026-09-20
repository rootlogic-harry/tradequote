/**
 * RAMS Word export — builds the Risk Assessment & Method Statement .docx.
 *
 * Extracted from RamsOutput.jsx (2026-09-20) so it can be run and validated
 * outside React, exactly like exportDocx.js does for the quote. Returns the
 * generated Blob; the caller (RamsOutput) owns toasts, filename and download.
 *
 * Held to the same rules as the quote export (see CLAUDE.md Pitfall #19):
 * typed images with unique docPr ids, XML-safe text, <w:shd> with w:val,
 * real line breaks. Browser-only (Image, atob).
 *
 * @param {object} opts
 * @param {object} opts.rams            RAMS document data
 * @param {object} [opts.profile]       logo, phone, email, fullName
 * @param {Array}  [opts.filteredPhotos] ordered + selected site photos ({ data, label })
 * @returns {Promise<Blob>}
 */
import { getRiskLevel } from './ramsBuilder.js';
import { WORK_TYPE_LABELS } from '../data/ramsConstants.js';
import { COMMON_PPE } from '../data/ramsDefaults.js';
import { decodeImageDataUrl, sanitizeXmlText, createImageIdGenerator, imageAltText } from './docxSafe.js';

export function formatDateSimple(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export async function exportRamsAsDocx({ rams, profile, filteredPhotos = [] }) {
  // Dynamic import keeps the docx library out of the main bundle.
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
          WidthType, AlignmentType, BorderStyle, ImageRun, ShadingType,
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
    // sanitizeXmlText: XML-illegal control characters make Word report the file as corrupt.
    return new TextRun({ text: sanitizeXmlText(text), font: { name: fontName || BODY_FONT }, ...rest });
  };

  const monoTxt = (text, opts = {}) => txt(text, { ...opts, font: MONO_FONT });

  // A raw "\n" inside <w:t> renders as a space in Word; the on-screen RAMS keeps
  // line breaks (whitespace-pre-wrap), so emit one run per line with a real <w:br/>.
  const multilineRuns = (text, opts = {}) =>
    String(text).split('\n').map((line, i) => txt(line, i === 0 ? opts : { ...opts, break: 1 }));

  // One id generator per document: every image's wp:docPr id must be unique
  // document-wide (docx 9.6.1 would otherwise give them all id="1").
  const nextImageId = createImageIdGenerator();

  const sectionHeading = (title) => new Paragraph({
    children: [txt(title, { bold: true, size: 24, color: '333333', font: HEADING_FONT })],
    spacing: { before: 300, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' } },
  });

  const children = [];

  // Logo
  if (profile?.logo) {
    try {
      const { data: logoArray, type: logoType } = decodeImageDataUrl(profile.logo);
      const logoImg = new Image();
      logoImg.src = profile.logo;
      await new Promise(resolve => { logoImg.onload = resolve; logoImg.onerror = resolve; });
      const logoAspect = logoImg.width / logoImg.height;
      let logoW = 200, logoH = logoW / logoAspect;
      if (logoH > 80) { logoH = 80; logoW = logoH * logoAspect; }
      children.push(new Paragraph({
        children: [new ImageRun({
          type: logoType,
          data: logoArray,
          transformation: { width: Math.round(logoW), height: Math.round(logoH) },
          altText: imageAltText(nextImageId, `${rams.company || 'Company'} logo`),
        })],
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
    // w:val is REQUIRED by the schema; fill alone is a validation error on every document.
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F5F5F5' },
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
  if (rams.workTypes?.length > 0) {
    children.push(new Paragraph({
      children: [
        txt('Work types: ', { size: 20, color: '666666' }),
        txt(rams.workTypes.map((wt) => WORK_TYPE_LABELS[wt] || wt).join(', '), { size: 22 }),
      ],
      spacing: { after: 60 },
    }));
  }
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

  if (rams.methodDescription) {
    children.push(
      new Paragraph({
        children: [txt('Additional Method Description', { bold: true, size: 22, color: '444444' })],
        spacing: { before: 160 },
      }),
      new Paragraph({ children: multilineRuns(rams.methodDescription, { size: 22 }), spacing: { after: 120 } }),
    );
  }

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
      children.push(new Paragraph({ children: multilineRuns(content, { size: 22 }), spacing: { after: 200 } }));
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
          const { data: byteArray, type: photoType } = decodeImageDataUrl(photo.data);

          const img = new Image();
          img.src = photo.data;
          await new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });

          const maxW = 576, maxH = 365;
          const aspect = img.width / img.height;
          let drawW = maxW, drawH = drawW / aspect;
          if (drawH > maxH) { drawH = maxH; drawW = drawH * aspect; }

          pageChildren.push(
            new Paragraph({
              children: [new ImageRun({
                    type: photoType,
                    data: byteArray,
                    transformation: { width: Math.round(drawW), height: Math.round(drawH) },
                    altText: imageAltText(nextImageId, photo.label ? `Site photograph: ${photo.label}` : `Site photograph ${i + j + 1}`),
                  })],
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

  return Packer.toBlob(doc);
}
