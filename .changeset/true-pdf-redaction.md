---
'@wyreup/core': patch
---

Fix Redact PDF to remove covered text and image pixels instead of drawing recoverable visual covers. Rebuild pages locally at 144 DPI with extractable text outside the boxes, and discard source metadata, annotations, forms and attachments.

Resolve Node standard-font assets to retain visible text. Add image-only export to remove all text layers, including hidden or misaligned OCR, and omit output timestamps. Explain positional text retention and discarded visible annotations/forms.
