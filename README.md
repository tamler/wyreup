# Wyreup

**Wyreup your capabilities. Nothing uploads.**

[wyreup.com](https://wyreup.com) · MIT License

---

Wyreup is a free, open-source toolbelt for your files, your terminal, and your agent. Drop a file in the browser, run a command in your shell, or let your AI assistant invoke the same engine. Everything executes on your device — no server, no upload, no tracking.

Give your agent a toolbelt. Install the PWA and share files to Wyreup from any app. Script it in CI. Wire it into Claude Code, Claude Desktop, Cline, Continue, or any MCP-compatible client.

## What it does

Drop a file. Pick a tool. Get the result. Nothing touches a server.

Wyreup handles the kinds of tasks that normally mean uploading a file to a website you don't quite trust: compress an image before sending it, extract text from a PDF, blur faces in a photo, strip GPS data from a JPEG, merge a stack of documents into one, decode a JWT, format some SQL, generate a QR code, enhance low-quality audio. All of it runs on your hardware.

The same tool engine ships everywhere — so the same privacy guarantee applies whether you are using a browser, a terminal, or an AI agent.

## Categories

- **Images** — compress, convert, resize, crop, rotate, flip, watermark, face blur, strip EXIF, image diff, OCR, SVG rendering, favicon generation, color palette
- **PDFs** — merge, split, compress, crop, rotate, reorder, extract/delete pages, page numbers, encrypt/decrypt, redact, extract tables and text, convert to/from images, watermark, metadata
- **Audio** — enhance and upscale low-quality recordings
- **Text & Data** — JSON, YAML, CSV, base64, URL encoding, Markdown/HTML, regex, hashing, JWT decode, SQL/XML/HTML/CSS formatting, diff, word counting
- **Create** — QR codes, UUIDs, secure passwords, lorem ipsum, slugs
- **Finance** — compound interest, dollar-cost-averaging, percentages, dates
- **Chain them** — the output of any tool can become the input of another. Save chains, share them as URLs.

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

## Contact

General inquiries: hello@wyreup.com

## License

MIT — see [LICENSE](./LICENSE).
