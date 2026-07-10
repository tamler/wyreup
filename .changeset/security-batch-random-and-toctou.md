---
'@wyreup/core': patch
'@wyreup/cli': patch
---

Security hardening: password-generator now draws characters and shuffles with rejection-sampled unbiased randomness (a bare modulo over getRandomValues skewed toward low charset indices), and install-skill reads local --source files without a stat-then-read TOCTOU window.
