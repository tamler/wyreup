# Wyreup — Wave 1c: 6 More PDF Tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 more PDF tools to `@wyreup/core`: `split-pdf`, `rotate-pdf`, `reorder-pdf`, `page-numbers-pdf`, `protect-pdf`, `unlock-pdf`. All use `pdf-lib` (already installed in Wave 1b). All follow the `merge-pdf` pattern. After this wave, `@wyreup/core` has **11 tools**.

**Architecture:** pdf-lib dynamic import inside each tool's `run()`. Same Wave 1b pattern — `types.ts` + `index.ts` per tool, TDD test suite per tool, register in `default-registry.ts`.

**Preceding plan:** Wave 1b (tagged `v0.1.0-wave1b`).

**Out of scope:** pdf-to-text (pdfjs-dist worker setup is its own concern — defer to Wave 1d), watermark-pdf (separate layout work), html-to-pdf / compress-pdf (more complex), any canvas-using tools.

---

## Tool specifications

All tools accept `application/pdf` as input. All use pdf-lib dynamically loaded.

| Tool | Purpose | Input min | Output | Key API |
|---|---|---|---|---|
| `split-pdf` | Split one PDF by page ranges | 1 | PDF[] (multiple) | `PDFDocument.load()` + `copyPages` + save each |
| `rotate-pdf` | Rotate all pages (or specific pages) by 90/180/270° | 1 | single PDF | `page.setRotation(degrees(n))` |
| `reorder-pdf` | Rearrange pages into a specified order | 1 | single PDF | copyPages with reordered indices |
| `page-numbers-pdf` | Draw page numbers on each page | 1 | single PDF | `page.drawText()` with position options |
| `protect-pdf` | Password-protect a PDF | 1 | single PDF | `PDFDocument.save({ userPassword, ownerPassword })` |
| `unlock-pdf` | Remove password from a password-protected PDF | 1 | single PDF | `PDFDocument.load(buf, { password })` then save without password |

### `split-pdf` params
```ts
interface SplitPdfParams {
  /**
   * How to split. 'all' = one PDF per page. 'ranges' = parse the ranges string
   * like "1-3,5,7-9" into separate PDFs.
   */
  mode: 'all' | 'ranges';
  /** Comma-separated page ranges when mode is 'ranges'. 1-indexed inclusive. */
  ranges?: string;
}
// Default: { mode: 'all' }
```

### `rotate-pdf` params
```ts
interface RotatePdfParams {
  /** Rotation in degrees. Must be 90, 180, or 270. */
  degrees: 90 | 180 | 270;
  /**
   * Which pages to rotate. 'all' rotates every page.
   * 'odd' rotates pages 1, 3, 5, ... 'even' rotates 2, 4, 6, ...
   * A comma-separated string of page numbers (1-indexed) rotates specific pages.
   */
  pages: 'all' | 'odd' | 'even' | string;
}
// Default: { degrees: 90, pages: 'all' }
```

### `reorder-pdf` params
```ts
interface ReorderPdfParams {
  /**
   * New page order as comma-separated 1-indexed page numbers.
   * Missing pages are omitted; duplicates are allowed.
   * Example for a 3-page PDF, reversing: "3,2,1"
   */
  order: string;
}
// No default — order is required; provide empty default which will error if used.
// defaults: { order: '' }
```

### `page-numbers-pdf` params
```ts
interface PageNumbersPdfParams {
  /** Corner position. Default 'bottom-center'. */
  position: 'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-left' | 'top-center' | 'top-right';
  /** Font size in points. Default 12. */
  fontSize?: number;
  /** Starting number. Default 1. */
  startAt?: number;
  /** Format string; "{n}" is replaced with the page number. Example: "Page {n}". Default "{n}". */
  format?: string;
}
// Default: { position: 'bottom-center', fontSize: 12, startAt: 1, format: '{n}' }
```

### `protect-pdf` params
```ts
interface ProtectPdfParams {
  /** Password to set on the PDF. Required. */
  password: string;
  /**
   * Permissions granted to users who open with the password.
   * Owner has full permissions. User gets these unless revoked.
   */
  allowPrint?: boolean;
  allowCopy?: boolean;
  allowModify?: boolean;
}
// defaults: { password: '', allowPrint: true, allowCopy: true, allowModify: false }
// An empty password in defaults means caller must supply one — emptiness is checked and errors.
```

### `unlock-pdf` params
```ts
interface UnlockPdfParams {
  /** The password on the input PDF. Required. */
  password: string;
}
// defaults: { password: '' }
```

---

## Task 1: Add protected PDF fixture

**Files:**
- Create: `packages/core/test/fixtures/doc-protected.pdf`
- Modify: `packages/core/test/fixtures/README.md`

- [ ] **Step 1: Generate a password-protected PDF fixture**

Run from repo root:
```bash
cat > /tmp/gen-protected-pdf.mjs << 'EOF'
import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const page = doc.addPage([595, 842]);
page.drawText('Protected Document', { x: 50, y: 780, size: 24, font, color: rgb(0, 0, 0) });
page.drawText('This fixture is protected with password "test123".', { x: 50, y: 740, size: 12, font });

// Note: pdf-lib currently (as of v1.17.1) doesn't support saving with encryption directly.
// We'll test the unlock-pdf tool by generating a protected PDF with a different approach.
// For now, save unprotected — the unlock test will use a PDF generated via the protect-pdf tool
// itself in its test setup.
const bytes = await doc.save();
writeFileSync('packages/core/test/fixtures/doc-for-protect.pdf', bytes);
console.log('doc-for-protect.pdf:', bytes.length, 'bytes');
EOF
node /tmp/gen-protected-pdf.mjs
```

Note: pdf-lib v1.17.1 has limitations around PDF encryption. If `protect-pdf` can't actually encrypt (the library may log a warning or throw), the test for `protect-pdf` will need to verify behavior via pdf-lib's current capability (e.g., saving with a `userPassword` option if supported). The implementer should consult pdf-lib's current docs and adjust the test to match actual library behavior. **If pdf-lib does NOT support encryption at all in the installed version, mark `protect-pdf` and `unlock-pdf` as BLOCKED with a clear explanation, skip those two tools, and proceed with the other 4. Revisit after choosing an alternative library.**

- [ ] **Step 2: Update fixtures README**

Append to `packages/core/test/fixtures/README.md`:
```markdown
- `doc-for-protect.pdf` — unprotected PDF used as input for protect-pdf tests
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/fixtures
git commit -m "test(core): add fixture for protect-pdf/unlock-pdf tests"
```

---

## Task 2: Implement `split-pdf`

Follow the established tool-module pattern.

**Files to create:**
- `packages/core/src/tools/split-pdf/types.ts`
- `packages/core/src/tools/split-pdf/index.ts`
- `packages/core/test/tools/split-pdf/split-pdf.test.ts`

**Steps:**
1. Create the types file with the `SplitPdfParams` interface per specification above.
2. Write the TDD test file. Test cases:
   - Metadata: id, category 'pdf', accepts application/pdf, min 1, max 1, output mime application/pdf with multiple: true
   - Splits a 2-page PDF into 2 separate PDFs when `mode: 'all'`. Use `doc-a.pdf` (add a second page first if it's only 1 page, or create a new multi-page fixture).
   - For `mode: 'ranges'` with `"1"`, produces a single 1-page PDF.
   - Throws for invalid range string.
3. Run tests — confirm failure.
4. Implement the tool module. Use `PDFDocument.load()`, `copyPages()`, and save each range as a separate PDF. Return `Blob[]`.
5. Run tests — confirm pass.
6. Commit: `feat(core): split-pdf tool`

**For fixtures:** if the existing `doc-a.pdf` is single-page, create a `doc-multipage.pdf` fixture (3-5 pages) via a one-off generator and include it in the fixtures README update.

---

## Task 3: Implement `rotate-pdf`

**Files:**
- `packages/core/src/tools/rotate-pdf/types.ts`
- `packages/core/src/tools/rotate-pdf/index.ts`
- `packages/core/test/tools/rotate-pdf/rotate-pdf.test.ts`

**Key implementation detail:** Use pdf-lib's `degrees(n)` helper from `import { degrees } from 'pdf-lib'`. Apply rotation via `page.setRotation(degrees(n))`.

**Test cases:**
- Metadata check (id, category, input, output)
- Rotates all pages of `doc-a.pdf` by 90 degrees, verifies output is valid PDF
- Only rotates odd pages when `pages: 'odd'` — verify via loading the output and checking each page's rotation
- Rotates specific pages when `pages: "1,3"` — verify specific page rotations
- Throws for invalid degrees (not 90/180/270)
- Throws for invalid pages spec

**Commit:** `feat(core): rotate-pdf tool`

---

## Task 4: Implement `reorder-pdf`

**Files:**
- `packages/core/src/tools/reorder-pdf/types.ts`
- `packages/core/src/tools/reorder-pdf/index.ts`
- `packages/core/test/tools/reorder-pdf/reorder-pdf.test.ts`

**Implementation:** Parse `order` as comma-separated 1-indexed page numbers. Build a new `PDFDocument`, copy pages in the specified order.

**Test cases:**
- Metadata check
- Reverses a 3-page PDF with `order: "3,2,1"` — verify page count and content (if possible to check titles)
- Drops pages not listed (e.g., `"1,3"` from a 3-page doc produces a 2-page doc)
- Duplicates pages when order has duplicates (e.g., `"1,1,1"` produces 3 identical pages)
- Throws when `order` references a page that doesn't exist
- Throws for empty `order`

**Commit:** `feat(core): reorder-pdf tool`

---

## Task 5: Implement `page-numbers-pdf`

**Files:**
- `packages/core/src/tools/page-numbers-pdf/types.ts`
- `packages/core/src/tools/page-numbers-pdf/index.ts`
- `packages/core/test/tools/page-numbers-pdf/page-numbers-pdf.test.ts`

**Implementation:** Load PDF. For each page, embed Helvetica font, compute text position based on `position` param, draw the formatted page number.

Position math:
- `bottom-left`: x = margin, y = margin
- `bottom-center`: x = (pageWidth / 2) - (textWidth / 2), y = margin
- `bottom-right`: x = pageWidth - textWidth - margin, y = margin
- `top-*`: similar but y = pageHeight - fontSize - margin
- Default margin: 24 points

**Test cases:**
- Metadata check
- Adds page numbers to all pages of a multi-page PDF — verify output is valid, size increased
- Respects `startAt: 5` — the first page's number should be 5 (difficult to verify without PDF text extraction; just verify no error and output size > input size)
- Respects `format: "Page {n}"` — custom format (same: verify no error and output differs from default)
- Throws for unknown position

**Commit:** `feat(core): page-numbers-pdf tool`

---

## Task 6: Implement `protect-pdf`

**Files:**
- `packages/core/src/tools/protect-pdf/types.ts`
- `packages/core/src/tools/protect-pdf/index.ts`
- `packages/core/test/tools/protect-pdf/protect-pdf.test.ts`

**WARNING:** pdf-lib v1.17.1 has limited/no native PDF encryption support (the maintainer deprioritized it). Verify before implementing:

1. Check `node_modules/pdf-lib/es/api/PDFDocument.js` or the package README for a `save()` option like `encrypt`, `userPassword`, or `ownerPassword`.
2. If pdf-lib supports encryption in the installed version, use it. Write tests that verify the output cannot be opened without the password.
3. **If pdf-lib does NOT support encryption:** mark this tool as BLOCKED in the final report and move on. Do NOT invent a stub implementation that claims to encrypt but doesn't. The alternative is to add a small dependency like `hummus-recipe` (LGPL, heavyweight) or `pdfcpu` (Go port, heavy), neither of which fits the spec — so we'd prefer to defer.

If deferred, document in `packages/core/src/tools/protect-pdf/README.md` (create it) that this tool is not yet implemented because pdf-lib v1.17.1 lacks encryption; to be revisited with a different library.

**Test cases (if implemented):**
- Metadata check
- Produces a password-protected PDF that requires the password to open
- Throws for empty password

**Commit:** `feat(core): protect-pdf tool` OR `docs(core): defer protect-pdf pending encryption library decision`

---

## Task 7: Implement `unlock-pdf`

**Files:**
- `packages/core/src/tools/unlock-pdf/types.ts`
- `packages/core/src/tools/unlock-pdf/index.ts`
- `packages/core/test/tools/unlock-pdf/unlock-pdf.test.ts`

**Same encryption caveat as protect-pdf.** If the library can LOAD a protected PDF with `PDFDocument.load(bytes, { password })`, unlock-pdf can work (load with password, save without). If pdf-lib cannot load protected PDFs, defer.

**Test cases (if implemented):**
- Metadata check
- Unlocks a protected PDF with correct password
- Throws with incorrect password

**Commit:** `feat(core): unlock-pdf tool` OR `docs(core): defer unlock-pdf pending encryption library decision`

---

## Task 8: Update default registry

**Files:**
- Modify: `packages/core/src/default-registry.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/default-registry.test.ts`

Add imports and registrations for all successfully-implemented tools from Tasks 2–7. If protect-pdf and unlock-pdf were deferred, don't register them.

**Test additions:** for each new tool that was implemented, add a `registry.toolsById.get('<id>')` assertion.

**Commit:** `feat(core): register wave 1c tools in default registry`

---

## Task 9: End-to-end verification

- [ ] `pnpm --filter @wyreup/core test` — all tests pass
- [ ] `pnpm build` — all packages build
- [ ] `node tools/check-isolation.mjs` — passes
- [ ] `node tools/check-privacy.mjs` — passes
- [ ] `node tools/check-bundle-size.mjs` — passes
- [ ] Tag: `git tag -a v0.1.0-wave1c -m "Wave 1c: split-pdf, rotate-pdf, reorder-pdf, page-numbers-pdf (+ protect/unlock if unblocked)"`
- [ ] Push: `git push origin main --tags`

---

## Exit criteria

- All implemented tools have metadata + run() + tests
- Default registry includes them
- All CI checks green
- Tagged on GitHub

## What's next: Wave 1d

Remaining non-canvas tools:
- pdf-to-text (pdfjs-dist with worker setup)
- watermark-pdf (pdf-lib, moderate layout code)
- html-to-pdf (custom implementation)
- compress-pdf (pdfjs-dist + jSquash to re-encode embedded images)
- color-palette (node-vibrant)
- qr (qr-code-styling)
- image-diff (pixelmatch + jSquash)
- heic-to-jpg (heic-to, LGPL — needs policy confirmation)
- protect-pdf / unlock-pdf if they were deferred in Wave 1c
