---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

`transcribe-pro` takes a `format` parameter: `text` (default, unchanged), `srt` or `vtt`. Subtitle formats return the hosted model's timed captions as an SRT or WebVTT file, at the same 3-credit cost. If the model returns no timings, the run fails and the credits are refunded.
