---
'@wyreup/core': patch
---

Compress never returns a larger file than its input: when a same-format re-encode comes out bigger (flat-color PNGs, screenshots), the original bytes are returned untouched. Also renames the hosted upscale tool to "Upscale (Hosted GPU)" to distinguish it from the free in-browser "Upscale 2x".
