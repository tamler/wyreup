---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Wave T — trigger rules: drop a file, get the right pipeline proposed.

A trigger rule binds a file MIME pattern to a saved chain. When a
matching file arrives anywhere on Wyreup, the rule's chain is
*proposed* via a preview sheet — never auto-run. The user confirms;
the chain executes locally.

**`@wyreup/core` additions** (all new public API):

- `TriggerRule`, `TriggerKit` types — versioned schema (v1).
- `matchRule(fileMime, rules, fires)` — pure-function matcher,
  most-specific MIME wins, user-`order` tiebreak, deterministic id
  tiebreak; rate-limit gate is part of the match outcome.
- `parseTriggerKit`, `serializeTriggerKit` — validates MIME shape,
  rejects bare wildcards. Forward-compat migration shape.
- `updateTriggerRule(rule, patch)` — enforces G2: meaningful field
  changes re-arm `confirmed: false`. The receiver has to re-approve.
- `strippedForImport(kit)` — every imported rule lands unconfirmed.
- `runPreflight(file)` — suspicious-content pre-flight; uses
  text-suspicious / pdf-suspicious depending on MIME. Returns a
  verdict the UI surfaces before showing Run.
- `readFileHeader(file)` — first 256 bytes + recognised magic
  (PDF / PNG / JPEG / GIF / ZIP-shaped / GZIP / WebP). Helps users
  spot MIME-spoofed files.
- `validateChain(chain, registry)` — spoof gate. Reports any chain
  step that references a tool ID not in the built-in registry.
- `DEFAULT_RATE_LIMIT`, `MAX_RATE_LIMIT`, `clampRateLimit`,
  `pruneFires` — flood-prevention helpers.

**Security model**

Eight enforced guarantees in code:
G1 preview before every run, G2 per-rule "don't ask again",
G3 file_handlers route through the preview, G4 suspicious-file
pre-flight, G5 no network egress, G6 output-collision reporting,
G7 per-rule rate limit, G8 spoof gate (only built-in tools run).
Full spec: docs/triggers-security.md.

**`@wyreup/cli`**: `--from-kit` flag help updated for the
"My Kit" → "Toolbelt" rename.

**`@wyreup/mcp`**: no API surface change; tracks the core minor.
