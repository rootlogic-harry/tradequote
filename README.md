# TradeQuote

AI-powered quote generator for dry stone walling professionals. A tradesman photographs a damaged wall, enters a job address, and receives a professionally formatted, print-ready quote in under 5 minutes.

## Features

- **AI Analysis** - Upload photos of damaged walls; Claude analyses stone type, damage extent, and measurements using an optional reference card for calibrated dimensions
- **Calibrated Pricing** - AI prompt trained on verified professional waller rates (West Yorkshire / Cumbria, March 2026) for accurate cost estimation
- **Unit-aware Materials** - Materials table supports m&sup2;, tonnes, linear metres, items, and number units with per-unit rate pricing
- **Editable Review** - Every AI suggestion is editable. All measurements must be confirmed before quote generation. Immutable `aiValue` tracking powers the learning loop
- **Notes & Conditions** - Standard professional terms auto-included (lime mortar, Listed Building Consent, payment terms)
- **Multi-format Export** - Download as Word (.docx) or PDF with photo appendix
- **Saved Quotes** - Quotes persisted in IndexedDB with reload and re-edit capability
- **Mobile-ready** - Field-optimised responsive layout for on-site use

## Tech Stack

- React 18 + Vite
- Tailwind CSS (CDN)
- `docx` for Word export, `html2canvas` + `jsPDF` for PDF (CDN)
- Client-side Anthropic API (user provides their own key)
- No backend - state in React, quotes in IndexedDB
- Jest for unit tests (178 tests across 5 utility modules)

## Getting Started

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # run all tests
npm run build      # production build
```

## Deployment

Deployed on [Railway](https://railway.app) via git push to `main`. The Vite preview server runs on the Railway-assigned `$PORT`.

```bash
git push origin main   # triggers Railway auto-deploy
```

## Project Structure

```
src/
  App.jsx                         # useReducer orchestrator, AI call
  components/
    QuoteDocument.jsx             # print-ready quote layout
    SavedQuotes.jsx               # saved quotes list
    SavedQuoteViewer.jsx          # read-only quote viewer with re-edit
    StepIndicator.jsx             # 5-step progress bar
    steps/
      ProfileSetup.jsx            # company profile + API key
      JobDetails.jsx              # client details + photo upload + AI prompt
      AIAnalysis.jsx              # loading screen during API call
      ReviewEdit.jsx              # 3-column review: measurements, schedule, costs
      QuoteOutput.jsx             # document preview + Word/PDF export
    review/
      MaterialsTable.jsx          # editable materials with unit dropdown
      LabourSection.jsx           # days x workers x rate
      ScheduleList.jsx            # numbered schedule of works
      LivePreview.jsx             # real-time quote preview
  utils/
    aiParser.js                   # parse, validate, normalise AI JSON
    calculations.js               # pure financial functions
    diffTracking.js               # AI vs confirmed value diffs (learning loop)
    quoteBuilder.js               # quote ref, formatting, payload assembly
    savedQuotesDB.js              # IndexedDB persistence
    validators.js                 # profile, job, photo validation gates
  __tests__/                      # Jest test suites for all utils
```

## Linear

Tracked under the **Trade Quote** team in [Linear](https://linear.app/rootfolio).

## License

Private - all rights reserved.
