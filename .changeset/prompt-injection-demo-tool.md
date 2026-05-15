---
'@wyreup/core': minor
---

Add `prompt-injection-demo` — visualise where prompt-injection content
hides in text.

Surfaces three categories of risk in one pass:

1. **Hidden / invisible content** — zero-width characters, BOM, control
   chars (would be hidden from a human reader but seen by an LLM).
2. **Confusable lookalikes** — Cyrillic а vs Latin a, Greek ο vs Latin o,
   fullwidth and mathematical alphanumeric impersonators. Mixed-script
   tokens that combine alphabets in one word.
3. **Instruction-override phrases and chat fences** — "ignore previous
   instructions", "disregard the above", "you are now", `[INST]` /
   `[/INST]`, `<|im_start|>` / `<|im_end|>`, `System:` role spoofing,
   named jailbreaks (DAN).

Each finding has a start/end offset, severity, kind, and human-readable
detail. Output JSON also includes a pre-rendered HTML view with
`<mark data-kind="…" data-severity="…">` spans the UI can show directly
— ready for a side-by-side "before/after" demo.

Composes `text-confusable`'s analyzer for the homoglyph layer. Free
permanent — no LLM. 19 tests.

Public exports: `promptInjectionDemo`, `analyzePromptInjection`,
types, defaults.
