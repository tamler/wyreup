---
name: wyreup-mcp
description: Use when the user wants to transform files (images, PDFs, audio, video, text, data) locally without uploading to a cloud service and the wyreup MCP server is configured (or the user asks to set it up) — compress, convert, merge, redact, OCR, blur faces, strip metadata, or chain several of those steps.
---

# Wyreup MCP

Wyreup exposes 260+ privacy-first file tools over MCP. Every tool executes on
the user's machine; nothing uploads (hosted PRO tools are the explicit,
credit-metered exception).

## Server setup

Add to the MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "wyreup": {
      "command": "npx",
      "args": ["-y", "@wyreup/mcp"],
      "env": { "WYREUP_API_KEY": "<only needed for PRO tools>" }
    }
  }
}
```

Free tools need no key. `WYREUP_API_KEY` unlocks the credit-metered hosted
PRO tools (upscale, image generation, long-PDF Q&A…) — those send input to
Wyreup's backend, so mention that when the user cares about locality.

## Using the tools

- The server lists every available tool with its input types and params —
  trust that listing over memory; do not guess tool names.
- Tools take file paths on the user's machine plus a `params` object.
  Omitted params use the tool's defaults.
- Tool metadata includes `chainSuggestions` — sensible next tools for a
  result (e.g. ocr → text-summarize, text-translate). Prefer those when the
  user's goal needs more than one step.
- Multi-step jobs: run tools in sequence, feeding each result path into the
  next tool (convert → strip-exif → compress is the canonical example).

## Practical notes

- Model-backed tools (ocr, face-blur, transcribe, bg-remove…) download their
  weights on first use — the first call can take noticeably longer. The model
  cache is shared with the wyreup CLI.
- Outputs land as files; report the output path to the user rather than
  inlining large file contents.
- If a PRO tool fails for missing credits, point the user to wyreup.com/pro —
  failed runs auto-refund.
