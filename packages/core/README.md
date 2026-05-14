# @wyreup/core

Privacy-first, browser-native tool library. Tools for images, PDFs, audio, and text — every operation runs on-device using WebAssembly and browser-native APIs. Nothing uploads.

## Install

```bash
npm install @wyreup/core
```

Requires Node >= 20. Works in browser, Node, and edge runtimes (dual build).

## Usage

```js
import { createDefaultRegistry } from '@wyreup/core';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const registry = createDefaultRegistry();
const tool = registry.toolsById.get('compress');

// Read input file
const bytes = await readFile('photo.jpg');
const input = new File([bytes], 'photo.jpg', { type: 'image/jpeg' });

// Run the tool
const ctx = {
  onProgress: () => {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: randomUUID(),
};
const result = await tool.run([input], { quality: 80 }, ctx);
// result is a Blob or Blob[]
```

### Chain tools

```js
import { createDefaultRegistry, runChain, parseChainString } from '@wyreup/core';
import { randomUUID } from 'node:crypto';

const registry = createDefaultRegistry();
const chain = parseChainString('strip-exif|compress[quality=75]');

const ctx = {
  onProgress: () => {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: randomUUID(),
};

const outputs = await runChain(chain, [inputFile], ctx, registry);
// outputs is Blob[]
```

### Available tool categories

- **Image** — compress, convert, crop, resize, rotate, flip, watermark, face-blur, strip-exif, image-diff, OCR, SVG rendering, favicon, color palette, color-blind simulation, background removal, 2× upscale, image captioning
- **PDF** — merge, split, compress, rotate, reorder, extract/delete pages, extract images, page numbers, encrypt/decrypt, redact, extract tables/text, convert to/from images, watermark, metadata, prompt-injection scan
- **Audio + video** — transcribe (Whisper), audio enhance, convert, extract, trim, record, video concat/crossfade/overlay/color, video to GIF, burn subtitles
- **Text** — diff, redact, suspicious-scan, confusable detection, template (mustache), summarise, translate, sentiment, NER, stats, readability, unicode info/normalize, Markdown and HTML conversion
- **Dev** — JSON (format, diff, merge, flatten, path, schema infer/validate), YAML, XML ↔ JSON, SQL/CSS/HTML formatting, CSS/HTML minify, regex, JWT decode, OpenAPI / package.json validation
- **Security & auth** — hash, hmac, base32/58/64, TOTP/HOTP, JWT sign, signed URLs, signed cookies, backup codes, API/license keys, OTP-auth URIs, webhook verify/replay, file fingerprint
- **Privacy** — strip EXIF, face blur, PGP encrypt/decrypt/sign/verify/armor
- **Data** — CSV (info, dedupe, merge, diff, schema, template/mail-merge), Excel ↔ CSV/JSON, GeoJSON ↔ KML/GPX/shapefile, geo conversion
- **Create** — QR codes, barcodes, UUIDs, secure passwords, lorem ipsum, slugs
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
