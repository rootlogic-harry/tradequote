import React, { useRef, useState } from 'react';
import RamsDocument from '../RamsDocument.jsx';
import { updateJobRams } from '../../utils/userDB.js';
import useDragReorder from '../../hooks/useDragReorder.js';
import { buildQuoteFilename } from '../../utils/quoteFilename.js';
import { exportRamsAsDocx } from '../../utils/exportRamsDocx.js';

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

      // TRQ-122: user-friendly filename "{Client} - {Property} - {Postcode}"
      const filename = buildQuoteFilename({
        clientName: rams.client,
        siteAddress: rams.siteAddress,
      });
      pdf.save(`${filename}.pdf`);
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
      const blob = await exportRamsAsDocx({ rams, profile, filteredPhotos });
      // TRQ-122: user-friendly filename "{Client} - {Property} - {Postcode}"
      const filename = `${buildQuoteFilename({
        clientName: rams.client,
        siteAddress: rams.siteAddress,
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
          style={{ minHeight: 44 }}
          className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {generatingPDF ? 'Generating PDF...' : 'Download PDF'}
        </button>
        <button
          onClick={handleDownloadDocx}
          disabled={generatingDocx}
          style={{ minHeight: 44 }}
          className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {generatingDocx ? 'Generating Word...' : 'Download Word'}
        </button>
        {jobId && (
          <button
            onClick={handleSaveRams}
            disabled={saving}
            style={{ minHeight: 44 }}
            className="border border-tq-accent text-tq-accent hover:bg-tq-accent/10 font-heading font-bold uppercase tracking-wide px-6 py-2.5 rounded transition-colors"
          >
            {saving ? 'Saving...' : 'Save RAMS'}
          </button>
        )}
        <button
          onClick={onBackToEditor}
          style={{ minHeight: 44 }}
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
                  {/* Toggle is a small corner indicator overlay; the
                      whole 80\u00d780 card is the primary tap target via
                      the drag handle / browser tap behaviour. Marked
                      touch-exempt so the indicator stays compact. */}
                  <button
                    type="button"
                    onClick={() => togglePhoto(photoIdx)}
                    data-touch-exempt="true"
                    aria-label={isSelected ? 'Deselect photo' : 'Select photo'}
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
      <div className="bg-white shadow-lg overflow-hidden" style={{ borderRadius: 2 }} ref={ramsRef}>
        <RamsDocument rams={ramsForDoc} profile={profile} showPhotos={false} />
      </div>
    </div>
  );
}
