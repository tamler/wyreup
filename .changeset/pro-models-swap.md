---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Move three Pro tools off the Workers AI models Cloudflare retires on 2026-11-20. Text to Speech now uses Deepgram Aura: English (up to 1,000 characters, 12 voices) or Spanish (up to 500 characters, 10 voices), with a new `voice` parameter; French, Chinese, Japanese and Korean are no longer available. Deep Analysis uses DeepSeek V4.1 Flash with a Gemma 4 fallback and limits the question to 2,000 characters. Fix Grammar uses Gemma 4 and takes up to 12,000 characters per run. Credit prices are unchanged, and each tool now rejects over-limit input before any credits are spent.
