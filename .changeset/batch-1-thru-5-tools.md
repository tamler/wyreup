---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Add ~70 new tools across five sprints + emergent compositions.

**Secrets / auth suite:** hmac, base32, base58, totp-code, hotp-code, jwt-sign, signed-url, backup-codes, otpauth-uri, webhook-verify, webhook-replay, signed-cookie-decode, api-key-format, license-key, pgp-armor.

**Data wrangling:** csv-deduplicate, csv-merge, csv-diff, csv-info, csv-to-json-schema, csv-template (NEW mail-merge — render N documents from a CSV + mustache template), json-flatten, json-unflatten, json-diff, json-path, json-merge (NEW deep-merge with conflict report), json-schema-infer, json-schema-validate, frontmatter-to-csv, yaml-validate, xml-to-json, json-to-xml.

**Security inspect:** text-confusable, text-redact, text-suspicious (NEW prompt-injection verdict), pdf-suspicious (NEW PDF prompt-injection scanner).

**Spec validators:** openapi-validate, package-json-validate.

**Text / HTML:** unicode-info, markdown-toc, markdown-frontmatter, color-contrast, password-strength, text-frequency, text-stats-by-paragraph, morse-code, roman-numeral, mime-detect, url-parse, url-build, url-shorten-local, html-clean, html-extract-links, favicon-from-url, css-minify, html-minify, file-fingerprint, text-template, color-blind-simulator.

All tools ship as `presence: 'both'` — available in web, CLI (`wyreup run <tool>`), and MCP (`@wyreup/mcp`).
