---
'@wyreup/core': major
'@wyreup/cli': major
'@wyreup/mcp': major
'@wyreup/exceljs': minor
'@wyreup/mammoth': minor
---

Require Node.js 22.13.0 or newer and upgrade vulnerable document, image, markup, model and MCP dependencies. AI tools retain the official optional @huggingface/transformers peer in core, with the runtime included in CLI and MCP. Update transitive dependencies in existing consumer lockfiles with npm update or pnpm update --depth Infinity.

Spreadsheet and DOCX tools use maintained, integrity-pinned library distributions with patched dependencies and audited browser bundles. Spreadsheet UUID generation uses native cryptographic UUIDs; DOCX includes the library API without the unrelated standalone command-line parser.

Upgrade to OpenPGP.js 6. Standard v4 keys, protected keys, armored/binary messages and detached signatures remain interoperable. Experimental legacy v5 keys are rejected by the upstream default. Browser cryptography requires a secure context.

Correct image similarity to process decoded image pixels with the image-feature-extraction pipeline, keep quantized model selection consistent across runtimes, and adapt PDF.js lifecycle and DOCX inputs for Node and browsers.
