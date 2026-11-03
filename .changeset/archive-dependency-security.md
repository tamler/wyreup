---
'@wyreup/exceljs': patch
'@wyreup/core': patch
'@wyreup/cli': patch
'@wyreup/mcp': patch
---

Ship the maintained spreadsheet library's Node archive runtime with fixed glob and minimatch dependencies and recorded source and license provenance. Preserve streaming workbook writes, queued data and file-backed images without requiring consumer dependency overrides.

Existing application lockfiles should be refreshed and audited when upgrading; repository resolution overrides do not update a consumer's preexisting lockfile. Package-manager audits do not inspect bundled archive code, which is checked through the recorded graph and full workspace audit before release.
