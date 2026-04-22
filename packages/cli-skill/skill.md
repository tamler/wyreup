---
name: wyreup-cli
description: Invoke Wyreup's 72+ file tools via the `wyreup` CLI. Use when the user wants to compress, convert, redact, or otherwise process files on the local filesystem without uploading them. Requires the `wyreup` CLI to be installed (check with `which wyreup` or `wyreup --help`).
---

# Wyreup CLI skill

Wyreup is a library of privacy-first file tools that run locally. This skill is for **shell/CLI contexts** — terminal agents or any agent runtime that invokes binaries (Claude Code, Aider, and similar). It is smaller than `@wyreup/skill` because it omits MCP guidance and JSON schemas.

> If your agent context supports MCP (structured tool calls), use `@wyreup/mcp-skill` instead — it covers MCP invocation shapes only.
> For both CLI and MCP guidance in one file, use `@wyreup/skill`.

## When to use

- User has a local file path and wants a command they can run or script
- User mentions "compress this", "convert that", "redact this PDF"
- User wants to process files without uploading them to a cloud service
- User mentions privacy, local processing, or "keep it on my machine"
- User wants a shell one-liner or batch script

## Install check

Before invoking, confirm the CLI is available:

```bash
which wyreup
# or
command -v wyreup
```

If missing, tell the user to install:

```bash
npm install -g @wyreup/cli
# one-off without installing:
npx @wyreup/cli <tool> <args>
```

## Categories and CLI commands

### Image tools

- `compress` — Compress JPEG/PNG/WebP images
  ```bash
  wyreup compress photo.jpg --quality 80 -o photo-compressed.jpg
  ```
- `convert` — Convert between image formats (HEIC, JPG, PNG, WebP, AVIF, TIFF)
  ```bash
  wyreup convert image.heic --format jpg -o image.jpg
  ```
- `crop` — Crop to a region
  ```bash
  wyreup crop photo.jpg --x 100 --y 100 --width 400 --height 300 -o cropped.jpg
  ```
- `resize` — Resize to specified dimensions
  ```bash
  wyreup resize photo.jpg --width 800 --height 600 -o resized.jpg
  ```
- `rotate-image` — Rotate by degrees
  ```bash
  wyreup rotate-image photo.jpg --degrees 90 -o rotated.jpg
  ```
- `flip-image` — Flip horizontally or vertically
  ```bash
  wyreup flip-image photo.jpg --direction horizontal -o flipped.jpg
  ```
- `grayscale` — Convert to grayscale
  ```bash
  wyreup grayscale photo.jpg -o gray.jpg
  ```
- `sepia` — Apply sepia tone
  ```bash
  wyreup sepia photo.jpg -o sepia.jpg
  ```
- `invert` — Invert colors
  ```bash
  wyreup invert photo.jpg -o inverted.jpg
  ```
- `strip-exif` — Remove EXIF metadata from images
  ```bash
  wyreup strip-exif photo.jpg -o clean.jpg
  ```
- `image-watermark` — Add text watermark to an image
  ```bash
  wyreup image-watermark photo.jpg --text "Confidential" -o watermarked.jpg
  ```
- `svg-to-png` — Convert SVG to PNG
  ```bash
  wyreup svg-to-png icon.svg --width 256 -o icon.png
  ```
- `favicon` — Generate favicon in multiple sizes (multi-output)
  ```bash
  wyreup favicon logo.png -O ./favicon-dir/
  ```
- `color-palette` — Extract dominant colors from an image
  ```bash
  wyreup color-palette photo.jpg | jq .
  ```
- `image-diff` — Visual diff between two images
  ```bash
  wyreup image-diff before.png after.png -o diff.png
  ```
- `image-info` — Get image metadata as JSON
  ```bash
  wyreup image-info photo.jpg | jq .width
  ```

### PDF tools

- `merge-pdf` — Merge multiple PDFs into one
  ```bash
  wyreup merge-pdf a.pdf b.pdf c.pdf -o merged.pdf
  ```
- `split-pdf` — Split PDF into one file per page (multi-output)
  ```bash
  wyreup split-pdf doc.pdf -O ./pages/
  ```
- `rotate-pdf` — Rotate PDF pages
  ```bash
  wyreup rotate-pdf doc.pdf --degrees 90 -o rotated.pdf
  ```
- `reorder-pdf` — Reorder pages by index
  ```bash
  wyreup reorder-pdf doc.pdf --order 3,1,2 -o reordered.pdf
  ```
- `page-numbers-pdf` — Add page numbers
  ```bash
  wyreup page-numbers-pdf doc.pdf -o numbered.pdf
  ```
- `watermark-pdf` — Add text watermark to PDF pages
  ```bash
  wyreup watermark-pdf doc.pdf --text "DRAFT" -o draft.pdf
  ```
- `pdf-to-text` — Extract text content from PDF
  ```bash
  wyreup pdf-to-text doc.pdf -o doc.txt
  ```
- `pdf-to-image` — Render PDF pages as images (multi-output)
  ```bash
  wyreup pdf-to-image doc.pdf -O ./images/
  ```
- `pdf-info` — Get PDF metadata as JSON
  ```bash
  wyreup pdf-info doc.pdf | jq .pageCount
  ```
- `pdf-extract-pages` — Extract a range of pages
  ```bash
  wyreup pdf-extract-pages doc.pdf --pages 1-5 -o extract.pdf
  ```
- `pdf-delete-pages` — Delete specific pages
  ```bash
  wyreup pdf-delete-pages doc.pdf --pages 3,7 -o trimmed.pdf
  ```
- `pdf-compress` — Reduce PDF file size
  ```bash
  wyreup pdf-compress large.pdf -o small.pdf
  ```
- `pdf-encrypt` — Password-protect a PDF
  ```bash
  wyreup pdf-encrypt doc.pdf --password "s3cret" -o protected.pdf
  ```
- `pdf-decrypt` — Remove PDF password
  ```bash
  wyreup pdf-decrypt protected.pdf --password "s3cret" -o open.pdf
  ```
- `pdf-redact` — Black out text regions
  ```bash
  wyreup pdf-redact doc.pdf --regions '[[50,100,300,120]]' -o redacted.pdf
  ```
- `pdf-metadata` — Read or write PDF metadata
  ```bash
  wyreup pdf-metadata doc.pdf | jq .title
  ```
- `pdf-extract-tables` — Extract tables from PDF as JSON
  ```bash
  wyreup pdf-extract-tables report.pdf | jq .
  ```
- `pdf-crop` — Crop PDF pages to a box
  ```bash
  wyreup pdf-crop doc.pdf --box '{"x":0,"y":0,"width":400,"height":600}' -o cropped.pdf
  ```
- `image-to-pdf` — Convert images to a PDF
  ```bash
  wyreup image-to-pdf photo1.jpg photo2.jpg -o photos.pdf
  ```

### Text and dev tools

- `base64` — Encode or decode base64
  ```bash
  wyreup base64 file.bin --mode encode | jq .encoded
  ```
- `url-encoder` — Encode or decode URL strings
  ```bash
  wyreup url-encoder --text "hello world?" --mode encode | jq .result
  ```
- `markdown-to-html` — Convert Markdown to HTML
  ```bash
  wyreup markdown-to-html doc.md -o doc.html
  ```
- `html-to-markdown` — Convert HTML to Markdown
  ```bash
  wyreup html-to-markdown page.html -o page.md
  ```
- `text-diff` — Show diff between two text files
  ```bash
  wyreup text-diff old.txt new.txt | jq .
  ```
- `word-counter` — Count words, characters, sentences
  ```bash
  wyreup word-counter essay.txt | jq .words
  ```
- `json-formatter` — Format or minify JSON
  ```bash
  wyreup json-formatter data.json --indent 2 -o pretty.json
  ```
- `regex-tester` — Test a regex pattern against text
  ```bash
  wyreup regex-tester --pattern '\d+' --text 'abc 123 def' | jq .matches
  ```
- `timestamp-converter` — Convert Unix timestamps to human dates
  ```bash
  wyreup timestamp-converter --timestamp 1700000000 | jq .iso
  ```
- `color-converter` — Convert between color formats (hex, rgb, hsl)
  ```bash
  wyreup color-converter --color '#FFB000' | jq .
  ```
- `hash` — Hash a file (MD5, SHA-256, SHA-512)
  ```bash
  wyreup hash file.bin | jq .sha256
  ```
- `ocr` — Extract text from images using Tesseract
  ```bash
  wyreup ocr scan.jpg -o scan.txt
  ```
- `csv-json` — Convert CSV to JSON or vice versa
  ```bash
  wyreup csv-json data.csv -o data.json
  ```
- `case-converter` — Convert text case (camel, snake, kebab, etc.)
  ```bash
  wyreup case-converter --text "hello world" --to camelCase | jq .result
  ```
- `slug` — Convert text to URL slug
  ```bash
  wyreup slug --text "Hello World!" | jq .result
  ```
- `json-yaml` — Convert between JSON and YAML
  ```bash
  wyreup json-yaml data.json -o data.yaml
  ```
- `number-base-converter` — Convert numbers between bases
  ```bash
  wyreup number-base-converter --value 255 --from 10 --to 16 | jq .result
  ```
- `jwt-decoder` — Decode a JWT token (no verification)
  ```bash
  wyreup jwt-decoder --token "eyJ..." | jq .payload
  ```
- `sql-formatter` — Format SQL queries
  ```bash
  wyreup sql-formatter query.sql -o formatted.sql
  ```
- `xml-formatter` — Format XML
  ```bash
  wyreup xml-formatter data.xml -o pretty.xml
  ```
- `html-formatter` — Format HTML
  ```bash
  wyreup html-formatter page.html -o pretty.html
  ```
- `css-formatter` — Format CSS
  ```bash
  wyreup css-formatter styles.css -o pretty.css
  ```
- `cron-parser` — Parse and describe cron expressions
  ```bash
  wyreup cron-parser --expression "0 9 * * MON-FRI" | jq .description
  ```
- `qr-reader` — Decode QR code from image
  ```bash
  wyreup qr-reader qr.png | jq .text
  ```
- `svg-optimizer` — Optimize SVG file size
  ```bash
  wyreup svg-optimizer icon.svg -o icon.min.svg
  ```

### Create tools

- `qr` — Generate a QR code image
  ```bash
  wyreup qr --text "https://wyreup.com" -o qr.png
  ```
- `uuid-generator` — Generate UUID v4 identifiers
  ```bash
  wyreup uuid-generator --count 5 | jq .
  ```
- `password-generator` — Generate random passwords
  ```bash
  wyreup password-generator --length 24 --count 3 | jq .
  ```
- `lorem-ipsum` — Generate placeholder text
  ```bash
  wyreup lorem-ipsum --paragraphs 2 | jq .text
  ```
- `calculator` — Evaluate arithmetic and scientific expressions
  ```bash
  wyreup calculator --expression "sqrt(2) * pi" | jq .result
  ```
- `unit-converter` — Convert between units of measurement
  ```bash
  wyreup unit-converter --value 5 --from ft --to m | jq .formatted
  ```
- `percentage-calculator` — Calculate percentages
  ```bash
  wyreup percentage-calculator --mode percent-of --value 15 --base 200 | jq .formatted
  ```
- `date-calculator` — Calculate date differences and add/subtract time
  ```bash
  wyreup date-calculator --mode diff --date1 2026-01-01 --date2 2026-12-31 | jq .totalDays
  ```

### Finance tools

- `compound-interest` — Calculate compound interest with contributions
  ```bash
  wyreup compound-interest --principal 10000 --annual-rate 7 --years 10 | jq .finalBalance
  ```
- `investment-dca` — Compare DCA vs lump-sum investing
  ```bash
  wyreup investment-dca --monthly-contribution 500 --price-history '[100,110,95,120]' | jq .dcaWins
  ```

### AI / Privacy tools

- `face-blur` — Detect and blur faces in images (MediaPipe-based, browser/WebGL required)
  ```bash
  wyreup face-blur photo.jpg -o anonymized.jpg
  ```
- `audio-enhance` — Audio super-resolution 16kHz → 48kHz
  ```bash
  wyreup audio-enhance voice.wav -o enhanced.wav
  ```

## Behavioral guidance

- Always use `-o <output>` for a single output file; use `-O <dir>` for multi-output tools (`split-pdf`, `pdf-to-image`, `favicon`).
- For tools with JSON output (`hash`, `image-info`, `pdf-info`, `word-counter`, etc.), pipe to `jq` for readable output: `wyreup hash file.bin | jq .sha256`
- Never upload files. Wyreup is strictly local — no data leaves the machine.
- Warn users before running heavy-compute tools: `face-blur`, `ocr`, `audio-enhance`. These may take several seconds on CPU. `face-blur` also requires a browser/WebGL context — suggest the web UI at wyreup.com if running in a pure terminal context.
- `ocr` uses Tesseract.js. The first run downloads language data (~30 MB); subsequent runs are faster.

## Errors

- Exit code is non-zero on failure. Error message is on stderr.
- `Unknown tool: <id>` — wrong tool name. Run `wyreup --help` or `wyreup list` to see available tools.
- `ENOENT` on input path — file does not exist. Confirm path with user.
- `EACCES` on output path — write permission denied on the output directory.
- `Unsupported input type` — file MIME type does not match what the tool accepts. Use `convert` to change format first.
