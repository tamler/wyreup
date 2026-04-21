# @wyreup/core

Privacy-first, browser-native tool library. 66 tools for images, PDFs, audio, and text — every operation runs on-device using WebAssembly and browser-native APIs. Nothing uploads.

## Install

```bash
npm install @wyreup/core
```

Requires Node >= 20. Works in browser, Node, and edge runtimes (dual build).

## Usage

```js
import { runTool } from '@wyreup/core';

// Compress a JPEG to 80% quality
const result = await runTool('compress', {
  inputPaths: ['photo.jpg'],
  params: { quality: 80 },
});
// result.outputFiles[0] is the compressed file buffer
```

### Available tool categories

- **Image** (16 tools) — compress, convert, crop, resize, rotate, flip, watermark, face-blur, strip-exif, image-diff, OCR, SVG to PNG, favicon, color palette, grayscale, sepia
- **PDF** (19 tools) — merge, split, compress, rotate, reorder, extract/delete pages, add page numbers, encrypt/decrypt, redact, extract tables, extract text, PDF to image, image to PDF, watermark, PDF info
- **Audio** (3 tools) — convert, trim, merge
- **Text/Dev** (12 tools) — JSON formatter, base64, URL encoder, hash, Markdown/HTML, text diff, word counter, regex tester, timestamp converter, color converter, lorem ipsum, UUID generator
- **Create** (4 tools) — QR code, UUID, password, lorem ipsum

### Dual build

`@wyreup/core` ships two builds:

- `dist/browser/index.js` — for browser and bundler environments (uses WebAssembly workers)
- `dist/node/index.js` — for Node and CLI environments

Your bundler resolves the right one automatically via the `exports` map.

## More

- [wyreup.com](https://wyreup.com) — try all 66 tools in the browser
- [CLI (@wyreup/cli)](https://wyreup.com/cli) — shell interface
- [MCP server (@wyreup/mcp)](https://wyreup.com/mcp) — agent interface
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
