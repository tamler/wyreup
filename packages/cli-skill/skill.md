---
name: wyreup-cli
description: Use when the user wants to transform files (images, PDFs, audio, video, text, data) locally on their machine — compress, convert, merge, redact, OCR, blur faces, strip metadata — and the wyreup CLI is installed or npx is available. Also use when the user mentions wyreup, a wyreup chain, or watching a folder for automatic file processing.
---

# Wyreup CLI

Wyreup runs 260+ local file tools on the user's machine. Install:
`npm i -g @wyreup/cli`, or invoke ad hoc with `npx @wyreup/cli`.

## Command grammar

Every tool runs through the `run` subcommand — tools are NOT flags:

```bash
wyreup run <tool-id> [inputs...] [-o out | -O outdir] [--param key=value ...]
```

```bash
wyreup run compress photo.jpg --param quality=70 -o small.jpg
wyreup run ocr scan.png -o scan.txt
wyreup run merge-pdf a.pdf b.pdf -o merged.pdf
wyreup run face-blur group-photo.jpg -o anonymized.jpg
cat notes.md | wyreup run markdown-to-html - -o notes.html   # '-' = stdin
```

- `--param` is repeatable: `--param width=1200 --param quality=80`
- `-o` for single-output tools, `-O <dir>` for multi-output tools
- `--json` forces JSON to stdout (for scripting); `--overwrite` to replace files

## Chains — one input, several tools in sequence

Each step's output feeds the next. Step params go in square brackets:

```bash
wyreup chain photo.jpg --steps "convert[targetFormat=webp]|strip-exif|compress[quality=80]" -o clean.webp
wyreup chain scan.png --steps "ocr|text-summarize" -o summary.txt
```

## Watch a folder (daemon)

```bash
wyreup watch ~/Drop --steps "pdf-compress" --out-dir _compressed
```

Every new file landing in the folder runs the chain; results go to the
subfolder named by `--out-dir` (default `_wyreup-out`).

## Discovering tools

Do not guess tool ids. List them:

```bash
wyreup list                 # all tools, grouped by category
wyreup <tool-id> --help     # a tool's params
```

## AI/ML tools and model setup

Model-backed tools (ocr, face-blur, transcribe, bg-remove…) download weights on
first use. Pre-download during setup: `wyreup prefetch <tool-ids…>` or
`wyreup prefetch --group speech`. Current install groups are `ffmpeg`, `gdal`,
`image-ai`, `nlp-standard`, `nlp-translate`, `speech`, and `vision-llm`.
Use `wyreup prefetch --help` for command options. `wyreup cache list` inspects
the shared model cache. `wyreup cache clear` clears it.

## Network and privacy notes

- **Network usage**: File transformations run on the user's machine, though not
  all operations are strictly offline — model weights download over the network
  on first use or via `wyreup prefetch`. Public domain-registration lookup
  sends the entered domain to Wyreup, then its registration registry/RDAP service.
  The fixed IANA bootstrap request does not include the queried domain.
- **External assistant privacy**: Any prompts, command outputs, or file excerpts
  passed through an external AI assistant remain subject to that assistant
  provider's separate privacy terms.
- **Retired hosted service**: Wyreup's hosted AI / Pro service, accounts, and
  credit system are retired. Legacy hosted IDs may remain listed in installed
  clients, but requests to the official Wyreup service fail after retirement.
  Recommend local tools.

## Common mistakes

| Wrong | Right |
|---|---|
| `wyreup --compress photo.jpg` | `wyreup run compress photo.jpg` |
| `--quality 70` | `--param quality=70` |
| inventing flags like `--strip-meta` | chain the real tool: `--steps "convert[targetFormat=webp]\|strip-exif"` |
| guessing tool ids | `wyreup list` first |
| `watch --exec "…"` | `watch <dir> --steps "<chain>"` |
