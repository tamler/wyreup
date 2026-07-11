---
name: wyreup
description: Use when the user wants to transform files (images, PDFs, audio, video, text, data) locally without uploading to a cloud service — compress, convert, merge, redact, OCR, blur faces, strip metadata, chain steps, or watch a folder — via the wyreup CLI or the @wyreup/mcp MCP server. Also use when the user mentions wyreup by name.
---

# Wyreup

Wyreup runs 260+ privacy-first file tools on the user's machine. Nothing
uploads (hosted PRO tools are the explicit, credit-metered exception). Two
backends — prefer MCP when the server is configured, CLI otherwise. Lighter
single-backend variants of this skill exist (`wyreup-cli`, `wyreup-mcp`).

## CLI

Install `npm i -g @wyreup/cli` (or use `npx @wyreup/cli`). Every tool runs
through the `run` subcommand — tools are NOT flags:

```bash
wyreup run <tool-id> [inputs...] [-o out | -O outdir] [--param key=value ...]
```

```bash
wyreup run compress photo.jpg --param quality=70 -o small.jpg
wyreup run ocr scan.png -o scan.txt
wyreup run merge-pdf a.pdf b.pdf -o merged.pdf
cat notes.md | wyreup run markdown-to-html - -o notes.html   # '-' = stdin
```

Chains (each step's output feeds the next; step params in square brackets):

```bash
wyreup chain photo.heic --steps "convert[format=webp]|strip-exif|compress[quality=80]" -o clean.webp
```

Folder automation: `wyreup watch ~/Drop --steps "pdf-compress"` runs the chain
on every new file (results in `_wyreup-out/`).

Discovery — never guess tool ids: `wyreup list`, then
`wyreup run <tool-id> --help` for params.

## MCP

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

The server lists every tool with input types and params — trust that listing
over memory. Tools take file paths plus a `params` object; omitted params use
defaults. Tool metadata includes `chainSuggestions` (sensible next steps,
e.g. ocr → text-summarize); prefer those for multi-step goals, feeding each
result path into the next tool.

## Shared notes

- Model-backed tools (ocr, face-blur, transcribe, bg-remove…) download weights
  on first use; the cache is shared between CLI and MCP.
  CLI pre-download: `wyreup prefetch --group speech` (groups: core, ffmpeg,
  image-ai, nlp-standard, speech, vision-llm).
- PRO tools are hosted and credit-metered (upscale, image generation,
  long-PDF Q&A…) — they send the input to Wyreup's backend; say so when the
  user cares about locality. CLI auth: `wyreup login <apiKey>`;
  `wyreup balance` for credits. MCP auth: the `WYREUP_API_KEY` env var.
  Failed PRO runs auto-refund.

## Common mistakes

| Wrong | Right |
|---|---|
| `wyreup --compress photo.jpg` | `wyreup run compress photo.jpg` |
| `--quality 70` | `--param quality=70` |
| inventing flags like `--strip-meta` | chain the real tool: `--steps "convert[format=webp]\|strip-exif"` |
| guessing tool ids | `wyreup list` / read the MCP tool listing |
