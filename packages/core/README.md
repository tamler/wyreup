# @wyreup/core

Privacy-first, browser-native tool library. Tools for images, PDFs, audio, and text — every operation runs on-device using WebAssembly and browser-native APIs. Nothing uploads.

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

- **Image** — compress, convert, crop, resize, rotate, flip, watermark, face-blur, strip-exif, image-diff, OCR, SVG rendering, favicon, color palette
- **PDF** — merge, split, compress, rotate, reorder, extract/delete pages, page numbers, encrypt/decrypt, redact, extract tables/text, convert to/from images, watermark, metadata
- **Audio** — enhance and upscale low-quality recordings
- **Text / Dev** — JSON, YAML, CSV, base64, URL encoding, hashing, JWT decode, SQL/XML/HTML/CSS formatting, diff, word count, regex, Markdown and HTML conversion
- **Create** — QR codes, UUIDs, secure passwords, lorem ipsum, slugs
- **Finance** — compound interest, dollar-cost averaging, percentages, dates

Full catalog: [wyreup.com/tools](https://wyreup.com/tools)

### Dual build

`@wyreup/core` ships two builds:

- `dist/browser/index.js` — for browser and bundler environments (uses WebAssembly workers)
- `dist/node/index.js` — for Node and CLI environments

Your bundler resolves the right one automatically via the `exports` map.

## More

- [wyreup.com](https://wyreup.com) — try every tool in the browser
- [CLI (@wyreup/cli)](https://wyreup.com/cli) — shell interface
- [MCP server (@wyreup/mcp)](https://wyreup.com/mcp) — agent interface
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
