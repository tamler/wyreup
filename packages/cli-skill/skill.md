---
name: wyreup-cli
description: Use when the user wants to transform files (images, PDFs, audio, video, text, data) locally without uploading to a cloud service — compress, convert, merge, redact, OCR, blur faces, strip metadata — and the wyreup CLI is installed or npx is available. Also use when the user mentions wyreup, a wyreup chain, or watching a folder for automatic file processing.
---

# Wyreup CLI

Wyreup runs 260+ privacy-first file tools on the user's machine. Nothing uploads
(hosted PRO tools are the explicit, credit-metered exception). Install:
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
wyreup chain photo.heic --steps "convert[format=webp]|strip-exif|compress[quality=80]" -o clean.webp
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
wyreup run <tool-id> --help # a tool's params
```

## AI/ML tools and offline prep

Model-backed tools (ocr, face-blur, transcribe, bg-remove…) download weights on
first use. Pre-download: `wyreup prefetch <tool-ids…>` or
`wyreup prefetch --group speech` (groups: core, ffmpeg, image-ai, nlp-standard,
speech, vision-llm). `wyreup cache` inspects/clears the shared model cache.

## PRO (hosted) tools

Credit-metered tools that need a real GPU (hosted upscale, image generation,
long-PDF Q&A…). They send the input to Wyreup's backend — say so if the user
cares about locality. Setup: `wyreup login <apiKey>` once;
`wyreup balance` shows credits. Everything else stays free and local.

## Common mistakes

| Wrong | Right |
|---|---|
| `wyreup --compress photo.jpg` | `wyreup run compress photo.jpg` |
| `--quality 70` | `--param quality=70` |
| inventing flags like `--strip-meta` | chain the real tool: `--steps "convert[format=webp]\|strip-exif"` |
| guessing tool ids | `wyreup list` first |
| `watch --exec "…"` | `watch <dir> --steps "<chain>"` |
