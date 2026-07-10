---
'@wyreup/core': patch
---

Security dependency bumps: js-yaml to ^4.3.0 (quadratic-complexity DoS in merge-key handling, affects >= 4.0.0 <= 4.1.1) and diff to ^8.0.3 (DoS in parsePatch/applyPatch in the 6.x-7.x line).
