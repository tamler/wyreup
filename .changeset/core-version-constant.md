---
'@wyreup/core': patch
---

Fix `WYREUP_CORE_VERSION` reporting `0.0.0`.

The constant was a hardcoded string literal in `src/index.ts`, written at the
scaffold commit and never updated since — so the published package advertised
`0.0.0` all the way through the 1.0.0 release. Changesets rewrites
`package.json` on release and has no reason to touch a literal in source, so the
two could only ever drift further apart.

It's now injected by tsup's `define`, read from `package.json` at build time, in
both the browser and node bundles. Built output reports the real version;
importing from source (tests) yields `0.0.0-src`, an intentionally
unbuildable-looking sentinel rather than a plausible wrong number.
