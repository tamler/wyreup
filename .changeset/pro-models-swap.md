---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Move three Pro tools off the Workers AI models Cloudflare retires on 2026-11-20. Text to Speech now uses Deepgram Aura: English (up to 1,000 characters, 12 voices) or Spanish (up to 500 characters, 10 voices), with a new `voice` parameter; French, Chinese, Japanese and Korean are no longer available. Deep Analysis uses DeepSeek V4.1 Flash with a Gemma 4 fallback. Fix Grammar uses Gemma 4.

Pro text inputs are now limited by an estimated token count per tool and field, checked before any request is sent. English limits are about three times the character count of Chinese, Japanese or Korean limits. Questions next to a document are limited to about 2,000 characters of English. Fix Grammar takes about 12,000 characters of English, JSON Extract about 60,000, Sentiment about 72,000, Named Entities about 24,000 and Content Safety about 45,000. Credit prices are unchanged.
