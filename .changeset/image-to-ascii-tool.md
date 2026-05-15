---
'@wyreup/core': minor
---

Add `image-to-ascii` — convert any image to ASCII or Unicode-block art.

Configurable output width (10-400 columns), three character ramps
(standard 70-char Paul Bourke ramp, simple 10-char, Unicode blocks),
optional invert for dark-mode terminals. Rec. 709 luminance with
alpha-blend onto white background.

Output is `text/plain` — paste anywhere monospace renders. Free
permanent — pure canvas + math, no LLM.

Public exports: `imageToAsciiArt`, `imageToAscii`, types, defaults.
