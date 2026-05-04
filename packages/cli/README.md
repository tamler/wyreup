# @wyreup/cli

Wyreup CLI — privacy-first file tools from the shell. Same engine as [wyreup.com](https://wyreup.com), fully offline and scriptable.

## Install

```bash
npm install -g @wyreup/cli
```

Requires Node >= 20.

## Quick start

```bash
# One-off (no install)
npx @wyreup/cli compress photo.jpg -o compressed.jpg

# List all available tools
wyreup list

# Run a tool
wyreup <tool-id> [inputs...] [options]

# Explicit run subcommand (same thing)
wyreup run <tool-id> [inputs...] [options]
```

## Run a tool

```bash
# Compress an image (quality 1-100)
wyreup compress photo.jpg --quality 80 -o photo-small.jpg

# Convert image format
wyreup convert image.png --format webp -o image.webp

# Merge PDFs
wyreup merge-pdf a.pdf b.pdf c.pdf -o merged.pdf

# Split a PDF (multi-output: use -O for directory)
wyreup split-pdf book.pdf -O pages/

# Generate a QR code (no input needed)
wyreup qr "https://wyreup.com" -o qr.png

# Hash a file (prints JSON to stdout)
wyreup hash document.pdf --algorithm sha256

# Strip EXIF metadata
wyreup strip-exif photo.jpg -o clean.jpg

# Blur faces
wyreup face-blur group.jpg -o anon.jpg

# OCR: extract text from an image
wyreup ocr scan.png -o text.txt
```

### Flags

| Flag | Description |
|------|-------------|
| `-o, --output <path>` | Output file path (single-output tools) |
| `-O, --output-dir <dir>` | Output directory (multi-output tools like split-pdf) |
| `--param <key=value>` | Tool parameter override, repeatable |
| `--input-format <mime>` | Override input MIME type (useful when piping) |
| `--json` | Force JSON output to stdout |
| `--verbose` | Print progress messages to stderr |

Per-tool named flags are also available for tools with a `paramSchema`:

```bash
wyreup compress photo.jpg --quality 75 -o out.jpg
wyreup convert image.png --format webp -o out.webp
wyreup hash file.bin --algorithm sha512
```

## Chain tools

Pipe the output of one tool into the next:

```bash
# Strip EXIF then compress
wyreup chain photo.jpg --steps "strip-exif|compress[quality=75]" -o clean.jpg

# Three-step chain
wyreup chain photo.jpg --steps "strip-exif|face-blur|compress[quality=80]" -o shared.jpg

# Run from a Wyreup chain URL
wyreup chain photo.jpg \
  --from-url "https://wyreup.com/chain/run?steps=strip-exif|compress[quality=80]" \
  -o out.jpg

# Save each step's output for debugging
wyreup chain photo.jpg --steps "strip-exif|compress" -o out.jpg \
  --save-intermediates /tmp/chain-debug/
```

### Chain string syntax

```
tool-id                        # run with defaults
tool-id[key=val,key2=val2]     # run with param overrides
tool1|tool2|tool3              # pipe output of each step to next
```

### Preview a chain before running it

`--dry-run` parses the chain, prints the per-step plan, flags any MIME
mismatches between adjacent steps, and reports the install-group totals
that will need to download on first run. Reads no files; produces no
outputs; exits 0 regardless of mismatches (warnings are advisory).

```bash
wyreup chain --steps "transcribe|text-summarize" --dry-run
# Chain plan — 2 steps
#   1. transcribe
#        accepts: audio/wav, audio/mpeg, audio/mp4, ...
#        output:  text/plain
#   2. text-summarize
#        accepts: text/plain
#        output:  text/plain
#
# Lazy installs needed on first run:
#   speech               ~238 MB
#   nlp-standard         ~76 MB
#   total                ~315 MB
```

Useful for sanity-checking a chain string from the share URL or kit
JSON before letting it pull a few hundred MB of models.

## Pilot a watcher before unleashing it

`wyreup watch --max-files N` runs the chain on at most N files (counted
by completed runs — successes plus failures; skipped non-matching files
don't count) and exits cleanly. Use it to verify a chain's output before
letting the daemon run on a thousand-file drop:

```bash
# Try the chain on the first 5 PNGs that land in ./drops
wyreup watch ./drops --steps "strip-exif|compress" --max-files 5

# Same flag works with a kit-stored chain
wyreup watch ./inbox --from-kit ~/wyreup-kit.json --name "photo cleanup" --max-files 10
```

The output subfolder (`_wyreup-out/` by default) is excluded from the
watch, so re-runs of the watcher don't reprocess their own outputs.

## Stdin/stdout piping

Single-input, single-output tools support Unix pipes:

```bash
# Strip EXIF via pipe
cat photo.jpg | wyreup strip-exif --input-format image/jpeg > clean.jpg

# Chain via pipes
cat photo.jpg | wyreup strip-exif --input-format image/jpeg \
  | wyreup compress --quality 80 --input-format image/jpeg > final.jpg

# Hash stdin
cat document.pdf | wyreup hash --input-format application/pdf
```

Multi-output tools (e.g. `split-pdf`) cannot pipe to stdout — use `-O <dir>`.

## Install an agent skill

Install the Wyreup skill into your agent's skills directory so Claude Code, Aider, or any skill-compatible agent knows how to use the tools:

```bash
# Interactive
wyreup install-skill

# Non-interactive
wyreup install-skill --variant combined --location project -y

# List installed skills
wyreup install-skill --list
```

## Help

```bash
wyreup --help
wyreup run --help
wyreup chain --help
wyreup <tool-id> --help
```

## Exit codes

Standardized so shell scripts wrapping `wyreup` can differentiate
"retry with different args" from "infrastructure problem":

| Code | Meaning | Examples |
|------|---------|----------|
| 0 | Success | Tool ran, output written |
| 1 | User error | Unknown tool, missing input file, bad chain syntax, MIME mismatch |
| 2 | System error | Filesystem permission denied, network unreachable, OOM |

## Tool categories

Tools span image, PDF, audio, video, text, dev, geo, and other categories. Run `wyreup list` for the live inventory — counts drift, this section is illustrative.

| Category | Sample tools |
|----------|-------------|
| Image | compress, convert, crop, resize, rotate-image, flip-image, watermark, face-blur, strip-exif, image-diff, ocr, svg-to-png, favicon, color-palette, grayscale, sepia, bg-remove, upscale-2x |
| PDF | merge-pdf, split-pdf, pdf-compress, rotate-pdf, reorder-pdf, pdf-extract-pages, pdf-delete-pages, page-numbers-pdf, pdf-encrypt, pdf-decrypt, pdf-redact, pdf-extract-tables, pdf-to-text, pdf-to-image, image-to-pdf, watermark-pdf, pdf-info, pdf-metadata, pdf-crop |
| Audio | audio-enhance, convert-audio, extract-audio, trim-media |
| Video | convert-video, compress-video, video-to-gif, video-concat, video-add-text, video-speed, burn-subtitles |
| Text/Dev | json-formatter, base64, url-encoder, hash, markdown-to-html, html-to-markdown, text-diff, word-counter, regex-tester, timestamp-converter, color-converter, case-converter, slug, jwt-decoder, sql-formatter, xml-formatter, css-formatter, cron-parser |
| Create | qr, uuid-generator, password-generator, lorem-ipsum, barcode |
| Finance | compound-interest, investment-dca, percentage-calculator, date-calculator |
| Archive | zip-create, zip-extract, zip-info |

## Privacy

Everything runs locally on your machine. No files leave your device. No network calls during tool execution.

## More

- [wyreup.com](https://wyreup.com) — browser version, no install needed
- [MCP server (@wyreup/mcp)](https://wyreup.com/mcp) — agent interface for Claude Code / Claude Desktop
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
