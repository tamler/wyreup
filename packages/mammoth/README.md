# @wyreup/mammoth

Mammoth 1.13.0's DOCX conversion library, maintained independently by Wyreup.
The standalone CLI and its argparse dependency are excluded. The library API,
upstream types and BSD license are retained, with patched library dependency
ranges and a browser distribution rebuilt from integrity-pinned source.

Node.js 22.13 or newer is required. Import the default export to use
`convertToHtml`, `extractRawText`, `images` and the remaining upstream API.
Bundlers honoring the browser field select the browser distribution, which
accepts `{ arrayBuffer }` input. Node accepts `{ buffer }` and `{ path }`.
HTML output is not sanitized; sanitize untrusted content before rendering it.
External file access retains the upstream default of disabled.

The pinned upstream archive is SHA-512 verified before bounded extraction.
`pnpm build` rebuilds the library artifacts and records their SHA-256 inventory,
browser dependency input hashes and full license texts. `pnpm prepack` only
verifies existing artifacts; it does not download or rebuild source.
