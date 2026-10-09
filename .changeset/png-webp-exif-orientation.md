---
'@wyreup/core': patch
'@wyreup/cli': patch
'@wyreup/mcp': patch
---

Preserve displayed EXIF orientation when re-encoding PNG and WebP images, including metadata removal. Bound orientation parsing to each container's metadata payload and validate TIFF tag type, count, and offsets while preserving JPEG lossless orientation updates.
