---
'@wyreup/core': minor
'@wyreup/cli': minor
'@wyreup/mcp': minor
---

Add 18 ffmpeg.wasm media tools, all client-side and free-tier on the existing ffmpeg core (no new dependencies):

- Editing: resize-video, mute-video, rotate-video, extract-frame, replace-audio, crop-video, reverse-video, fade-video (in/out), loop-video, letterbox-video, vignette-video, video-volume, video-side-by-side.
- Audio: normalize-loudness (EBU R128 / ATSC / Spotify / Apple Music / YouTube / Amazon targets), analyze-loudness (LUFS/true-peak report), mix-audio (background music), strip-video-metadata.
- Measurement: video-quality-metrics (PSNR/SSIM).

Also fixes discoverability: audio/convert/inspect tools (trim-media, convert-audio, etc.) now carry secondary `categories[]` so they surface under the right filters, and `registry.byCategory` matches `categories[]` so CLI/MCP listings agree with the web catalog.
