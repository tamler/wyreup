---
'@wyreup/core': patch
---

Harden tool internals against adversarial input: 13 quadratic-backtracking regexes rewritten to linear parsing (base32, convert-subtitles, css-formatter, markdown-frontmatter, morse-code, pdf-extract-data, pgp-armor, text-stats-by-paragraph, text-template, video-quality-metrics, word-counter), and sanitization gaps closed in html-clean (attributed closing tags, recombination via loop-until-stable), html-formatter/xml-formatter (comment recombination), html-extract-links (entity double-decoding), and openapi-report (CR in table cells). Each fix ships with a pathological-input regression test.
