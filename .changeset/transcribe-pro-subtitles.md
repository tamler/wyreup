---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

`transcribe-pro` takes a `format` parameter: `text` (default, unchanged), `srt` or `vtt`. Subtitle formats return the hosted model's timed captions as an SRT or WebVTT file, at the same 3-credit cost. If the model returns no timed cues (including a header-only WebVTT), the run fails and the credits are refunded.

`convertVttToSrt` (and so `convert-subtitles`) no longer drops cue text that is only a number, such as "42"; only a cue identifier before the timing line is removed. CLI and MCP save `application/x-subrip` output as `.srt` and `text/vtt` as `.vtt`, and the CLI prints SRT to the terminal like other text. MCP returns SRT inline like other text when no output path is given, instead of refusing it after the run. `convertVttToSrt` also keeps a cue that follows the `WEBVTT` header without a blank line.
