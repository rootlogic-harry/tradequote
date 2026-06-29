import React, { useRef, useState, useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QuoteDocument from '../QuoteDocument.jsx';
import ClientLinkBlock from '../ClientLinkBlock.jsx';
import ProfileGateModal from '../ProfileGateModal.jsx';
import { documentTerm } from '../../utils/documentType.js';
import { downloadBlob } from '../../utils/downloadBlob.js';
import { buildEmlMessage } from '../../utils/buildEmlMessage.js';
import {
  buildPageChromeText,
  buildPdfHeaderHtml,
  buildPdfFooterHtml,
} from '../../utils/quotePageChrome.js';
import { loadAspects } from '../../utils/photoLayout.js';
import { shouldUseShareSheetPath } from '../../utils/platform.js';
import { buildQuoteFilename } from '../../utils/quoteFilename.js';
import ErrorBoundary from '../common/ErrorBoundary.jsx';
import { calculateAllTotals } from '../../utils/calculations.js';
import { saveJob as saveQuote, updateJob } from '../../utils/userDB.js';
import { exportQuoteAsDocx } from '../../utils/exportDocx.js';
import useDragReorder from '../../hooks/useDragReorder.js';

export default function QuoteOutput({ state, dispatch, onBack, isReadOnly, showToast, onCreateRams, onSaved, isAdminPlan = false, onRequestOpenProfile }) {
  // TRQ-94: profile is no longer enforced at sign-up. We block ONLY at
  // the customer-facing surfaces — Send via Outlook, the .eml mailto
  // handler, the generated client portal link, and the PDF/DOCX
  // downloads — because those are the artifacts that need the
  // tradesman's company name, address, and VAT details to look right
  // when the client opens them. Saving + reviewing a quote internally
  // is fine without a profile.
  const profileIncomplete = state.currentUser && state.currentUser.profileComplete === false;
  const [showProfileGate, setShowProfileGate] = useState(false);
  // requireProfile() returns true if the user is good to proceed, false
  // if it raised the gate (caller should bail out). Single source of
  // truth so the wording / behaviour stays consistent across every
  // customer-facing action.
  const requireProfile = () => {
    if (profileIncomplete) {
      setShowProfileGate(true);
      return false;
    }
    return true;
  };
  const quoteRef = useRef(null);
  const { profile, jobDetails, reviewData, photos = {}, extraPhotos = [] } = state;
  const term = documentTerm(profile);

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

  const [generatingDocx, setGeneratingDocx] = useState(false);

  // Small inline spinner for loading button states. Uses `border-current`
  // so it inherits the button's text colour — works on both .btn-primary
  // (white text) and .btn-ghost (accent text) without any extra plumbing.
  const InlineSpinner = () => (
    <span
      aria-hidden="true"
      className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
    />
  );

  // Browser-native print path (Phase 1 fallback). Uses the @media print
  // stylesheet + the hidden .print-root clone of QuoteDocument rendered
  // with showPhotos and selectedPhotos. Works around all the rasterisation
  // failure modes of the html2canvas path: selectable text, Chrome's
  // page-break-inside: avoid honoured on every section.
  const [printing, setPrinting] = useState(false);
  const handlePrint = () => {
    setPrinting(true);
    // afterprint fires whether the user prints or cancels. `once:true`
    // auto-removes the listener. Safety timeout guards against browsers
    // that don't fire afterprint (older mobile Safari).
    const clear = () => setPrinting(false);
    window.addEventListener('afterprint', clear, { once: true });
    setTimeout(clear, 15_000);
    setTimeout(() => window.print(), 50);
  };

  // Server-side PDF (Phase 2 — preferred). Renders the same QuoteDocument
  // markup via renderToStaticMarkup, POSTs it to /api/.../pdf where
  // Puppeteer loads our print.css and returns a native selectable-text PDF.
  //
  // If the server endpoint fails for ANY reason (Chromium didn't start,
  // network blip, rate limit, etc.) we fall back to window.print() — the
  // user always gets a PDF option, no dead-end. The fallback produces the
  // same document because both render paths share public/print.css.
  const [generatingServerPdf, setGeneratingServerPdf] = useState(false);
  // hideCosts=true is the "worker copy" path Mark uses when sending
  // Paul or Jordan to site without him. Same pipeline; QuoteDocument
  // skips the Cost Breakdown + Totals block and reframes the
  // reference line as "Job Details". Filename suffix prevents the
  // unredacted PDF from accidentally going to the customer.
  const handleDownloadPdfServer = async ({ hideCosts = false } = {}) => {
    if (!state.currentUserId) {
      showToast?.(`Save the ${term.lower} first, then download PDF.`, 'error');
      return;
    }
    if (!requireProfile()) return; // TRQ-94 gate
    setGeneratingServerPdf(true);

    const falLbackToPrint = (reason) => {
      console.warn('[PDF] server render failed, falling back to window.print():', reason);
      showToast?.('Opening print dialog…', 'info');
      setTimeout(() => window.print(), 100);
    };

    try {
      // TRQ-177: precompute aspect ratios so QuoteDocument can emit
      // data-orientation per photo. Server render disables JS so the
      // browser side has to attach the aspect before we serialize.
      const photosWithAspect = await loadAspects(filteredPhotos);
      const quoteHtml = renderToStaticMarkup(
        <QuoteDocument state={state} showPhotos selectedPhotos={photosWithAspect} hideCosts={hideCosts} />
      );
      const baseTitle = buildQuoteFilename({
        clientName: jobDetails.clientName,
        siteAddress: jobDetails.siteAddress,
        fallbackLabel: term.title,
      });
      // Suffix the filename in worker-copy mode so a glance at the
      // file name in an email attachment makes it obvious which one
      // it is. Defensive: prevents Mark accidentally sending the
      // un-redacted file to the customer.
      const title = hideCosts ? `${baseTitle} - worker copy` : baseTitle;
      const jobId = savedJobId || state.savedJobId || 'draft';

      // Bound the request so a hung Chromium can't leave the user staring
      // at a spinner forever. AbortController at 45s then fall back.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45_000);

      // Per-page header (date · email · phone) + footer (trading
      // address + VAT) — Mark's reference PDF carries both on every
      // page; passing them lets pdfRenderer turn on Chromium's
      // displayHeaderFooter (TRQ-169).
      const chromeText = buildPageChromeText({ profile, jobDetails });
      const headerHtml = buildPdfHeaderHtml(chromeText);
      const footerHtml = buildPdfFooterHtml(chromeText);

      let res;
      try {
        res = await fetch(`/api/users/${state.currentUserId}/jobs/${jobId}/pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quoteHtml, title, headerHtml, footerHtml }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        let msg = `PDF failed (${res.status})`;
        try { const j = await res.json(); msg = j.error || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      if (blob.size < 500) {
        // A tiny "PDF" is almost certainly an error page the server wrote
        // before Chromium responded. Fall back rather than download garbage.
        throw new Error('Server returned an empty/invalid PDF');
      }
      // TRQ-140: iOS-safe download — uses navigator.share when
      // available so iPad Safari gets the native share sheet instead
      // of silently ignoring the <a download> attribute.
      const result = await downloadBlob(blob, `${title}.pdf`, { mimeType: 'application/pdf' });
      if (!result?.cancelled) {
        showToast?.(result?.shared ? 'PDF ready to share' : 'PDF downloaded', 'success');
      }
    } catch (err) {
      falLbackToPrint(err.message || err);
    } finally {
      setGeneratingServerPdf(false);
    }
  };

  // DOCX body now lives in src/utils/exportDocx.js (TRQ-118). This handler
  // owns the side-effects: spinner flag, file delivery, toast. The pure
  // builder takes structured inputs and returns a Blob; the docx library
  // is dynamically imported inside the builder so the main bundle stays
  // lean.
  const handleDownloadDocx = async () => {
    if (!requireProfile()) return; // TRQ-94 gate
    setGeneratingDocx(true);
    try {
      if (!reviewData) return;
      const { materials, labourEstimate, additionalCosts = [] } = reviewData;
      const labour = {
        days: labourEstimate?.estimatedDays || 0,
        workers: labourEstimate?.numberOfWorkers || 0,
        dayRate: labourEstimate?.dayRate || profile.dayRate,
      };
      const totals = calculateAllTotals(materials, labour, additionalCosts, profile.vatRegistered);

      const blob = await exportQuoteAsDocx({
        jobDetails,
        profile,
        term,
        reviewData,
        totals,
        filteredPhotos,
      });

      // TRQ-122: matching filename format used by the PDF paths
      const filename = `${buildQuoteFilename({
        clientName: jobDetails.clientName,
        siteAddress: jobDetails.siteAddress,
        fallbackLabel: term.title,
      })}.docx`;

      // TRQ-140: iOS-safe download (share sheet on iPad).
      const result = await downloadBlob(blob, filename, {
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      if (!result?.cancelled) {
        showToast?.(result?.shared ? 'Word document ready to share' : 'Word document downloaded', 'success');
      }
    } catch (err) {
      console.error('Word export failed:', err);
      showToast?.('Word export failed. Please try again.', 'error');
    } finally {
      setGeneratingDocx(false);
    }
  };

  const handleEmail = () => {
    if (!requireProfile()) return; // TRQ-94 gate
    const subject = encodeURIComponent(
      `${term.title} ${jobDetails.quoteReference} \u2014 ${jobDetails.siteAddress}`
    );
    // TRQ-122 follow-up: the raw transcript is AI context only, never
    // pasted into customer-facing output (PDF, DOCX, email body).
    const body = encodeURIComponent(
      `Dear ${jobDetails.clientName},\n\nPlease find attached our ${term.lower} (ref: ${jobDetails.quoteReference}) for dry stone walling works at ${jobDetails.siteAddress}.\n\nPlease do not hesitate to contact us should you have any questions.\n\nKind regards,\n${profile.fullName}\n${profile.companyName}\n${profile.phone}`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  // Build a filename-safe version of the subject line for the share
  // sheet. iOS Mail uses the filename as the default subject when the
  // user picks Mail from a Web Share — so this is what Paul's client
  // will see in their inbox.
  const sanitiseFilenameForShare = (s) =>
    String(s)
      .replace(/[/\\?*:|"<>\x00-\x1f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Quote';

  // TRQ-141 — "Send via Outlook". Two paths depending on platform:
  //
  //   Desktop (Windows/macOS/Linux): download a .eml file. Outlook
  //   Desktop / Mail.app / Thunderbird all register message/rfc822
  //   and open it as an editable draft (X-Unsent: 1 wins for Outlook).
  //
  //   iPad/iPhone/Android: share the PDF via Web Share API so the
  //   target mail app (Outlook iOS / Mail) composes a draft with the
  //   PDF attached. Two-tap fallback: if the first tap's fetch takes
  //   too long, iOS voids the user activation and share() rejects
  //   with NotAllowedError. We cache the blob and ask the user to
  //   tap again — that tap brings a fresh activation, share succeeds.
  const [sendingOutlook, setSendingOutlook] = useState(false);
  const [cachedPdfBlob, setCachedPdfBlob] = useState(null);
  const canSendOutlook = Boolean(profile?.email);
  const handleSendViaOutlook = async () => {
    if (!requireProfile()) return; // TRQ-94 gate — block before the email-check toast fires
    if (!canSendOutlook) {
      showToast?.('Add your email address in your profile first.', 'error');
      return;
    }
    if (!state.currentUserId) {
      showToast?.(`Save the ${term.lower} first, then send via Outlook.`, 'error');
      return;
    }
    setSendingOutlook(true);
    try {
      const title = buildQuoteFilename({
        clientName: jobDetails.clientName,
        siteAddress: jobDetails.siteAddress,
        fallbackLabel: term.title,
      });
      const subject = `${term.title} ${jobDetails.quoteReference} \u2014 ${jobDetails.siteAddress}`;
      const body =
        `Dear ${jobDetails.clientName},\n\n` +
        `Please find attached our ${term.lower} (ref: ${jobDetails.quoteReference}) ` +
        `for dry stone walling works at ${jobDetails.siteAddress}.\n\n` +
        `Please do not hesitate to contact us should you have any questions.\n\n` +
        `Kind regards,\n${profile.fullName || ''}\n${profile.companyName || ''}\n${profile.phone || ''}`;

      // 1) Get the PDF — from cache (second tap after NotAllowedError)
      //    or freshly from the server. We only cache AFTER an iPad
      //    activation-expiry rejection, so on any other code path the
      //    "Tap again to send" label never incorrectly appears.
      let pdfBlob = cachedPdfBlob;
      if (!pdfBlob) {
        // TRQ-177: same aspect precompute as handleDownloadPdfServer.
        const photosWithAspect = await loadAspects(filteredPhotos);
        const quoteHtml = renderToStaticMarkup(
          <QuoteDocument state={state} showPhotos selectedPhotos={photosWithAspect} />
        );
        const jobId = savedJobId || state.savedJobId || 'draft';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45_000);
        // Same per-page chrome as the Download PDF path (TRQ-169).
        const chromeText = buildPageChromeText({ profile, jobDetails });
        const headerHtml = buildPdfHeaderHtml(chromeText);
        const footerHtml = buildPdfFooterHtml(chromeText);
        try {
          const res = await fetch(`/api/users/${state.currentUserId}/jobs/${jobId}/pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quoteHtml, title, headerHtml, footerHtml }),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`PDF failed (${res.status})`);
          pdfBlob = await res.blob();
          if (pdfBlob.size < 500) throw new Error('Server returned an empty/invalid PDF');
        } finally {
          clearTimeout(timeoutId);
        }
      }

      // 2a) iPad / iPhone / Android — Web Share API with the PDF. On the
      //     first tap this may reject with NotAllowedError because iOS
      //     voids the user activation after our 5s PDF fetch. We cache
      //     the blob THEN and ask the user to tap once more — that tap's
      //     fresh activation lets share() succeed.
      if (shouldUseShareSheetPath()) {
        const emailFilename = sanitiseFilenameForShare(subject);
        try {
          const pdfFile = new File([pdfBlob], `${emailFilename}.pdf`, {
            type: 'application/pdf',
          });
          if (navigator.canShare?.({ files: [pdfFile] })) {
            await navigator.share({ files: [pdfFile], title: emailFilename });
            // Success — clear any cache from a prior failed attempt.
            setCachedPdfBlob(null);
            showToast?.('Open in Mail (or Outlook) to send with the PDF attached', 'success');
            return;
          }
        } catch (err) {
          if (err?.name === 'AbortError') {
            // User cancelled. Clear cache so the label returns to
            // "Send via Outlook" — no stale "Tap again to send".
            setCachedPdfBlob(null);
            return;
          }
          if (err?.name === 'NotAllowedError') {
            // iOS voided activation during the fetch. Cache the blob
            // here so the NEXT tap (fresh activation) shares immediately.
            setCachedPdfBlob(pdfBlob);
            showToast?.(
              'Your PDF is ready \u2014 tap Send via Outlook once more to open share options',
              'info'
            );
            return;
          }
          throw err;
        }
        // canShare returned false (Safari refused the payload). Blob is
        // not cached — recommending Download PDF is the cleaner escape.
        showToast?.('This browser can\u2019t open a mail draft. Use Download PDF instead.', 'error');
        return;
      }

      // 2b) Desktop path — .eml with the PDF inline. Outlook Desktop /
      //     Mail.app / Thunderbird hand it straight to a draft compose.
      const { text: eml } = await buildEmlMessage({
        from: { name: profile.fullName || profile.companyName || '', email: profile.email },
        to: jobDetails.clientEmail ? [jobDetails.clientEmail] : [],
        subject,
        body,
        date: new Date(),
        attachments: [
          { filename: `${title}.pdf`, contentType: 'application/pdf', data: pdfBlob },
        ],
      });
      const emlBlob = new Blob([eml], { type: 'message/rfc822' });
      const result = await downloadBlob(emlBlob, `${title}.eml`, { mimeType: 'message/rfc822' });
      setCachedPdfBlob(null);
      if (result?.cancelled) return;
      showToast?.(
        result?.shared
          ? 'Opening in your mail app\u2026'
          : 'Draft saved \u2014 open it with Outlook (or Mail/Thunderbird)',
        'success'
      );
    } catch (err) {
      console.error('Send via Outlook failed:', err);
      // Clear cache on any unexpected error — keeping it around would
      // leave the button stuck on "Tap again to send" on desktop where
      // there's no share sheet to retry into.
      setCachedPdfBlob(null);
      showToast?.(err.message || 'Could not prepare the Outlook draft.', 'error');
    } finally {
      setSendingOutlook(false);
    }
  };

  // QuickBooks Online UK — invoice CSV export. File-only; no OAuth.
  // Requires the quote to be saved (need a jobId the server can query).
  const [exportingQb, setExportingQb] = useState(false);
  const [showQbInstructions, setShowQbInstructions] = useState(false);
  const handleExportQuickbooks = async () => {
    if (!state.currentUserId) {
      showToast?.(`Save the ${term.lower} first, then export.`, 'error');
      return;
    }
    const jobId = savedJobId || state.savedJobId;
    if (!jobId) {
      showToast?.(`Save the ${term.lower} first, then export.`, 'error');
      return;
    }
    setExportingQb(true);
    try {
      const res = await fetch(
        `/api/users/${state.currentUserId}/jobs/${jobId}/export/quickbooks-csv`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        let msg = `Export failed (${res.status})`;
        try { const j = await res.json(); msg = j.error || msg; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const safeRef = String(jobDetails.quoteReference || 'quote')
        .replace(/[^a-zA-Z0-9_-]/g, '_');
      const result = await downloadBlob(blob, `fastquote-${safeRef}-quickbooks.csv`, {
        mimeType: 'text/csv',
      });
      if (result?.cancelled) return;
      setShowQbInstructions(true);
    } catch (err) {
      console.error('QuickBooks export failed:', err);
      showToast?.(err.message || 'Could not build the QuickBooks file.', 'error');
    } finally {
      setExportingQb(false);
    }
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
      showToast?.(`${term.title} saved`, 'success');
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
        <h2 className="page-title">
          Your {term.title}
        </h2>
      </div>
      <p className="text-tq-muted text-sm mb-6">
        Review the final document, then download as PDF or Word, or send via email.
      </p>

      {/* PR-2 of 10 (mobile-responsive plan, audit item 2): the
           Step 5 action bar is regrouped into three logical clusters
           (Download / Send / More) so the mobile fold above the quote
           preview is three primary chips instead of 12 wrapping
           buttons. Grouping approved by Harry on 2026-06-26 (Q1).
           Each group carries data-action-group + aria-label so
           screen readers announce the cluster, and the assertions in
           quoteOutputActionBar.test.js can scope to each cluster. */}

      {/* Download — file-export actions the trader keeps locally. */}
      <div
        data-action-group="download"
        role="group"
        aria-label="Download"
        className="flex flex-col fq:flex-row flex-wrap gap-3 mb-3"
      >
        <button
          onClick={handleDownloadPdfServer}
          disabled={generatingServerPdf}
          className="btn-primary disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          title="Crisp PDF with selectable text, rendered server-side by Chromium"
        >
          {generatingServerPdf && <InlineSpinner />}
          {generatingServerPdf ? 'Generating PDF...' : 'Download PDF'}
        </button>
        <button
          onClick={handleDownloadDocx}
          disabled={generatingDocx}
          className="btn-ghost disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {generatingDocx && <InlineSpinner />}
          {generatingDocx ? 'Generating Word...' : 'Download Word'}
        </button>
        <button
          onClick={handlePrint}
          disabled={printing}
          className="btn-ghost disabled:opacity-60 disabled:cursor-not-allowed"
          title="Uses your browser's print dialog — fallback if Download PDF fails"
        >
          {printing && <InlineSpinner />}
          {printing ? 'Preparing preview...' : 'Save via print'}
        </button>
      </div>

      {/* Send — client-facing transmission. buildEmlMessage.js is
           load-bearing (CLAUDE.md Pitfall #15); we only restructure
           the BUTTON wiring, never the .eml builder. */}
      <div
        data-action-group="send"
        role="group"
        aria-label="Send"
        className="flex flex-col fq:flex-row flex-wrap gap-3 mb-3"
      >
        <button onClick={handleEmail} className="btn-ghost">
          Send via Email
        </button>
        <button
          onClick={handleSendViaOutlook}
          disabled={sendingOutlook || !canSendOutlook}
          className="btn-ghost disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          title={
            canSendOutlook
              ? 'Opens Outlook (or your default mail app) with the quote and PDF already attached'
              : 'Add your email address in your profile first'
          }
        >
          {sendingOutlook && <InlineSpinner />}
          {sendingOutlook
            ? 'Preparing email\u2026'
            : cachedPdfBlob
              ? 'Tap again to send'
              : 'Send via Outlook'}
        </button>
      </div>

      {/* More \u2014 admin / occasional / non-primary actions behind a
           native <details> disclosure. Native disclosure gives us
           aria-expanded + keyboard + ESC handling for free; no
           dropdown library needed. Collapsed by default on every
           viewport (no `open` attr) so the mobile fold above the
           quote preview stays clean. Admin-gated items (Worker copy,
           QuickBooks, Create RAMS) stay wrapped in {isAdminPlan &&
           ...} so basic users never see them regardless of whether
           the disclosure is open. */}
      <div
        data-action-group="more"
        role="group"
        aria-label="More"
        className="mb-4"
      >
        <details className="action-group-more">
          <summary
            className="btn-ghost cursor-pointer list-none"
            style={{ width: 'auto' }}
            title="Save, send to QuickBooks, create RAMS, and other extras"
          >
            More
          </summary>
          <div className="flex flex-col fq:flex-row flex-wrap gap-3 mt-3">
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
                {saving ? 'Saving...' : saved ? 'Saved \u2713' : `Save ${term.title}`}
              </button>
            )}
            {/* Worker copy \u2014 admin-only. Same PDF, costs hidden,
                 filename-suffixed. Mark sends this to Paul / Jordan
                 when they do a job without him on site. */}
            {isAdminPlan && (
              <button
                onClick={() => handleDownloadPdfServer({ hideCosts: true })}
                disabled={generatingServerPdf}
                className="btn-ghost disabled:opacity-60 disabled:cursor-not-allowed"
                title="Same PDF with the cost breakdown removed. For sending workers to site without exposing the customer's price."
              >
                {generatingServerPdf && <InlineSpinner />}
                Download worker copy
              </button>
            )}
            {isAdminPlan && (
              <button
                onClick={handleExportQuickbooks}
                disabled={exportingQb || !(savedJobId || state.savedJobId)}
                className="btn-ghost disabled:opacity-60 disabled:cursor-not-allowed"
                title={
                  (savedJobId || state.savedJobId)
                    ? 'Download a CSV you can import into QuickBooks Online'
                    : `Save the ${term.lower} first to enable export`
                }
              >
                {exportingQb && <InlineSpinner />}
                {exportingQb ? 'Building CSV\u2026' : 'Export for QuickBooks'}
              </button>
            )}
            {!isReadOnly && onCreateRams && isAdminPlan && (
              <button
                onClick={() => onCreateRams(savedJobId)}
                disabled={!savedJobId}
                className="btn-ghost disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderColor: 'var(--tq-accent)', color: 'var(--tq-accent)' }}
                title={savedJobId ? 'Create RAMS for this job' : `Save the ${term.lower} first to create a RAMS`}
              >
                Create RAMS
              </button>
            )}
          </div>
        </details>
        {saveError && !saving && (
          <p className="text-xs mt-2" style={{ color: 'var(--tq-error-txt, #f87171)' }}>
            Save failed — your work is preserved in this tab.
          </p>
        )}
      </div>

      {/* Secondary navigation row — these are step-traversal, not
           action-bar actions, so they sit outside the Download/Send/More
           grouping per the Harry-approved brief. Create RAMS moved into
           the More group (admin-only). */}
      <div className="flex flex-col fq:flex-row flex-wrap gap-3 mb-4">
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
        {!isReadOnly && !onBack && (
          <button onClick={handleNewQuote} className="btn-ghost text-sm" style={{ color: 'var(--tq-muted)' }}>
            Start New {term.title}
          </button>
        )}
      </div>

      {/* Client Portal — "Create client link" block (TRQ-131, widened
           in TRQ-139 to render on read-only saved viewers too). The
           portal actions (Copy, Regenerate) are owner-scoped on the
           server and safe to expose either way — the read-only mode
           applies to the quote content (measurements, costs), not
           the portal link management. Only gated on savedJobId so we
           have a row to attach the token to. */}
      {savedJobId && (
        <ClientLinkBlock
          currentUserId={state.currentUserId}
          jobId={savedJobId}
          profile={profile}
          showToast={showToast}
          requireProfile={requireProfile}
        />
      )}

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

      {/* QuickBooks CSV post-download instructions modal. Three short
           steps headline + a "Show full guide" expander on demand —
           avoids a wall-of-text on iPad where a 9-step modal scrolls
           off-screen. VAT line is loud so users don't pick Inclusive by
           accident (the one setting that silently produces wrong totals). */}
      {showQbInstructions && (
        <QbInstructionsModal
          vatRegistered={profile?.vatRegistered === true}
          onClose={() => setShowQbInstructions(false)}
        />
      )}

      {/* Quote Document — showPhotos=false to prevent white band artefact in
           the legacy html2canvas PDF; photos are rendered separately in that
           path's PDF/Word appendix.

           Wrapped in a scoped ErrorBoundary: a crash inside QuoteDocument
           (e.g. a malformed value coming back from a saved snapshot) used
           to take the whole Step 5 down. Now it shows an inline
           "couldn't load — try again" card and the download/share buttons
           above remain usable. */}
      <div className="bg-white shadow-lg overflow-hidden" ref={quoteRef} style={{ borderRadius: 2 }}>
        <ErrorBoundary scope="quote-document">
          <QuoteDocument state={state} showPhotos={false} />
        </ErrorBoundary>
      </div>

      {/* Print-only clone — full quote + photo appendix rendered inline so
           the browser's print engine (native page-break-inside: avoid CSS)
           paginates cleanly. Hidden on screen via `.print-only`. */}
      <div className="print-root print-only" aria-hidden="true">
        <QuoteDocument state={state} showPhotos selectedPhotos={filteredPhotos} />
      </div>

      {/* TRQ-94: Profile gate. Raised by requireProfile() when the user
           tries a customer-facing action (PDF/DOCX download, email,
           Outlook send, client link) before filling in their company
           details. Tapping "Add details" hands off to the existing
           profile modal at App.jsx via onRequestOpenProfile; closing
           that modal flips profile_complete=true and they can retry
           the action. */}
      <ProfileGateModal
        open={showProfileGate}
        term={term}
        onClose={() => setShowProfileGate(false)}
        onOpenProfile={onRequestOpenProfile}
      />
    </div>
  );
}

function QbInstructionsModal({ vatRegistered, onClose }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      role="dialog"
      aria-labelledby="qb-modal-title"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--tq-card, #222018)',
          border: '1px solid var(--tq-border, #3a3630)',
          borderRadius: 12, padding: '24px 24px 20px',
          maxWidth: 520, width: '100%', color: 'var(--tq-text, #f0ede8)',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <h2 id="qb-modal-title" style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
          Your QuickBooks file is ready
        </h2>
        <p style={{ color: 'var(--tq-muted, #7a6f5e)', fontSize: 14, marginBottom: 16 }}>
          Three steps to import it in QuickBooks Online.
        </p>
        <ol style={{ paddingLeft: 20, marginBottom: 16, lineHeight: 1.6 }}>
          <li><strong>Settings ⚙ → Import data → Invoices</strong></li>
          <li>Upload the CSV you just downloaded</li>
          <li>Review the preview, then <strong>Start import</strong></li>
        </ol>

        {/* iPad Safari tip — Paul hit this: he tapped "Save to Notes"
            from the share sheet and Notes stored the content as plain
            text instead of a .csv file. Guide the user to Save to
            Files (which preserves the extension) or AirDrop. */}
        <div style={{
          background: 'rgba(232, 168, 56, 0.12)',
          border: '1px solid rgba(232, 168, 56, 0.4)',
          borderRadius: 8, padding: '10px 12px', marginBottom: 16,
          fontSize: 13, color: 'var(--tq-text, #f0ede8)',
        }}>
          <strong>On iPad/iPhone:</strong> from the share sheet pick{' '}
          <strong>Save to Files</strong> (or AirDrop to your Mac). Avoid{' '}
          <em>Save to Notes</em> — Notes stores the content as plain text,
          not a .csv file.
        </div>

        <div style={{
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: 8, padding: '10px 12px', marginBottom: 16,
          fontSize: 13, color: '#fca5a5',
        }}>
          <strong>Important:</strong> on the mapping screen set{' '}
          <strong>Tax Amount → Exclusive of Tax</strong>. Picking Inclusive
          makes QuickBooks back-calculate tax from the subtotal and the
          figures will be wrong.
        </div>

        {/* CIS conditional guidance. If the trader's QBO account has the
            Construction Industry Scheme module on, QBO marks "Item CIS
            Tax Code" as required on the mapping screen. We don't emit
            that column yet — so the import stalls with no recovery
            hint. Warn up front. */}
        <div style={{
          background: 'var(--tq-card-hover, rgba(255,255,255,0.04))',
          border: '1px solid var(--tq-border, #3a3630)',
          borderRadius: 8, padding: '10px 12px', marginBottom: 16,
          fontSize: 13, color: 'var(--tq-text, #f0ede8)',
        }}>
          <strong>Using CIS?</strong> If the mapping screen shows{' '}
          <em>Item CIS Tax Code</em> marked required, we don't output
          a CIS code yet. Either turn CIS off for this import, or pick
          a code manually from the dropdown.
        </div>
        <div style={{
          fontSize: 12, color: 'var(--tq-muted, #7a6f5e)', marginBottom: 16,
        }}>
          This export uses <strong>{vatRegistered ? '20% VAT' : 'No VAT'}</strong>{' '}
          based on your profile. Change it in Profile if that's wrong, then re-export.
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: 'none', border: 'none',
            color: 'var(--tq-accent, #e8a838)', cursor: 'pointer',
            fontSize: 13, padding: 0, marginBottom: 12,
          }}
        >
          {expanded ? 'Hide full guide' : 'Show full guide'}
        </button>
        {expanded && (
          <ol style={{ paddingLeft: 20, marginBottom: 16, lineHeight: 1.6, fontSize: 13, color: 'var(--tq-muted, #f0ede8)' }}>
            <li>Log in to QuickBooks Online</li>
            <li>Click the ⚙ Settings icon → Import data</li>
            <li>Click <strong>Invoices</strong></li>
            <li>Upload the CSV file you just downloaded</li>
            <li>On the mapping screen:
              <ul style={{ paddingLeft: 18, marginTop: 4 }}>
                <li>Date format: <strong>DD/MM/YYYY</strong></li>
                <li>Tax Amount: <strong>Exclusive of Tax</strong></li>
              </ul>
            </li>
            <li>Review the import preview</li>
            <li>Click <strong>Start import</strong></li>
            <li>Review and send the invoice in QuickBooks</li>
          </ol>
        )}
        <p style={{ fontSize: 12, color: 'var(--tq-muted, #7a6f5e)', marginBottom: 16 }}>
          Note: QuickBooks creates a draft invoice — you can edit anything before
          sending. Imported batches can't be undone; individual invoices have to be
          deleted one at a time.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            className="btn-primary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
