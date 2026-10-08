# Core test fixtures

Reference images for tool module tests. Committed to the repo so tests are deterministic.

- `photo.jpg` — 800×600 gradient JPEG at quality 90
- `graphic.png` — 400×400 PNG with a solid shape
- `photo.webp` — the JPEG re-encoded as WebP at quality 85
- `corrupted.jpg` — intentionally invalid bytes for error-path testing

To regenerate, run the one-off scripts in `/tmp/gen-*.mjs` as described in the Wave 1a plan (Task 3).

- `doc-a.pdf` — minimal A4 PDF with title "Document A"
- `doc-b.pdf` — minimal A4 PDF with title "Document B"
- `doc-multipage.pdf` — 3-page A4 PDF used as input for split-pdf, rotate-pdf, reorder-pdf, and page-numbers-pdf tests

- `openpgp-standard-v4.json` — standard v4 key/signature packets and protected
  armored/binary messages produced with OpenPGP.js 5.11.3 defaults
- `openpgp-legacy-v5.json` — genuine experimental v5 key packets produced with
  OpenPGP.js 5.11.3 and `config.v5Keys=true`, used to prove rejection by default

Both PGP fixtures contain intentionally public test-only private keys. They
must never protect real data.
