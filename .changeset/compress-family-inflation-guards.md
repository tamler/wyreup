---
'@wyreup/core': patch
---

Compress-family tools (compress, pdf-compress, compress-video,
compress-image-to-size) never return an output larger than the input without
keeping the original bytes or, when a format/container change was explicitly
requested, emitting a clear warning.
