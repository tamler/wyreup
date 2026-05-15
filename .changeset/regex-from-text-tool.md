---
'@wyreup/core': minor
---

Add `regex-from-text` — generate a regex from a natural-language description.

Heuristic engine covers ~30 common patterns: emails, URLs, phone numbers,
ISO and US dates, UUIDs, hex colors, IPv4 / IPv6, credit cards, SSNs, ZIPs,
hashtags, mentions, markdown links, HTML tags, semver, prices, percentages,
unix timestamps, comments (JS/Python/HTML), file paths, emoji, and more.

Detects flag modifiers in the description ("case insensitive", "multiline",
"first match only", etc.) and combines them with each pattern's defaults.

Output is JSON with `pattern`, `flags`, `fullRegex`, `explanation`,
`confidence` (`high` | `medium` | `low` | `no-match`), and any
`alternatives`. Chains cleanly into `regex-tester` and `regex-visualize`.

When no heuristic matches, returns `confidence: 'no-match'` and an
`upgrade` field — the no-match path is the seam where the future hosted-AI
variant will plug in.

Public exports: `regexFromText` (ToolModule), `generateRegexFromText`
(standalone function), `RegexFromTextParams`, `RegexFromTextResult`,
`defaultRegexFromTextParams`.
