---
name: wyreup-mcp
description: Use when the user wants to transform files (images, PDFs, audio, video, text, data) locally on their machine and the wyreup MCP server is configured (or the user asks to set it up) — compress, convert, merge, redact, OCR, blur faces, strip metadata, or chain several of those steps.
---

# Wyreup MCP

Wyreup exposes 260+ local file tools over MCP that execute on the user's
machine.

## Server setup

Add to the MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "wyreup": {
      "command": "npx",
      "args": ["-y", "@wyreup/mcp"]
    }
  }
}
```

No API key or account is needed.

## Using the tools

- The server lists every available tool with its input types and params —
  trust that listing over memory; do not guess tool names.
- Tools take file paths on the user's machine plus a `params` object.
  Omitted params use the tool's defaults.
- For multi-step goals, choose tools with compatible input/output types from
  the actual server listing; do not assume it includes chain suggestions.
- Multi-step jobs: run tools in sequence, feeding each result path into the
  next tool (convert → strip-exif → compress is the canonical example).

## Practical notes

- **Model downloads on setup**: Model-backed tools (ocr, face-blur, transcribe,
  bg-remove…) download their weights on first use — the first call can take
  noticeably longer. The model cache is shared with the wyreup CLI.
- **Network disclosure**: Local file tools process user files on the local
  machine, though not all operations are strictly offline — model downloads
  use the network on setup/first run. Public domain-registration lookup sends
  the entered domain to Wyreup, then its registration registry/RDAP service.
  The fixed IANA bootstrap request does not include the queried domain.
- **External assistant privacy**: Set `output_path` or `output_dir` to save
  results locally, especially for sensitive text. Small text/JSON results
  otherwise return inline; binary results require an output path. Any text, paths,
  or tool results sent to the MCP client/assistant remain governed by that
  external assistant provider's own privacy policy.
- **Retired hosted service**: Wyreup's hosted AI / Pro service, accounts, and
  credits are retired. Legacy hosted IDs may remain listed in installed clients,
  but requests to the official Wyreup service fail after retirement. Recommend
  local tools instead.
