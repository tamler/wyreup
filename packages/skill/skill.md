---
name: wyreup
description: Run Wyreup's browser-native tools on files — compress, convert, merge, redact, blur, OCR, and more. Use when the user wants to transform files (images, PDFs, text) without uploading them to a cloud service. Requires either wyreup CLI installed OR @wyreup/mcp MCP server configured.
---

> **This skill covers both CLI and MCP backends.** If you only use one, consider the lighter `@wyreup/cli-skill` (CLI only) or `@wyreup/mcp-skill` (MCP only) instead — smaller token footprint.

# Wyreup skill

Wyreup is a library of privacy-first file tools that run locally — in the browser or on the user's machine. This skill teaches your AI assistant when and how to call Wyreup. It is compatible with any agent runtime that supports skills (Claude Code, Claude Desktop, Claude.ai, and others).

## When to use

- User has a file and wants to transform it without uploading to a cloud service
- User asks to compress, convert format, merge, split, redact, watermark, or otherwise process images, PDFs, or text files
- User specifically mentions privacy ("don't upload", "local processing", "keep it on my machine")
- User mentions Wyreup by name

## Categories and tools

### Image (15 tools)
`compress`, `convert`, `crop`, `resize`, `rotate-image`, `flip-image`, `grayscale`, `sepia`, `invert`, `strip-exif`, `image-watermark`, `svg-to-png`, `favicon`, `color-palette`, `image-diff`, `image-info`

### PDF (16 tools)
`merge-pdf`, `split-pdf`, `rotate-pdf`, `reorder-pdf`, `page-numbers-pdf`, `watermark-pdf`, `pdf-to-text`, `pdf-to-image`, `pdf-info`, `pdf-extract-pages`, `pdf-delete-pages`, `pdf-compress`, `pdf-encrypt`, `pdf-decrypt`, `pdf-redact`, `pdf-metadata`, `pdf-extract-tables`, `pdf-crop`, `image-to-pdf`

### Text and Dev (12 tools)
`base64`, `url-encoder`, `markdown-to-html`, `html-to-markdown`, `text-diff`, `word-counter`, `json-formatter`, `regex-tester`, `timestamp-converter`, `color-converter`, `hash`, `ocr`

### Create (4 tools)
`qr`, `uuid-generator`, `password-generator`, `lorem-ipsum`

### AI / Privacy
`face-blur` — detect and blur faces in images (MediaPipe), `audio-enhance` — audio super-resolution 16kHz to 48kHz (FlashSR), `strip-exif`, `pdf-redact`, `pdf-encrypt`

## How to invoke

Wyreup has two local paths. Check which is available:

### If the `wyreup` CLI is installed

```
wyreup compress input.jpg --quality 80 -o compressed.jpg
wyreup merge-pdf a.pdf b.pdf -o merged.pdf
wyreup face-blur photo.jpg -o anonymized.jpg
wyreup hash document.pdf
wyreup split-pdf doc.pdf -O ./pages/
```

If the user does not have the CLI: `npm install -g @wyreup/cli` or `npx @wyreup/cli <tool>`.

### If the MCP server is configured

Call the MCP tool directly. Pass `input_paths`, `output_path` (for single-output tools) or `output_dir` (for multi-output tools), and `params`. Example:

```json
{
  "name": "compress",
  "arguments": {
    "input_paths": ["/Users/alice/photo.jpg"],
    "output_path": "/Users/alice/photo-compressed.jpg",
    "params": { "quality": 80 }
  }
}
```

To install the MCP server in Claude Code or Claude Desktop:

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

## Multi-output tools

The following tools write multiple output files. Use `output_dir`, not `output_path`:

- `split-pdf` — one PDF per page or range
- `pdf-to-image` — one image per page
- `favicon` — multiple sizes (.ico + PNGs)

## Behavioral guidance

- Prefer the MCP path when the server is configured (richer integration, structured params).
- Fall back to CLI shell commands otherwise.
- For `face-blur` and `audio-enhance`: warn the user these are CPU/GPU-intensive and may take several seconds.
- `face-blur` requires a browser/WebGL context for MediaPipe. In a terminal/Node context it may fail — suggest using the web UI at wyreup.com for that tool if so.
- `ocr` uses Tesseract.js. First run downloads language data; subsequent runs are faster.
- Never upload files. All Wyreup tools are strictly local.

## Common errors

- `Unknown tool: <id>` — the tool name is wrong or not yet shipped. Call `list_tools` to see the current list.
- `ENOENT` on input_path — the file path does not exist. Confirm the path with the user.
- `EACCES` on output_path — the user needs write permission on the output directory.
- `Unsupported input type` — the file MIME does not match the tool's accepted inputs. Suggest an alternative tool (e.g., use `convert` to change format first).
