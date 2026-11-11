---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Move three Pro tools off the Workers AI models Cloudflare retires on 2026-11-20. Text to Speech now uses Deepgram Aura: English (up to 1,000 characters, 12 voices) or Spanish (up to 500 characters, 10 voices), with a new `voice` parameter; French, Chinese, Japanese and Korean are no longer available. Deep Analysis uses DeepSeek V4.1 Flash with a Gemma 4 fallback. Fix Grammar uses Gemma 4.

Pro text inputs are now limited per tool and field by their UTF-8 size, a hard upper bound on the tokens a hosted model can bill, checked before any request is sent. An English letter counts once and a Chinese, Japanese or Korean character three times. Per-run limits in English characters: Summarize, Translate, Redact and PDF Summary about 38,000; Ask a PDF 36,000; Ask a Long PDF 44,000; Deep Analysis 34,000; Sentiment 26,000; JSON Extract 21,000; Fix Grammar 16,000; Content Safety 15,500; Named Entities 10,500; questions and field descriptions 1,500. Credit prices are unchanged.

Every remaining hosted tool now has a bounded cost. Transcribe Pro and Transcribe & Translate take WAV or MP3 only, up to 45 minutes, with the length measured from the file before upload and again on the server; convert other formats to MP3 first. WAV files with more than one format or data section are refused. Translate (100+ languages), Translate to Indic Languages and Translate Document now run on Gemma 4 with a capped output (about 16,000 characters of English per run for the first two, about 48,000 for documents). A translation or grammar fix that runs out of output budget fails and is refunded instead of returning partial text; a Deep Analysis answer that does is marked `truncated`. Background removal and upscaling stop after 14 seconds of GPU time. Detect Objects is removed: its hosted model has no published price, so its cost could not be bounded.
