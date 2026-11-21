---
'@wyreup/core': patch
---

Fix Redact PDF to remove covered text and image pixels instead of drawing recoverable visual covers. Rebuild pages locally at 144 DPI with extractable text outside the boxes, and discard source metadata, annotations, forms and attachments.
