---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Add `receipt-extract-pro`, a Pro tool that reads a receipt, invoice or simple bill and returns vendor, invoice or receipt number, date, due date, currency, subtotal, tax, total, line items and contact as JSON. Each field has a `missing` flag and, from the primary model (Cloudflare Clairic, a preview model), a confidence score. If Clairic is unavailable the run falls back to Gemma 4 and the result is marked as having no confidence scores. Input is pasted text up to 6,000 characters (fewer for non-Latin scripts) or 1 to 4 PNG, JPEG or WebP photos, downscaled to at most 1 megapixel and 1,600 pixels on a side each and 1.8 megapixels in total. Costs 2 credits per run.
