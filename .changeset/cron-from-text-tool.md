---
'@wyreup/core': minor
---

Add `cron-from-text` — generate a cron expression from a natural-language schedule.

Recognises: `every N minutes/hours/days/weeks/months`, specific times
(`HH:MM`, 12h with am/pm, `midnight`, `noon`), days of week
(`monday`–`sunday`, `weekdays`, `weekends`, lists), and days of month
(`1st`, `last day`).

Output is JSON with `cron` (5-field), `fields` breakdown,
`explanation`, `confidence`, `matchedTokens`. Free permanent — no
LLM, no model. When no heuristic matches, returns `confidence:
'no-match'` with an `upgrade` field for the future hosted-AI fallback.

Public exports: `cronFromText` (ToolModule), `generateCronFromText`
(standalone function), types, defaults.
