# @wyreup/cli

Wyreup CLI — privacy-first file tools from the shell. Same engine as [wyreup.com](https://wyreup.com), fully offline and scriptable.

## Install

```bash
npm install -g @wyreup/cli
```

Requires Node >= 20.

## Usage

```bash
# List all available tools
wyreup list

# Compress an image
wyreup compress photo.jpg --quality 80 -o photo-small.jpg

# Convert image format
wyreup convert image.png --format webp -o image.webp

# Merge PDFs
wyreup merge-pdf a.pdf b.pdf -o merged.pdf

# Generate a QR code
wyreup qr "https://wyreup.com" -o qr.png

# Hash a file
wyreup hash document.pdf --algorithm sha256
```

## Tool categories

| Category | Tools |
|----------|-------|
| Image | compress, convert, crop, resize, rotate, flip, watermark, face-blur, strip-exif, image-diff, OCR, SVG to PNG, favicon, color palette, grayscale, sepia |
| PDF | merge, split, compress, rotate, reorder pages, extract/delete pages, page numbers, encrypt/decrypt, redact, extract tables, extract text, PDF to image, image to PDF, watermark, PDF info |
| Audio | convert, trim, merge |
| Text/Dev | JSON formatter, base64, URL encoder, hash, Markdown/HTML, text diff, word counter, regex tester, timestamp converter, color converter |
| Create | QR code, UUID generator, password generator, lorem ipsum |

## Privacy

Everything runs locally on your machine. No files leave your device. No network calls for tool execution.

## More

- [wyreup.com](https://wyreup.com) — browser version, no install needed
- [MCP server (@wyreup/mcp)](https://wyreup.com/mcp) — agent interface for Claude Code / Claude Desktop
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
