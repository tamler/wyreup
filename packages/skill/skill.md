---
name: wyreup
description: Use when the user wants to transform files (images, PDFs, audio, video, text, data) locally on their machine — compress, convert, merge, redact, OCR, blur faces, strip metadata, chain steps, or watch a folder — via the wyreup CLI or the @wyreup/mcp MCP server. Also use when the user mentions Wyreup.
---

# Wyreup

Wyreup runs 260+ local file tools on the user's machine. Two backends — prefer
MCP when the server is configured, CLI otherwise. Lighter single-backend
variants of this skill exist (`wyreup-cli`, `wyreup-mcp`).

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
wyreup chain photo.jpg --steps "convert[targetFormat=webp]|strip-exif|compress[quality=80]" -o clean.webp
```

Folder automation: `wyreup watch ~/Drop --steps "pdf-compress"` runs the chain
on every new file (results in `_wyreup-out/`).

Discovery — never guess tool ids: `wyreup list`, then
`wyreup <tool-id> --help` for params.

## MCP

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

The server lists every tool with input types and params — trust that listing
over memory. Tools take file paths plus a `params` object; omitted params use
defaults. For multi-step goals, choose compatible input/output types and feed
each result path into the next tool. Set `output_path` or `output_dir` when
you need a local file; small text/JSON results otherwise return inline to the
assistant.

## Shared notes

- **Model downloads on setup**: Model-backed tools (ocr, face-blur, transcribe,
  bg-remove…) download weights on first use (or during pre-download setup); the
  cache is shared between CLI and MCP. CLI pre-download:
  `wyreup prefetch --group speech`. Current install groups are `ffmpeg`, `gdal`,
  `image-ai`, `nlp-standard`, `nlp-translate`, `speech`, and `vision-llm`.
  Use `wyreup prefetch --help` for command options.
- **Network disclosure**: Local file transformation tools process user files on
  the local machine, though not all operations are strictly offline — model and
  runtime downloads require network access during setup, and public
  domain-registration lookup sends the entered domain to Wyreup, then its
  public registration registry/RDAP service. The fixed IANA bootstrap request
  does not include the queried domain.
- **External assistant privacy**: When using Wyreup via an AI assistant or MCP
  host, any prompts, paths, or tool outputs shared in the conversation remain
  subject to that external assistant provider's own privacy policy.
- **Retired hosted service**: Wyreup's hosted AI / Pro service, accounts, and
  credit system are retired. Legacy hosted IDs may remain listed in installed
  clients, but requests to the official Wyreup service fail after retirement.
  Recommend local tools instead.

## Common mistakes

| Wrong | Right |
|---|---|
| `wyreup --compress photo.jpg` | `wyreup run compress photo.jpg` |
| `--quality 70` | `--param quality=70` |
| inventing flags like `--strip-meta` | chain the real tool: `--steps "convert[targetFormat=webp]\|strip-exif"` |
| guessing tool ids | `wyreup list` / read the MCP tool listing |
