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
import { saveJob as saveQuote, updateJob, getClientStatus, generateClientToken, updateJobStatus } from '../../utils/userDB.js';
import { exportQuoteAsDocx } from '../../utils/exportDocx.js';
import useDragReorder from '../../hooks/useDragReorder.js';
import { trackEvent } from '../../utils/trackEvent.js';
import { calculateExpiresAt } from '../../utils/quoteBuilder.js';

export default function QuoteOutput({ state, dispatch, onBack, isReadOnly, showToast, onCreateRams, onSaved, isAdminPlan = false, onRequestOpenProfile, emailIntegrationEnabled = false }) {
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
    // Analytics Phase 1 — fire pdf_downloaded on click intent (not on
    // server success) so the funnel captures the user action even if
    // the server PDF path fails and we fall back to window.print().
    // `hideCosts` distinguishes the worker-copy variant.
    trackEvent('pdf_downloaded', { hideCosts: !!hideCosts });
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
      `${term.title} ${jobDetails.quoteReference} — ${jobDetails.siteAddress}`
    );
    // TRQ-122 follow-up: the raw transcript is AI context only, never
    // pasted into customer-facing output (PDF, DOCX, email body).
    const body = encodeURIComponent(
      `Dear ${jobDetails.clientName},\n\nPlease find attached our ${term.lower} (ref: ${jobDetails.quoteReference}) for walling works at ${jobDetails.siteAddress}.\n\nPlease do not hesitate to contact us should you have any questions.\n\nKind regards,\n${profile.fullName}\n${profile.companyName}\n${profile.phone}`
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
      const subject = `${term.title} ${jobDetails.quoteReference} — ${jobDetails.siteAddress}`;
      const body =
        `Dear ${jobDetails.clientName},\n\n` +
        `Please find attached our ${term.lower} (ref: ${jobDetails.quoteReference}) ` +
        `for walling works at ${jobDetails.siteAddress}.\n\n` +
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
              'Your PDF is ready — tap Send via Outlook once more to open share options',
              'info'
            );
            return;
          }
          throw err;
        }
        // canShare returned false (Safari refused the payload). Blob is
        // not cached — recommending Download PDF is the cleaner escape.
        showToast?.('This browser can’t open a mail draft. Use Download PDF instead.', 'error');
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
          ? 'Opening in your mail app…'
          : 'Draft saved — open it with Outlook (or Mail/Thunderbird)',
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

  // ──────────────────────────────────────────────────────────────────
  // Quote Screen Redesign (2026-06-29) — see
  // /tmp/fastquote-quote-handoff/design_handoff_dashboard/FastQuote Quote Screen Spec.md
  //
  // Replaces the PR #73 Download / Send / More 6-button layout with:
  //   • One state-aware status banner (draft / sent / viewed / accepted / declined)
  //   • Primary split: "Send to client" → Email / Outlook / Copy link
  //   • Secondary split: "Download PDF" → PDF / Word / Print
  //   • Tertiary ghost link: "Edit & re-generate"
  //   • Hero client-link card (promoted from buried bottom block)
  //   • Slim "Full quote document" preview strip at the bottom
  //
  // Live status pulled from the existing /client-status endpoint — no
  // schema change. Status banner re-renders whenever the saved jobId
  // surfaces a token or response transition.
  // ──────────────────────────────────────────────────────────────────

  const [clientStatus, setClientStatus] = useState(null);
  // Pull the live portal status to drive the status banner + Copy-link
  // split-button menu item. Fails silently — the banner just degrades
  // to the draft state.
  useEffect(() => {
    const jobId = savedJobId || state.savedJobId;
    if (!state.currentUserId || !jobId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getClientStatus(state.currentUserId, jobId);
        if (!cancelled) setClientStatus(s);
      } catch {
        // No-op — the hero card and banner will reflect the default
        // "draft" state when the API is unreachable.
      }
    })();
    return () => { cancelled = true; };
  }, [state.currentUserId, savedJobId, state.savedJobId]);

  // Derive the status banner state. Order is load-bearing:
  // declined > accepted > viewed > sent > draft.
  const statusBannerKind = (() => {
    if (!clientStatus || !clientStatus.hasToken) return 'draft';
    if (clientStatus.response === 'declined') return 'declined';
    if (clientStatus.response === 'accepted') return 'accepted';
    if (clientStatus.viewed) return 'viewed';
    return 'sent';
  })();

  // Banner copy — kept small and useful, no marketing fluff.
  const statusBannerCopy = (() => {
    switch (statusBannerKind) {
      case 'declined':
        return {
          title: 'Declined',
          sub: clientStatus?.declineReason
            ? `${jobDetails.clientName || 'The client'} declined — ${clientStatus.declineReason}`
            : `${jobDetails.clientName || 'The client'} declined this quote.`,
        };
      case 'accepted':
        return {
          title: 'Accepted by the client',
          sub: `${jobDetails.clientName || 'The client'} accepted this quote — you're good to start the job.`,
        };
      case 'viewed':
        return {
          title: 'Viewed · awaiting reply',
          sub: 'Your client opened the link. Waiting on Accept or Decline.',
        };
      case 'sent':
        return {
          title: 'Sent · awaiting reply',
          sub: 'Link sent — waiting for your client to open it.',
        };
      default:
        return {
          title: 'Not sent yet',
          sub: 'Send the link to your client when you’re ready.',
        };
    }
  })();

  // Copy-client-link handler used by the primary split-button menu.
  // If the quote already has a token we copy directly; otherwise we
  // generate one first, then copy. Uses navigator.clipboard with a
  // brief confirmation toast on success.
  const handleCopyClientLink = async () => {
    if (!requireProfile()) return;
    const jobId = savedJobId || state.savedJobId;
    if (!state.currentUserId || !jobId) {
      showToast?.(`Save the ${term.lower} first, then copy the link.`, 'error');
      return;
    }
    try {
      let url = clientStatus?.url;
      if (!url || !clientStatus?.hasToken) {
        const fresh = await generateClientToken(state.currentUserId, jobId);
        url = fresh?.url;
        // Refresh the local copy so the hero card + banner pick up
        // the new token without a second round-trip.
        try {
          const refreshed = await getClientStatus(state.currentUserId, jobId);
          setClientStatus(refreshed);
        } catch {}
      }
      if (!url) throw new Error('No link to copy');
      await navigator.clipboard.writeText(url);
      showToast?.('Link copied — paste into WhatsApp or email', 'success');
    } catch (err) {
      console.error('Copy client link failed:', err);
      showToast?.(err.message || 'Could not copy link', 'error');
    }
  };

  // ──────────────────────────────────────────────────────────────────
  // Send to client = status action (2026-06-29 UX call from Harry's
  // screenshot review).
  //
  // Reality check: most wallers don't have Outlook configured, mobile
  // users have no Outlook flow at all, and the .eml file path is
  // brittle. The waller's actual workflow is: copy the client link →
  // paste into WhatsApp / SMS / their own email → done. They want a
  // button that RECORDS that they sent it, not one that pretends to
  // send for them.
  //
  // The primary "Send to client" button now advances the job's status
  // draft → sent (via the existing /api/users/:id/jobs/:jobId/status
  // route — same path the dashboard's Send button uses, no new
  // endpoint). After click it locks into a green "Sent to client"
  // confirmation state.
  //
  // The caret menu carries the contextual status actions (Mark
  // accepted / declined / complete / Re-open) + Copy link, plus the
  // Email and Outlook entry points when EMAIL_INTEGRATION_ENABLED is
  // on. See docs/EMAIL_FLAG.md.
  // ──────────────────────────────────────────────────────────────────

  // Local job status mirror. Source priority:
  //   1. Local state set on Send-to-client success (most recent).
  //   2. state.recentJobs lookup (synced via JOBS_UPDATED).
  //   3. Default 'draft'.
  const jobIdForStatus = savedJobId || state.savedJobId;
  const lookupRecentStatus = () => {
    if (!jobIdForStatus) return null;
    const match = state.recentJobs?.find?.(j => j.id === jobIdForStatus);
    return match?.status || null;
  };
  const [localStatus, setLocalStatus] = useState(() => lookupRecentStatus());

  // Refresh local status when recentJobs sync (e.g. on dashboard
  // returning, after JOBS_UPDATED dispatch). Only overrides when the
  // user hasn't yet locally advanced — once `localStatus` reflects a
  // user action we trust it until the next mount.
  useEffect(() => {
    const fromRecent = lookupRecentStatus();
    if (fromRecent && localStatus === null) {
      setLocalStatus(fromRecent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIdForStatus, state.recentJobs]);

  // Effective status for rendering — drafts default when nothing is
  // known. Treat unknown statuses defensively as drafts so the button
  // stays actionable rather than silently locked.
  const KNOWN_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'completed'];
  const effectiveStatus = KNOWN_STATUSES.includes(localStatus) ? localStatus : 'draft';

  // The "Sent to client" green confirmation state covers any status
  // that's already been advanced past draft. (Accepted/declined/
  // completed all imply the link went out at some point.)
  const sentLocked = effectiveStatus !== 'draft';

  // Track in-flight state so the button shows progress and we don't
  // double-fire on a rapid second tap.
  const [marking, setMarking] = useState(false);

  // Primary handler — record that the waller has sent the link. Uses
  // the existing /status route + the dashboard's `updateJobStatus`
  // helper. NO new endpoint, NO new wire-format. Sets sent_at = now,
  // expires_at = +30d (matches dashboard Send button parity).
  const handleSendToClient = async () => {
    if (sentLocked || marking) return;
    if (!requireProfile()) return;
    const jobId = savedJobId || state.savedJobId;
    if (!state.currentUserId || !jobId) {
      showToast?.(`Save the ${term.lower} first, then mark as sent.`, 'error');
      return;
    }
    setMarking(true);
    try {
      const sentAtIso = new Date().toISOString();
      const expiresAtIso = calculateExpiresAt(sentAtIso);
      await updateJobStatus(state.currentUserId, jobId, 'sent', {
        sentAt: sentAtIso,
        expiresAt: expiresAtIso,
      });
      // Refresh local status + downstream consumers (dashboard list,
      // banner). The status banner derives from clientStatus (portal
      // view/response state), not from job.status, so it doesn't need
      // to flip — but the green button confirmation does.
      setLocalStatus('sent');
      dispatch({
        type: 'JOBS_UPDATED',
        jobs: (state.recentJobs || []).map(j =>
          j.id === jobId
            ? { ...j, status: 'sent', sentAt: sentAtIso, expiresAt: expiresAtIso }
            : j
        ),
      });
      showToast?.('Quote marked as sent', 'success');
    } catch (err) {
      console.error('Mark-as-sent failed:', err);
      showToast?.(err?.message || 'Failed to update status', 'error');
    } finally {
      setMarking(false);
    }
  };

  // Build the caret menu items contextually. Order (top → bottom):
  //   1. Email / Outlook (only when EMAIL_INTEGRATION_ENABLED is on)
  //   2. divider (only when section 1 rendered AND section 3 has items)
  //   3. Copy client link (always — the canonical "share" action)
  //   4. Status-change actions appropriate to the current status
  //
  // Hide the caret entirely if there are no items (completed status
  // with the flag off — nothing to offer).
  const openStatusModal = (targetStatus) => {
    const jobId = savedJobId || state.savedJobId;
    if (!jobId) {
      showToast?.(`Save the ${term.lower} first, then update its status.`, 'error');
      return;
    }
    dispatch?.({ type: 'OPEN_STATUS_MODAL', jobId, targetStatus });
  };

  const buildSendMenuItems = () => {
    const items = [];

    // Email-integration items (flag-gated). Kept above the divider so
    // the status actions stay grouped together below.
    if (emailIntegrationEnabled) {
      items.push({
        id: 'email',
        icon: 'mail',
        label: 'Send via Email',
        sub: 'Your default mail app',
        onClick: handleEmail,
      });
      items.push({
        id: 'outlook',
        icon: 'mail',
        label: 'Send via Outlook',
        sub: 'Open in Outlook (or Mail.app)',
        onClick: handleSendViaOutlook,
      });
    }

    // Copy client link — the canonical share action across all statuses.
    // Matches the dashboard kebab's Resend pattern (PR #86).
    items.push({
      id: 'copy',
      icon: 'link',
      label: 'Copy client link',
      sub: 'Paste into WhatsApp, SMS, or email',
      onClick: handleCopyClientLink,
    });

    // Status-change items per current status. Inserts a divider between
    // the share group above and these so the visual grouping is clear.
    const statusItems = [];
    if (effectiveStatus === 'draft' || effectiveStatus === 'sent') {
      statusItems.push({
        id: 'decline',
        icon: 'x',
        label: 'Mark declined',
        sub: 'Client said no',
        danger: true,
        onClick: () => openStatusModal('declined'),
      });
    }
    if (effectiveStatus === 'sent') {
      // Useful when the waller gets a verbal yes minutes after sending
      // and wants to lock that in without bouncing back to the dashboard.
      statusItems.unshift({
        id: 'accept',
        icon: 'check',
        label: 'Mark accepted',
        sub: 'Client said yes',
        onClick: () => openStatusModal('accepted'),
      });
    }
    if (effectiveStatus === 'accepted') {
      statusItems.push({
        id: 'complete',
        icon: 'check',
        label: 'Mark complete',
        sub: 'Job finished',
        onClick: () => openStatusModal('completed'),
      });
      statusItems.push({
        id: 'decline',
        icon: 'x',
        label: 'Mark declined',
        sub: 'Client backed out',
        danger: true,
        onClick: () => openStatusModal('declined'),
      });
    }
    if (effectiveStatus === 'declined') {
      // Uses the widened VALID_TRANSITIONS from PR #86 (declined → draft).
      statusItems.push({
        id: 'reopen',
        icon: 'refresh',
        label: 'Re-open',
        sub: 'Back to draft for editing',
        onClick: () => openStatusModal('draft'),
      });
    }
    // 'completed' has no status-change items — terminal state.

    if (statusItems.length > 0) {
      items.push({ id: '__divider', divider: true });
      items.push(...statusItems);
    }

    return items;
  };

  const sendMenuItems = buildSendMenuItems();

  // Open the LivePreview overlay used by the bottom "Preview" strip.
  // We dispatch the same toggle the LivePreview component listens to
  // so the existing keyboard / overlay plumbing is unchanged.
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div className="qo-screen">
      {/* Header — Back · title · ref · subtitle.
           Title is the literal "Your quote is ready" per spec.
           documentTerm() is preserved everywhere else (PDF, DOCX,
           client portal, email subject) — this override is app-chrome
           only. */}
      <div className="qo-header">
        <div className="qo-header-text">
          {!isReadOnly && !onBack && (
            <button
              onClick={() => dispatch({ type: 'BACK_TO_REVIEW' })}
              className="qo-back-link"
              style={{ minHeight: 44 }}
              title="Back to Review & Edit"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              <span>Back to quote</span>
            </button>
          )}
          {onBack && (
            <button
              onClick={onBack}
              className="qo-back-link"
              style={{ minHeight: 44 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              <span>Back</span>
            </button>
          )}
          <h1 className="qo-title page-title">Your quote is ready</h1>
          <div className="qo-ref">
            <span className="qo-ref-num">{jobDetails.quoteReference || '—'}</span>
            {jobDetails.clientName && (
              <>
                <span className="qo-ref-sep"> · </span>
                <span className="qo-ref-client">{jobDetails.clientName}</span>
              </>
            )}
          </div>
          <p className="qo-subtitle">Send it straight to your client, or download a copy to keep.</p>
        </div>
      </div>

      {/* Status banner (state-dependent). Refers to the saved quote's
           current portal/response state. Suppressed entirely until the
           quote has been saved so it doesn't show a misleading "Not
           sent yet" before there's anything to send. */}
      {savedJobId && (
        <div
          className={`qo-status qo-status--${statusBannerKind}`}
          role="status"
          data-status-kind={statusBannerKind}
        >
          <span className="qo-status-ic" aria-hidden>
            {statusBannerKind === 'accepted' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
            {statusBannerKind === 'declined' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            )}
            {(statusBannerKind === 'sent' || statusBannerKind === 'viewed') && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>
              </svg>
            )}
            {statusBannerKind === 'draft' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9"/>
              </svg>
            )}
          </span>
          <div className="qo-status-body">
            <div className="qo-status-title">{statusBannerCopy.title}</div>
            <div className="qo-status-sub">{statusBannerCopy.sub}</div>
          </div>
        </div>
      )}

      {/* Action region — two split-buttons + one tertiary text link.
           Replaces the PR #73 Download/Send/More layout (3 chips + a
           disclosure). The split-buttons use a small inline state
           component (SplitButton) — no dropdown library; native
           markup, outside-click dismissal, ESC closes. */}
      <div
        className="qo-actions"
        data-action-group="primary"
        role="group"
        aria-label="Quote actions"
      >
        <SplitButton
          variant="primary"
          mainLabel={sentLocked ? 'Sent to client' : 'Send to client'}
          mainIcon={sentLocked ? 'check' : 'send'}
          onMain={handleSendToClient}
          onMainLoading={marking}
          mainLoadingLabel="Marking as sent…"
          mainConfirmed={sentLocked}
          ariaLabelMenu="More actions"
          menuLabel="More actions"
          items={sendMenuItems}
        />
        <SplitButton
          variant="secondary"
          mainLabel="Download PDF"
          mainIcon="download"
          onMain={() => handleDownloadPdfServer()}
          onMainLoading={generatingServerPdf}
          mainLoadingLabel="Generating PDF…"
          ariaLabelMenu="Download as"
          menuLabel="Download as"
          items={[
            { id: 'pdf', icon: 'pdf', label: 'PDF', sub: 'Best for sending & printing', onClick: () => handleDownloadPdfServer() },
            { id: 'word', icon: 'word', label: 'Word', sub: 'Edit before you send', onClick: handleDownloadDocx },
            { id: 'print', icon: 'print', label: 'Print / Save via print', sub: 'Open the print dialog', onClick: handlePrint },
            // Mark's 2026-07-20 UAT: "did we lose the download for staff
            // option?" — the worker-copy PDF was still in the "More
            // actions" disclosure, but users looking for "download
            // without prices" reasonably expect it in the Download menu
            // next to PDF / Word / Print. Admin-only gate matches the
            // existing button in the More actions disclosure.
            ...(isAdminPlan ? [{
              id: 'worker-copy',
              icon: 'pdf',
              label: 'Worker copy (PDF)',
              sub: 'Same PDF with prices hidden — for site staff',
              onClick: () => handleDownloadPdfServer({ hideCosts: true }),
            }] : []),
          ]}
        />
        {!isReadOnly && (
          <button
            type="button"
            className="qo-edit-link btn-ghost"
            onClick={() => dispatch({ type: 'BACK_TO_REVIEW' })}
            title="Go back to Review & Edit"
            style={{ minHeight: 44 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            <span>Edit &amp; re-generate</span>
          </button>
        )}
      </div>

      {/* Hero client-link card — promoted from the bottom of the page.
           Renders whenever a savedJobId exists; ClientLinkBlock handles
           its own pre-generate vs token-exists states internally. */}
      {savedJobId && (
        <ClientLinkBlock
          currentUserId={state.currentUserId}
          jobId={savedJobId}
          profile={profile}
          showToast={showToast}
          requireProfile={requireProfile}
        />
      )}

      {/* Admin actions kept reachable behind a discreet inline disclosure
           — Save, Worker copy, Export for QuickBooks, Create RAMS. These
           are non-primary, occasional actions; the Send/Download split-
           buttons are the primary path. Native <details>/<summary>
           keeps keyboard + ARIA for free. The summary is the inner
           <span> so the click-toggle stays reliable (PR #83 fix). */}
      {(!isReadOnly || isAdminPlan) && (
        <details className="qo-extras" data-action-group="extras">
          <summary
            className="cursor-pointer list-none inline-block qo-extras-summary"
            style={{ width: 'fit-content', minHeight: 44 }}
            title="Save, send to QuickBooks, create RAMS, and other extras"
          >
            <span className="btn-ghost">More actions</span>
          </summary>
          <div className="qo-extras-row">
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
                {saving ? 'Saving...' : saved ? `Saved ✓` : `Save ${term.title}`}
              </button>
            )}
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
                {exportingQb ? 'Building CSV…' : 'Export for QuickBooks'}
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
            {!isReadOnly && (
              <button
                onClick={handleNewQuote}
                className="btn-ghost"
                style={{ color: 'var(--tq-muted)' }}
              >
                Start New {term.title}
              </button>
            )}
          </div>
          {saveError && !saving && (
            <p className="text-xs mt-2" style={{ color: 'var(--tq-error-txt, #f87171)' }}>
              Save failed — your work is preserved in this tab.
            </p>
          )}
        </details>
      )}

      {/* Doc strip — slim row at the bottom keeps the full quote
           document one tap away. The PDF document itself is unchanged
           (no edits to QuoteDocument.jsx or pdfRenderer.js). */}
      <div className="qo-doc-strip" data-doc-strip>
        <div className="qo-doc-thumb" aria-hidden>
          <i className="a" />
          <i />
          <i />
          <i />
        </div>
        <div className="qo-doc-strip-text">
          <div className="qo-doc-strip-head">Full quote document</div>
          <div className="qo-doc-strip-sub">
            Description, measurements, schedule of works
            {filteredPhotos.length > 0 && ` · ${filteredPhotos.length} photo${filteredPhotos.length === 1 ? '' : 's'}`}
            {jobDetails.quoteReference && ` · ${jobDetails.quoteReference}`}
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost qo-doc-preview"
          onClick={() => setPreviewOpen(o => !o)}
          aria-pressed={previewOpen}
          style={{ minHeight: 44 }}
        >
          {previewOpen ? 'Hide preview' : 'Preview'}
        </button>
      </div>

      {/* Photo selection & reorder grid — kept from the previous layout
           since it controls which photos land in the exported PDF/DOCX.
           Hidden behind the document preview accordion to keep the top
           of the screen focused on Send/Download. */}
      {previewOpen && allPhotos.length > 0 && (
        <div className="mb-6 mt-4">
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
           steps headline + a "Show full guide" expander on demand. */}
      {showQbInstructions && (
        <QbInstructionsModal
          vatRegistered={profile?.vatRegistered === true}
          onClose={() => setShowQbInstructions(false)}
        />
      )}

      {/* Quote Document — only revealed when the user taps Preview.
           Wrapped in a scoped ErrorBoundary so a crash inside
           QuoteDocument doesn't take Step 5 down. */}
      {previewOpen && (
        <div className="bg-white shadow-lg overflow-hidden mt-4" ref={quoteRef} style={{ borderRadius: 2 }}>
          <ErrorBoundary scope="quote-document">
            <QuoteDocument state={state} showPhotos={false} />
          </ErrorBoundary>
        </div>
      )}

      {/* Print-only clone — full quote + photo appendix rendered inline so
           the browser's print engine paginates cleanly. Hidden on screen
           via `.print-only`. */}
      <div className="print-root print-only" aria-hidden="true">
        <QuoteDocument state={state} showPhotos selectedPhotos={filteredPhotos} />
      </div>

      {/* TRQ-94: Profile gate. */}
      <ProfileGateModal
        open={showProfileGate}
        term={term}
        onClose={() => setShowProfileGate(false)}
        onOpenProfile={onRequestOpenProfile}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SplitButton — small inline state component used by the two action
// buttons. Main click runs the primary handler; the caret opens a
// menu with secondary handlers. Outside-click + ESC close the menu.
// On mobile (<900px) the menu expands inline below the button rather
// than dropping down so it stays touch-reachable.
// ─────────────────────────────────────────────────────────────────────

const ICONS = {
  send: <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></>,
  link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
  pdf: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
  word: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></>,
  print: <><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>,
  chev: <polyline points="6 9 12 15 18 9"/>,
  check: <polyline points="20 6 9 17 4 12"/>,
  x: <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  refresh: <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
};

function Icon({ name, size = 16 }) {
  if (!ICONS[name]) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  );
}

function SplitButton({
  variant = 'primary',
  mainLabel,
  mainIcon,
  onMain,
  onMainLoading = false,
  mainLoadingLabel,
  mainConfirmed = false,
  ariaLabelMenu,
  menuLabel,
  items,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const handleKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Confirmed (locked-green) state uses a separate class so we can
  // theme it against --tq-confirmed-* tokens without disturbing the
  // amber primary or ghost-bordered secondary variants. The button
  // is rendered with aria-disabled=true and a no-op onClick so it
  // stays focusable for the visually-impaired but doesn't fire.
  const mainClass = mainConfirmed
    ? 'qo-split-main qo-split-main--confirmed'
    : (variant === 'primary' ? 'btn-primary qo-split-main' : 'btn-ghost qo-split-main');
  const caretClass = variant === 'primary' ? 'btn-primary qo-split-caret' : 'btn-ghost qo-split-caret';

  // Hide the caret entirely when there are no menu items. Avoids the
  // dangling "click me" affordance on terminal-status quotes where the
  // menu has nothing meaningful to offer.
  const hasItems = Array.isArray(items) && items.length > 0;

  return (
    <div
      className={`qo-split qo-split--${variant}${mainConfirmed ? ' qo-split--confirmed' : ''}${hasItems ? '' : ' qo-split--solo'}`}
      ref={wrapRef}
      data-split-variant={variant}
      data-confirmed={mainConfirmed ? 'true' : 'false'}
    >
      <button
        type="button"
        className={mainClass}
        onClick={mainConfirmed ? undefined : onMain}
        disabled={onMainLoading}
        aria-disabled={mainConfirmed ? 'true' : undefined}
        style={{ minHeight: 44 }}
      >
        {mainIcon && <Icon name={mainIcon} size={16} />}
        <span>{onMainLoading && mainLoadingLabel ? mainLoadingLabel : mainLabel}</span>
      </button>
      {hasItems && (
        <button
          type="button"
          className={caretClass}
          onClick={() => setOpen(o => !o)}
          aria-label={ariaLabelMenu}
          aria-haspopup="menu"
          aria-expanded={open}
          style={{ minHeight: 44 }}
        >
          <Icon name="chev" size={14} />
        </button>
      )}
      {open && hasItems && (
        <div className="qo-split-menu" role="menu" aria-label={ariaLabelMenu}>
          {menuLabel && <div className="qo-split-menu-label">{menuLabel}</div>}
          {items.map((it, i) => (
            it.divider
              ? <div key={`d-${i}`} className="qo-split-menu-div" aria-hidden="true" />
              : (
                <button
                  key={it.id}
                  type="button"
                  role="menuitem"
                  className={`qo-split-menu-item touch-44 ${it.danger ? 'qo-split-menu-item--danger' : ''}`}
                  onClick={() => { setOpen(false); it.onClick?.(); }}
                >
                  <Icon name={it.icon} size={17} />
                  <span className="qo-split-menu-item-text">
                    <span className="qo-split-menu-item-label">{it.label}</span>
                    {it.sub && <span className="qo-split-menu-item-sub">{it.sub}</span>}
                  </span>
                </button>
              )
          ))}
        </div>
      )}
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
            fontSize: 13, padding: 0, marginBottom: 12, minHeight: 44,
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
