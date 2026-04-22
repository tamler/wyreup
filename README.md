# Wyreup

**Privacy-first browser-native tools. Nothing uploads.**

[wyreup.com](https://wyreup.com) · MIT License

---

Wyreup is a free, open-source collection of 66 file and text transformation tools that run entirely in your browser. Images, PDFs, audio, text utilities — no server, no upload, no tracking. Every operation executes in WebAssembly or browser-native APIs on your device.

Install it as a Progressive Web App for offline access and native file sharing from other apps on your phone or desktop.

## What it does

Drop a file. Pick a tool. Get the result. Nothing touches a server.

Wyreup handles the kinds of tasks that normally mean uploading a file to a website you don't quite trust: compress an image before sending it, extract text from a PDF, blur faces in a photo, strip GPS data from a JPEG, merge a stack of documents into one. All of it runs on your hardware.

The same tool engine ships as a CLI, an MCP server, and a Claude skill — so the same privacy guarantee applies whether you are using a browser, a terminal, or an AI agent.

## Tools

66 tools across images, PDFs, audio, and text/dev utilities:

- **Images** — compress, convert, resize, crop, rotate, flip, watermark, face blur, strip EXIF, image diff, OCR, SVG to PNG, favicon generator, color palette extractor
- **PDFs** — merge, split, compress, crop, rotate, reorder pages, extract pages, delete pages, add page numbers, encrypt/decrypt, redact, extract tables, extract text, PDF to image, image to PDF, watermark, PDF metadata
- **Audio** — audio enhance
- **Text/Dev** — JSON formatter, base64, URL encoder, UUID generator, password generator, QR code, hash (MD5/SHA), Markdown/HTML, text diff, word counter, regex tester, lorem ipsum, timestamp converter, color converter, CSV/JSON, case converter, slug generator, JSON/YAML, number base converter, JWT decoder, SQL formatter, XML formatter, HTML formatter, CSS formatter, cron parser, QR reader, SVG optimizer

## Use Wyreup

| Surface | How |
|---|---|
| Browser | [wyreup.com/tools](https://wyreup.com/tools) — no install required |
| PWA | Install from the browser for offline access and file sharing |
| CLI | `npx @wyreup/cli <tool> <file>` |
| MCP server | `npx @wyreup/mcp` — connects Claude Code, Cline, Continue, and any MCP-compatible agent |
| Agent skill | Install `@wyreup/skill` for richer agent integration (Claude Code, Claude Desktop, and other skill-compatible runtimes) |

## Architecture

The monorepo is organized into six packages:

| Package | Description |
|---|---|
| `packages/core` | Tool library (`@wyreup/core`) — framework-free, dual browser/Node build |
| `packages/web` | Astro 4 static site — wyreup.com (82 pages, fully static, PWA) |
| `packages/cli` | `wyreup` command-line interface (`@wyreup/cli`) |
| `packages/mcp` | MCP server for agent access (`@wyreup/mcp`) |
| `packages/skill` | Agent skill (`@wyreup/skill`) — CLI + MCP guidance for skill-compatible agent runtimes |
| `packages/cli-skill` | CLI-only agent skill (`@wyreup/cli-skill`) — smaller token footprint |
| `packages/mcp-skill` | MCP-only agent skill (`@wyreup/mcp-skill`) — smaller token footprint |

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the full design.

## Development

Prerequisites: Node >= 20, pnpm 9.

```bash
pnpm install
pnpm build       # builds all packages in dependency order
pnpm test        # runs all test suites
```

Run the web app locally:

```bash
pnpm --filter @wyreup/web dev
```

Run just the core library tests:

```bash
pnpm --filter @wyreup/core test
```

## Self-hosting

The site is a fully static Astro build that deploys to any static host. See [DEPLOYMENT.md](./DEPLOYMENT.md) for Cloudflare Pages setup, CI/CD workflow details, GitHub secrets, and npm publishing instructions.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
