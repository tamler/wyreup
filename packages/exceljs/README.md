# @wyreup/exceljs

ExcelJS 4.4.0 with native UUID generation and a browser bundle rebuilt from
integrity-pinned source. The upstream MIT license and browser dependency
license texts are included. The Node streaming writer ships an Archiver 7 bundle
with fixed glob 14.0.2 and minimatch 11.0.1. This package is maintained by Wyreup, independently
of the upstream ExcelJS project.

Node.js 22.13 or newer is required. Browser use requires a secure context
(HTTPS or localhost) with `crypto.randomUUID`. The browser build provides a
default ExcelJS export; use `import ExcelJS from '@wyreup/exceljs'` in a bundler
that honors the package's browser field. Browser filesystem APIs remain
unavailable; use XLSX buffer methods. Native APIs and upstream types are retained.

Run `pnpm build` in this workspace to verify the pinned upstream archive,
replace the single UUID import, rebuild the browser and Node archive bundles, and record a
SHA-256 inventory. `pnpm prepack` only verifies existing artifacts and performs
no download or rebuild. Generated `vendor/` files are intentionally not in Git.

Node bundle inputs, package manifests, engine ranges and complete license texts
are recorded in `vendor/NODE-DEPENDENCIES.json`, `vendor/NODE-METAFILE.json` and
`vendor/NODE-THIRD-PARTY-NOTICES.txt`. The build requires each bundled package's
exact identity in the workspace lock and checks compatibility with Node 22.13.
Consumer package-manager audits do not inspect bundled dependency code. Their
raw-zero result covers installed package dependencies, not the bundled Archiver,
glob or minimatch code. The full workspace audit covers those build dependencies;
both that audit and the generated provenance must be checked for future updates.
The pinned glob manifest patch selects its published unbundled entries; the Node
build refuses minified input filenames rather than silently omitting their
embedded dependency identities from the graph.
