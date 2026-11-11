---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Add `text-checklist-pro` (Text Checklist), a 1-credit PRO tool on Cloudflare's hosted `@cf/cloudflare/clef-flash` decision model. Write up to 10 questions about a text, one per line: a plain line is yes/no, `Which team? [billing | technical | sales]` picks one option, and `How severe? [score: none | minor | major]` rates on ordered levels. The output is JSON with a probability for every option, the top pick and a confidence value. Text only, up to 16,000 characters; each question up to 200 characters with 2 to 10 options of up to 40 characters.
