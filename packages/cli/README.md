# @wyreup/cli

Wyreup CLI — privacy-first tools from the shell. Same engine as [wyreup.com](https://wyreup.com), with local processing, public network lookups, and optional hosted PRO tools.

## Install

```bash
npm install -g @wyreup/cli
```

Requires Node >= 22.13.0. Model tools install the official Transformers.js runtime.
After upgrading an existing installation, refresh its transitive lockfile and
reinstall, then run a full dependency audit; old nested native dependencies can
otherwise remain pinned. See the [core migration guidance](../core/README.md)
for model dependency floors and the OpenPGP.js 6 boundary: standard v4 material
is supported, while experimental legacy v5 key packets are rejected.

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
wyreup qr --text "https://wyreup.com" -o qr.png

# Hash a file (prints JSON to stdout)
wyreup hash document.pdf --algorithms '["SHA-256"]'

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
| `--params-json <path>` | One local regular UTF-8 JSON file, at most 1 MiB, without a BOM; links, devices and stdin files are refused |
| `--input-format <mime>` | Override input MIME type (useful when piping) |
| `--json` | Force JSON output to stdout |
| `--verbose` | Print progress messages to stderr |

Per-tool named flags are also available for tools with a `paramSchema`:

```bash
wyreup compress photo.jpg --quality 75 -o out.jpg
wyreup convert image.png --format webp -o out.webp
wyreup hash file.bin --algorithms '["SHA-512"]'
```

Direct runs preserve declared parameter types: a cron minute `5` is a string,
while a numeric field accepts a complete finite decimal, including fractions
and exponents. Boolean flags take `true` or `false`; ambiguous string/number
enum spellings require the JSON file. Precedence is tool defaults, JSON file,
repeatable `--param` values in arrival order, then named flags. Omitted flags
keep file values. Reviewed strict tools reject unknown keys; legacy tools keep
their existing behavior. Core validators enforce active fields and row rules.

```bash
wyreup run cron-from-text --param mode=fields --param minute=5 \
  --param currentDate=2026-01-01T00:00:00Z --param nextCount=1
wyreup loan-calculator --param APR=0
wyreup bank-statement-to-csv statement.pdf --params-json reviewed-bank.json -o statement.csv
```

The parameter file must be an object, with bounded inert JSON: depth at most
20, at most 20,000 scalar values and 1 MiB serialized. It is not a URL or stdin.
Bank mappings and review decisions are native JSON objects/arrays; `opening`,
`closing` and `statementYear` may be explicitly `null`. Bank export still
requires the actual mapping, explicit review decisions and acknowledgment.
For Lorem Ipsum, the engine admits paragraphs through 1000 and sentences per
paragraph through 100, including fractional counts such as 2.5; its loops then
produce three paragraphs/sentences. `wordsPerSentence` remains a JSON array.

Finance row fields and the four configuration generators instead accept **JSON
strings containing row arrays**. Do not supply arrays to these string fields
or encode their contents twice. For example, `robots-params.json` can contain:

```json
{"groupsJson":"[{\"userAgent\":\"*\",\"rule\":\"Disallow\",\"path\":\"/private\"}]","sitemapsJson":"[]"}
```

Run it with `wyreup robots-txt-generator --params-json robots-params.json`.
`groupsJson` columns are `userAgent,rule,path` (`Allow`/`Disallow`, up to 1000
rows); `sitemapsJson` has `url` (up to 20). CSP `directivesJson` has
`directive,sources` (up to 10); hreflang `linksJson` has `language,url`; nginx
`redirectsJson` has `source,destination,status` (301/302/307/308). Hreflang and
nginx allow up to 1000 rows. Each string is bounded to 100,000 characters; the
core checks exact columns, permitted values and URL/path rules. Shorthand
`--help` describes the specific rules and finance rows, currencies and rates.

Code Beautifier supports JavaScript, CSS, XML, SQL, JSON and HTML; TypeScript
is unsupported. Output file extensions follow each actual output MIME.
Web-only capture/session tools are unavailable on CLI.

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

Chain strings keep their existing simple coercion. Arrays, row JSON,
comma-rich values and exact numeric-looking strings require a direct typed
run; `--params-json` does not redesign the chain parser.

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
| Image | compress, convert, crop, resize, rotate-image, flip-image, watermark, face-blur, strip-exif, image-diff, ocr, ocr-pro, svg-to-png, favicon, color-palette, grayscale, sepia, bg-remove, upscale-2x, color-blind-simulator |
| PDF | merge-pdf, split-pdf, pdf-compress, rotate-pdf, reorder-pdf, pdf-extract-pages, pdf-delete-pages, pdf-extract-images, page-numbers-pdf, pdf-encrypt, pdf-decrypt, pdf-redact, pdf-extract-tables, pdf-to-text, pdf-to-image, image-to-pdf, watermark-pdf, pdf-info, pdf-metadata, pdf-crop, pdf-suspicious |
| Audio | audio-enhance, convert-audio, extract-audio, transcribe, trim-media, record-audio |
| Video | convert-video, compress-video, video-to-gif, video-concat, video-add-text, video-speed, burn-subtitles, video-color-correct |
| Text | text-diff, text-redact, text-suspicious, text-confusable, text-template, text-summarize, text-translate, text-sentiment, text-stats, text-readability, word-counter, unicode-info, unicode-normalize, markdown-to-html, markdown-toc, markdown-frontmatter, html-to-markdown, html-clean, html-extract-links |
| Dev | json-formatter, json-diff, json-merge, json-flatten, json-unflatten, json-path, json-schema-validate, json-schema-infer, xml-formatter, xml-to-json, json-to-xml, yaml-validate, sql-formatter, css-formatter, css-minify, html-formatter, html-minify, regex-tester, cron-parser, jwt-decoder, openapi-validate, package-json-validate |
| Security / auth | hash, hmac, base32, base58, base64, totp-code, hotp-code, jwt-sign, signed-url, signed-cookie-decode, backup-codes, api-key-format, license-key, otpauth-uri, webhook-verify, webhook-replay, file-fingerprint, password-strength, password-generator |
| Privacy | strip-exif, face-blur, pgp-encrypt, pgp-decrypt, pgp-sign, pgp-verify, pgp-armor |
| Data | csv-json, csv-info, csv-deduplicate, csv-merge, csv-diff, csv-to-json-schema, csv-template, excel-to-csv, excel-to-json, csv-to-excel, json-to-excel, excel-info, merge-workbooks, split-sheets, frontmatter-to-csv |
| Geo | csv-to-geojson, kml-to-geojson, gpx-to-geojson, geojson-to-kml, gpx-to-kml, shapefile-to-geojson, convert-geo |
| Create | qr, qr-reader, uuid-generator, password-generator, lorem-ipsum, barcode |
| Finance | compound-interest, investment-dca, percentage-calculator, date-calculator |
| Archive | zip-create, zip-extract, zip-info |

## Privacy

Local file-processing tools keep their inputs on your machine. Setup may download packages or models; offline use depends on the tool and cached assets. Hosted PRO tools send their declared inputs for remote processing.

Domain Registration Age is a free network lookup. The entered domain is sent to Wyreup, which reads the public IANA bootstrap without sending IANA the queried domain, then sends the domain to its registration registry. No API key or login is required; registration age may differ from first-ever use. `wyreup run domain-age-checker --param domain=example.com` uses the trusted `WYREUP_ORIGIN` (default `https://wyreup.com`), as do applicable chains. The normal egress lock still blocks direct registry requests.

Public lookups use temporary rotating HMAC network counters and random short-lived reservation tokens. Shared networks can reach public limits together. Wyreup keeps no domain-query database; expiry cleanup occurs on later requests, and platform logs and backups retain their own history. Your shell history, saved chains, output files, or operator exports may retain the domain and result.

## Security & environment

The CLI ships with defense-in-depth on every tool invocation. Defaults are conservative; tune as needed.

With the fetch lock enabled, redirects are followed only for HTTP 301, 302, 303, 307 and 308, and only to the trusted `WYREUP_ORIGIN` or configured model origins. POST requests on 301/302 and methods other than GET/HEAD on 303 become GET requests with the body and body headers removed. A redirect that would retain a non-null request body, including on 307/308, is refused with `Redirect would replay a request body`. Body-free model downloads can follow redirects between allowed origins.

### Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `WYREUP_API_KEY` | — | Bearer token for Pro tools and account commands. Read via `wyreup login` and stored in `~/.wyreup/config.json`. |
| `WYREUP_ORIGIN` | `https://wyreup.com` | Trusted public lookup, Pro endpoint, and auth origin, allowed alongside configured model origins by the fetch lock. |
| `WYREUP_MODEL_CDN` | `https://models.wyreup.com` | Model weight mirror URL, or `disabled` to use configured upstream model origins with the same fetch-lock setting. |
| `WYREUP_ALLOW_DISABLE_TIMEOUT` | — | `1` permits `--timeout 0` (disable). |
| `WYREUP_DISABLE_EGRESS_LOCK` | — | `1` skips installing the `fetch` egress lock. |

### Per-command flags

`wyreup run` and `wyreup chain` accept:

- `--overwrite` — overwrite existing output files (default: refuse)
- `--timeout <ms>` — max runtime per tool, default 300000, range `[1, 3600000]`

### What this does NOT defend against

- Raw socket egress (`node:http`/`node:https`/`node:net`/native bindings)
- Tools that spawn their own subprocesses
- DNS-channel exfiltration
- Hostile `~/.wyreup/config.json` (if another process can write to your home, you have bigger problems)

See `docs/superpowers/specs/2026-05-24-wyreup-mcp-hardening-design.md § Security limitations` for the full list — the CLI inherits the same limitations as MCP.

## More

- [wyreup.com](https://wyreup.com) — browser version, no install needed
- [MCP server (@wyreup/mcp)](https://wyreup.com/mcp) — agent interface for Claude Code / Claude Desktop
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
