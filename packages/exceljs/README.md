# @wyreup/exceljs

ExcelJS 4.4.0 with native UUID generation and a browser bundle rebuilt from
integrity-pinned source. The upstream MIT license and browser dependency
license texts are included. This package is maintained by Wyreup, independently
of the upstream ExcelJS project.

Node.js 22.13 or newer is required. Browser use requires a secure context
(HTTPS or localhost) with `crypto.randomUUID`. The browser build provides a
default ExcelJS export; use `import ExcelJS from '@wyreup/exceljs'` in a bundler
that honors the package's browser field. Browser filesystem APIs remain
unavailable; use XLSX buffer methods. Native APIs and upstream types are retained.

Run `pnpm build` in this workspace to verify the pinned upstream archive,
replace the single UUID import, rebuild the browser bundle, and record a
SHA-256 inventory. `pnpm prepack` only verifies existing artifacts and performs
no download or rebuild. Generated `vendor/` files are intentionally not in Git.
