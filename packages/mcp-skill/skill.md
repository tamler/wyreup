---
name: wyreup-mcp
description: Invoke Wyreup's 72 file tools through the Wyreup MCP server. Use when your agent runtime has MCP transport configured (e.g., @wyreup/mcp server registered via the agent client's MCP config). The tools read and write local files — nothing is uploaded.
---

# Wyreup MCP skill

Wyreup is a library of 72 privacy-first file tools that run locally. This skill is for **MCP contexts** — agent runtimes that call tools via the Model Context Protocol (Claude Code, Claude Desktop, Cline, Continue, Zed, or any custom agent using the MCP SDKs). It is smaller than `@wyreup/skill` because it omits CLI guidance and focuses entirely on MCP invocation shapes.

> If your agent context is CLI-only (shell commands, terminal agents), use `@wyreup/cli-skill` instead.
> If you want both CLI and MCP guidance in one file, use `@wyreup/skill`.

## When to use

- Your agent runtime has the `@wyreup/mcp` server registered in its MCP config
- User has a local file path and wants to transform it without uploading to a cloud service
- User asks to compress, convert, merge, split, redact, watermark, or otherwise process images, PDFs, or text files
- User mentions privacy, local processing, or "keep it on my machine"
- User mentions Wyreup by name

## Confirm the MCP server is wired up

Before invoking, verify the server is available by listing tools. If `compress` (or any Wyreup tool name) appears in the tool list, the server is connected.

To install the server, add it to your agent client's MCP config:

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

Config file locations:
- Claude Desktop (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`
- Claude Desktop (Windows): `%APPDATA%\Claude\claude_desktop_config.json`
- Claude Code (project): `.mcp.json` in project root
- Cline / Continue / Zed: see your client's MCP settings panel

## MCP invocation shape

All Wyreup tools share the same parameter envelope:

```json
{
  "name": "<tool-id>",
  "arguments": {
    "input_paths": ["/absolute/path/to/input"],
    "output_path": "/absolute/path/to/output",
    "params": {}
  }
}
```

Use `output_dir` instead of `output_path` for multi-output tools (see below).

## Categories and tools

### Image tools

- `compress` — Compress JPEG/PNG/WebP images
  ```json
  {"name":"compress","arguments":{"input_paths":["/home/user/photo.jpg"],"output_path":"/home/user/photo-small.jpg","params":{"quality":80}}}
  ```
- `convert` — Convert between image formats (HEIC, JPG, PNG, WebP, AVIF, TIFF)
  ```json
  {"name":"convert","arguments":{"input_paths":["/home/user/image.heic"],"output_path":"/home/user/image.jpg","params":{"format":"jpg"}}}
  ```
- `crop` — Crop to a region
  ```json
  {"name":"crop","arguments":{"input_paths":["/home/user/photo.jpg"],"output_path":"/home/user/cropped.jpg","params":{"x":100,"y":100,"width":400,"height":300}}}
  ```
- `resize` — Resize to specified dimensions
  ```json
  {"name":"resize","arguments":{"input_paths":["/home/user/photo.jpg"],"output_path":"/home/user/resized.jpg","params":{"width":800,"height":600}}}
  ```
- `rotate-image` — Rotate by degrees
  ```json
  {"name":"rotate-image","arguments":{"input_paths":["/home/user/photo.jpg"],"output_path":"/home/user/rotated.jpg","params":{"degrees":90}}}
  ```
- `flip-image` — Flip horizontally or vertically
  ```json
  {"name":"flip-image","arguments":{"input_paths":["/home/user/photo.jpg"],"output_path":"/home/user/flipped.jpg","params":{"direction":"horizontal"}}}
  ```
- `grayscale` — Convert to grayscale
  ```json
  {"name":"grayscale","arguments":{"input_paths":["/home/user/photo.jpg"],"output_path":"/home/user/gray.jpg","params":{}}}
  ```
- `sepia` — Apply sepia tone
  ```json
  {"name":"sepia","arguments":{"input_paths":["/home/user/photo.jpg"],"output_path":"/home/user/sepia.jpg","params":{}}}
  ```
- `invert` — Invert colors
  ```json
  {"name":"invert","arguments":{"input_paths":["/home/user/photo.jpg"],"output_path":"/home/user/inverted.jpg","params":{}}}
  ```
- `strip-exif` — Remove EXIF metadata from images
  ```json
  {"name":"strip-exif","arguments":{"input_paths":["/home/user/photo.jpg"],"output_path":"/home/user/clean.jpg","params":{}}}
  ```
- `image-watermark` — Add text watermark to an image
  ```json
  {"name":"image-watermark","arguments":{"input_paths":["/home/user/photo.jpg"],"output_path":"/home/user/watermarked.jpg","params":{"text":"Confidential"}}}
  ```
- `svg-to-png` — Convert SVG to PNG
  ```json
  {"name":"svg-to-png","arguments":{"input_paths":["/home/user/icon.svg"],"output_path":"/home/user/icon.png","params":{"width":256}}}
  ```
- `favicon` — Generate favicon in multiple sizes (multi-output — use `output_dir`)
  ```json
  {"name":"favicon","arguments":{"input_paths":["/home/user/logo.png"],"output_dir":"/home/user/favicon/","params":{}}}
  ```
- `color-palette` — Extract dominant colors from an image
  ```json
  {"name":"color-palette","arguments":{"input_paths":["/home/user/photo.jpg"],"params":{}}}
  ```
- `image-diff` — Visual diff between two images
  ```json
  {"name":"image-diff","arguments":{"input_paths":["/home/user/before.png","/home/user/after.png"],"output_path":"/home/user/diff.png","params":{}}}
  ```
- `image-info` — Get image metadata as JSON
  ```json
  {"name":"image-info","arguments":{"input_paths":["/home/user/photo.jpg"],"params":{}}}
  ```

### PDF tools

- `merge-pdf` — Merge multiple PDFs into one
  ```json
  {"name":"merge-pdf","arguments":{"input_paths":["/home/user/a.pdf","/home/user/b.pdf"],"output_path":"/home/user/merged.pdf","params":{}}}
  ```
- `split-pdf` — Split PDF into one file per page (multi-output — use `output_dir`)
  ```json
  {"name":"split-pdf","arguments":{"input_paths":["/home/user/doc.pdf"],"output_dir":"/home/user/pages/","params":{}}}
  ```
- `rotate-pdf` — Rotate PDF pages
  ```json
  {"name":"rotate-pdf","arguments":{"input_paths":["/home/user/doc.pdf"],"output_path":"/home/user/rotated.pdf","params":{"degrees":90}}}
  ```
- `reorder-pdf` — Reorder pages by index
  ```json
  {"name":"reorder-pdf","arguments":{"input_paths":["/home/user/doc.pdf"],"output_path":"/home/user/reordered.pdf","params":{"order":[3,1,2]}}}
  ```
- `page-numbers-pdf` — Add page numbers
  ```json
  {"name":"page-numbers-pdf","arguments":{"input_paths":["/home/user/doc.pdf"],"output_path":"/home/user/numbered.pdf","params":{}}}
  ```
- `watermark-pdf` — Add text watermark to PDF pages
  ```json
  {"name":"watermark-pdf","arguments":{"input_paths":["/home/user/doc.pdf"],"output_path":"/home/user/draft.pdf","params":{"text":"DRAFT"}}}
  ```
- `pdf-to-text` — Extract text content from PDF
  ```json
  {"name":"pdf-to-text","arguments":{"input_paths":["/home/user/doc.pdf"],"output_path":"/home/user/doc.txt","params":{}}}
  ```
- `pdf-to-image` — Render PDF pages as images (multi-output — use `output_dir`)
  ```json
  {"name":"pdf-to-image","arguments":{"input_paths":["/home/user/doc.pdf"],"output_dir":"/home/user/images/","params":{}}}
  ```
- `pdf-info` — Get PDF metadata as JSON
  ```json
  {"name":"pdf-info","arguments":{"input_paths":["/home/user/doc.pdf"],"params":{}}}
  ```
- `pdf-extract-pages` — Extract a range of pages
  ```json
  {"name":"pdf-extract-pages","arguments":{"input_paths":["/home/user/doc.pdf"],"output_path":"/home/user/extract.pdf","params":{"pages":"1-5"}}}
  ```
- `pdf-delete-pages` — Delete specific pages
  ```json
  {"name":"pdf-delete-pages","arguments":{"input_paths":["/home/user/doc.pdf"],"output_path":"/home/user/trimmed.pdf","params":{"pages":[3,7]}}}
  ```
- `pdf-compress` — Reduce PDF file size
  ```json
  {"name":"pdf-compress","arguments":{"input_paths":["/home/user/large.pdf"],"output_path":"/home/user/small.pdf","params":{}}}
  ```
- `pdf-encrypt` — Password-protect a PDF
  ```json
  {"name":"pdf-encrypt","arguments":{"input_paths":["/home/user/doc.pdf"],"output_path":"/home/user/protected.pdf","params":{"password":"s3cret"}}}
  ```
- `pdf-decrypt` — Remove PDF password
  ```json
  {"name":"pdf-decrypt","arguments":{"input_paths":["/home/user/protected.pdf"],"output_path":"/home/user/open.pdf","params":{"password":"s3cret"}}}
  ```
- `pdf-redact` — Black out text regions
  ```json
  {"name":"pdf-redact","arguments":{"input_paths":["/home/user/doc.pdf"],"output_path":"/home/user/redacted.pdf","params":{"regions":[[50,100,300,120]]}}}
  ```
- `pdf-metadata` — Read or write PDF metadata
  ```json
  {"name":"pdf-metadata","arguments":{"input_paths":["/home/user/doc.pdf"],"params":{}}}
  ```
- `pdf-extract-tables` — Extract tables from PDF as JSON
  ```json
  {"name":"pdf-extract-tables","arguments":{"input_paths":["/home/user/report.pdf"],"params":{}}}
  ```
- `pdf-crop` — Crop PDF pages to a box
  ```json
  {"name":"pdf-crop","arguments":{"input_paths":["/home/user/doc.pdf"],"output_path":"/home/user/cropped.pdf","params":{"box":{"x":0,"y":0,"width":400,"height":600}}}}
  ```
- `image-to-pdf` — Convert images to a PDF
  ```json
  {"name":"image-to-pdf","arguments":{"input_paths":["/home/user/photo1.jpg","/home/user/photo2.jpg"],"output_path":"/home/user/photos.pdf","params":{}}}
  ```

### Text and dev tools

- `base64` — Encode or decode base64
  ```json
  {"name":"base64","arguments":{"input_paths":["/home/user/file.bin"],"params":{"mode":"encode"}}}
  ```
- `url-encoder` — Encode or decode URL strings
  ```json
  {"name":"url-encoder","arguments":{"params":{"text":"hello world?","mode":"encode"}}}
  ```
- `markdown-to-html` — Convert Markdown to HTML
  ```json
  {"name":"markdown-to-html","arguments":{"input_paths":["/home/user/doc.md"],"output_path":"/home/user/doc.html","params":{}}}
  ```
- `html-to-markdown` — Convert HTML to Markdown
  ```json
  {"name":"html-to-markdown","arguments":{"input_paths":["/home/user/page.html"],"output_path":"/home/user/page.md","params":{}}}
  ```
- `text-diff` — Show diff between two text files
  ```json
  {"name":"text-diff","arguments":{"input_paths":["/home/user/old.txt","/home/user/new.txt"],"params":{}}}
  ```
- `word-counter` — Count words, characters, sentences
  ```json
  {"name":"word-counter","arguments":{"input_paths":["/home/user/essay.txt"],"params":{}}}
  ```
- `json-formatter` — Format or minify JSON
  ```json
  {"name":"json-formatter","arguments":{"input_paths":["/home/user/data.json"],"output_path":"/home/user/pretty.json","params":{"indent":2}}}
  ```
- `regex-tester` — Test a regex pattern against text
  ```json
  {"name":"regex-tester","arguments":{"params":{"pattern":"\\d+","text":"abc 123 def"}}}
  ```
- `timestamp-converter` — Convert Unix timestamps to human dates
  ```json
  {"name":"timestamp-converter","arguments":{"params":{"timestamp":1700000000}}}
  ```
- `color-converter` — Convert between color formats (hex, rgb, hsl)
  ```json
  {"name":"color-converter","arguments":{"params":{"color":"#FFB000"}}}
  ```
- `hash` — Hash a file (MD5, SHA-256, SHA-512)
  ```json
  {"name":"hash","arguments":{"input_paths":["/home/user/file.bin"],"params":{}}}
  ```
- `ocr` — Extract text from images using Tesseract
  ```json
  {"name":"ocr","arguments":{"input_paths":["/home/user/scan.jpg"],"output_path":"/home/user/scan.txt","params":{}}}
  ```
- `csv-json` — Convert CSV to JSON or vice versa
  ```json
  {"name":"csv-json","arguments":{"input_paths":["/home/user/data.csv"],"output_path":"/home/user/data.json","params":{}}}
  ```
- `case-converter` — Convert text case (camel, snake, kebab, etc.)
  ```json
  {"name":"case-converter","arguments":{"params":{"text":"hello world","to":"camelCase"}}}
  ```
- `slug` — Convert text to URL slug
  ```json
  {"name":"slug","arguments":{"params":{"text":"Hello World!"}}}
  ```
- `json-yaml` — Convert between JSON and YAML
  ```json
  {"name":"json-yaml","arguments":{"input_paths":["/home/user/data.json"],"output_path":"/home/user/data.yaml","params":{}}}
  ```
- `number-base-converter` — Convert numbers between bases
  ```json
  {"name":"number-base-converter","arguments":{"params":{"value":255,"from":10,"to":16}}}
  ```
- `jwt-decoder` — Decode a JWT token (no verification)
  ```json
  {"name":"jwt-decoder","arguments":{"params":{"token":"eyJ..."}}}
  ```
- `sql-formatter` — Format SQL queries
  ```json
  {"name":"sql-formatter","arguments":{"input_paths":["/home/user/query.sql"],"output_path":"/home/user/formatted.sql","params":{}}}
  ```
- `xml-formatter` — Format XML
  ```json
  {"name":"xml-formatter","arguments":{"input_paths":["/home/user/data.xml"],"output_path":"/home/user/pretty.xml","params":{}}}
  ```
- `html-formatter` — Format HTML
  ```json
  {"name":"html-formatter","arguments":{"input_paths":["/home/user/page.html"],"output_path":"/home/user/pretty.html","params":{}}}
  ```
- `css-formatter` — Format CSS
  ```json
  {"name":"css-formatter","arguments":{"input_paths":["/home/user/styles.css"],"output_path":"/home/user/pretty.css","params":{}}}
  ```
- `cron-parser` — Parse and describe cron expressions
  ```json
  {"name":"cron-parser","arguments":{"params":{"expression":"0 9 * * MON-FRI"}}}
  ```
- `qr-reader` — Decode QR code from image
  ```json
  {"name":"qr-reader","arguments":{"input_paths":["/home/user/qr.png"],"params":{}}}
  ```
- `svg-optimizer` — Optimize SVG file size
  ```json
  {"name":"svg-optimizer","arguments":{"input_paths":["/home/user/icon.svg"],"output_path":"/home/user/icon.min.svg","params":{}}}
  ```

### Create tools

- `qr` — Generate a QR code image
  ```json
  {"name":"qr","arguments":{"output_path":"/home/user/qr.png","params":{"text":"https://wyreup.com"}}}
  ```
- `uuid-generator` — Generate UUID v4 identifiers
  ```json
  {"name":"uuid-generator","arguments":{"params":{"count":5}}}
  ```
- `password-generator` — Generate random passwords
  ```json
  {"name":"password-generator","arguments":{"params":{"length":24,"count":3}}}
  ```
- `lorem-ipsum` — Generate placeholder text
  ```json
  {"name":"lorem-ipsum","arguments":{"params":{"paragraphs":2}}}
  ```
- `calculator` — Evaluate arithmetic and scientific expressions
  ```json
  {"name":"calculator","arguments":{"params":{"expression":"sqrt(2) * pi"}}}
  ```
- `unit-converter` — Convert between units of measurement
  ```json
  {"name":"unit-converter","arguments":{"params":{"value":5,"from":"ft","to":"m"}}}
  ```
- `percentage-calculator` — Calculate percentages
  ```json
  {"name":"percentage-calculator","arguments":{"params":{"mode":"percent-of","value":15,"base":200}}}
  ```
- `date-calculator` — Calculate date differences and add/subtract time
  ```json
  {"name":"date-calculator","arguments":{"params":{"mode":"diff","date1":"2026-01-01","date2":"2026-12-31"}}}
  ```

### Finance tools

- `compound-interest` — Calculate compound interest with contributions
  ```json
  {"name":"compound-interest","arguments":{"params":{"principal":10000,"annual-rate":7,"years":10}}}
  ```
- `investment-dca` — Compare DCA vs lump-sum investing
  ```json
  {"name":"investment-dca","arguments":{"params":{"monthly-contribution":500,"price-history":[100,110,95,120]}}}
  ```

### AI / Privacy tools

- `face-blur` — Detect and blur faces in images (MediaPipe-based, browser/WebGL required)
  ```json
  {"name":"face-blur","arguments":{"input_paths":["/home/user/photo.jpg"],"output_path":"/home/user/anonymized.jpg","params":{}}}
  ```
- `audio-enhance` — Audio super-resolution 16kHz → 48kHz
  ```json
  {"name":"audio-enhance","arguments":{"input_paths":["/home/user/voice.wav"],"output_path":"/home/user/enhanced.wav","params":{}}}
  ```

## Multi-output tools

The following tools write multiple output files. Use `output_dir`, not `output_path`:

- `split-pdf` — one PDF per page
- `pdf-to-image` — one image per page
- `favicon` — multiple sizes (.ico + PNGs)

## Behavioral guidance

- Use `output_dir` (not `output_path`) for multi-output tools: `split-pdf`, `pdf-to-image`, `favicon`.
- Tools that return JSON results directly (no file output): `image-info`, `pdf-info`, `word-counter`, `hash`, `color-palette`, `image-diff` stats, `regex-tester`, `timestamp-converter`, `color-converter`, `uuid-generator`, `password-generator`, `lorem-ipsum`, `calculator`, `unit-converter`, `percentage-calculator`, `date-calculator`, `compound-interest`, `investment-dca`, `jwt-decoder`, `cron-parser`.
- Never upload files. Wyreup tools are strictly local — all `input_paths` and `output_path`/`output_dir` values must be absolute local paths.
- Warn users before running heavy-compute tools: `face-blur`, `ocr`, `audio-enhance`. These may take several seconds.
- `face-blur` requires a browser/WebGL context for MediaPipe. In a Node-only MCP server context it may fail — suggest wyreup.com for that tool if so.
- `ocr` uses Tesseract.js. The first run downloads language data (~30 MB); subsequent runs are faster.

## Errors

- `Unknown tool: <id>` — wrong tool name. Call `list_tools` to see the current list.
- `ENOENT` on `input_path` — file does not exist. Confirm the absolute path with the user.
- `EACCES` on `output_path` — write permission denied on the output directory.
- `Unsupported input type` — file MIME type does not match what the tool accepts. Use `convert` to change format first.
