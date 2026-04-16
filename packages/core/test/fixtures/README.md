# Core test fixtures

Reference images for tool module tests. Committed to the repo so tests are deterministic.

- `photo.jpg` — 800×600 gradient JPEG at quality 90
- `graphic.png` — 400×400 PNG with a solid shape
- `photo.webp` — the JPEG re-encoded as WebP at quality 85
- `corrupted.jpg` — intentionally invalid bytes for error-path testing

To regenerate, run the one-off scripts in `/tmp/gen-*.mjs` as described in the Wave 1a plan (Task 3).
