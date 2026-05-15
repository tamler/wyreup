---
'@wyreup/core': minor
---

Add `regex-explain` — translate a regex into plain English.

Walks the regexp-tree AST (same parser as `regex-visualize`) and emits
an ordered per-part breakdown: each entry has the source fragment, a
plain-English meaning, and a kind tag (`literal` / `class` / `group` /
`assertion` / `quantifier` / `alternation` / `backreference` /
`special`).

Recognises ~30 known patterns by shape (emails, URLs, UUIDs, IPv4,
dates, hex colors, etc.) via shared `regex-from-text` patterns table —
when the input regex matches a known shape, the summary calls it out
("Recognised pattern: Email addresses.").

Notes active flags in the summary (`g`, `i`, `m`, `s`, `u`, `y`).
Output is JSON. Free permanent — no LLM. Completes the regex tool
suite: `from-text` → `tester` → `visualize` → `explain`.

Public exports: `regexExplain`, `explainRegex`, types, defaults.
