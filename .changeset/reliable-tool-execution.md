---
'@wyreup/core': patch
'@wyreup/cli': patch
'@wyreup/mcp': patch
---

Preserve every file through one-input chain steps, enforce declared input limits, harden PDF processing, correct AI model pipeline selection, keep CLI watch and fallback egress lifecycle safe, and make MCP worker execution validate its paths, sizes, version, and model CDN egress. Filesystem-backed MCP calls now require macOS, Linux, or WSL and fail closed on native Windows, where Node cannot verify the required ACL and handle-relative path guarantees.

PDF compression reports a processing error when every attempted supported image fails to decode or encode. It still preserves the original when successful re-encoding does not reduce size, and skips unsupported image encodings.
