import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QuoteDocument from '../components/QuoteDocument.jsx';
import { buildPdfFooterHtml, buildPageChromeText } from '../utils/quotePageChrome.js';
import { buildQuoteFilename } from '../utils/quoteFilename.js';
import { documentTerm } from '../utils/documentType.js';

export function renderFrozenQuoteHtml(state) {
  const quoteHtml = renderToStaticMarkup(
    React.createElement(QuoteDocument, {
      state,
      showPhotos: true,
      editable: false,
    }),
  );
  const profile = state?.profile || {};
  const jobDetails = state?.jobDetails || {};
  const chrome = buildPageChromeText({ profile, jobDetails });
  const footerHtml = buildPdfFooterHtml(chrome);
  const term = documentTerm(profile);
  const title = buildQuoteFilename({
    clientName: jobDetails.clientName,
    siteAddress: jobDetails.siteAddress,
    fallbackLabel: term.title || 'Quote',
  });
  return { quoteHtml, headerHtml: '', footerHtml, title };
}
