---
'@wyreup/core': major
'@wyreup/cli': patch
'@wyreup/mcp': patch
---

**Breaking (`@wyreup/core`): `@huggingface/transformers` is now an optional peer dependency instead of a direct dependency.**

Installing `@wyreup/core` used to pull in `@huggingface/transformers`, which
depends on `sharp@^0.34.5` — a range with unpatched libvips advisories
(CVE-2026-33327, -33328, -35590, -35591; patched in sharp 0.35.0). Verified by
installing the published package from npm: consumers received sharp 0.34.5.

npm gives a library no way to fix this for its consumers. `pnpm.overrides` and
npm `overrides` only apply in the *root* project, so ours protect this repo but
are not published. Declaring `sharp@^0.35.3` directly in core doesn't work
either — `^0.34.5` means `>=0.34.5 <0.35.0`, so the ranges are disjoint and npm
installs both, with transformers still loading its own nested 0.34.5. Both were
tested rather than assumed.

Since only 12 of ~276 tools need transformers, making the other 264 carry a
vulnerable transitive dependency wasn't defensible. Consumers now opt in, which
also puts the sharp version in their project root where an override actually
takes effect.

**If you use only non-AI tools:** nothing to do. You no longer install
transformers, onnxruntime, or sharp at all — a much smaller install with no HIGH
advisories.

**If you use the AI tools** (anything calling `getPipeline`), install the peer:

```
npm install @huggingface/transformers
```

and pin a patched sharp in your project root:

```json
{ "overrides": { "sharp": "^0.35.3" } }
```

Calling an AI tool without the peer installed now throws an error naming both
steps, rather than a bare module-not-found.

`@wyreup/cli` and `@wyreup/mcp` are unaffected in behaviour: they're
applications rather than libraries, so they now declare
`@huggingface/transformers` directly and their AI tools keep working with no
action required. Note this means they still resolve the vulnerable sharp
transitively — that exposure is now confined to the two packages that genuinely
need it, and can only be fully resolved upstream in transformers.
