---
'@wyreup/core': minor
---

Add `pdf-extract-data` — extract structured fields from invoice /
receipt PDFs without an LLM.

Pure heuristic — runs pdf.js text extraction in-browser, then a
labelled-money + date + invoice-number + line-item pass over the
text. No model download, no upload.

Detected fields:
- **vendor** — first non-numeric line near the top of the PDF.
- **invoiceNumber** — after Invoice / Receipt / Order / Reference labels.
- **date** — first ISO (`YYYY-MM-DD`), US (`MM/DD/YYYY`), or long-form
  (`May 14, 2026`) date.
- **total** — after Total / Amount Due / Grand Total labels; fallback
  to the largest currency amount in the document.
- **subtotal** — after Subtotal / Sub-total labels.
- **tax** — after Tax / Sales Tax / VAT / GST labels.
- **lineItems** — description + amount pairs from rows that match the
  layout (excludes the total/subtotal/tax lines).

Configurable currency symbol (`$` default; works with `£`, `€`, etc.).
Output includes a confidence score (`high` / `medium` / `low`),
warnings for missing fields, and the raw extracted text so callers
can run their own checks.

Public exports: `pdfExtractData` (ToolModule), `extractPdfData`
(PDF → fields), `extractFieldsFromText` (pure text → fields, useful
for testing and downstream composition), types, defaults.

19 tests using a synthetic invoice text corpus.
