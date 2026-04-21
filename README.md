# Wyreup

**Privacy-first browser-native tools. Nothing uploads.**

[wyreup.com](https://wyreup.com) · MIT License

---

Wyreup is a free, open-source collection of 53 file and text transformation tools that run entirely in the browser. Images, PDFs, text utilities — no server, no upload, no tracking. Every operation executes in WebAssembly or browser-native APIs on your device.

## Tools

53 tools across images, PDFs, and text/dev utilities. Highlights:

- **Images** — compress, convert, resize, crop, rotate, flip, watermark, face blur, strip EXIF, image diff, OCR, SVG to PNG, favicon generator, color palette extractor
- **PDFs** — merge, split, compress, crop, rotate, reorder pages, extract pages, delete pages, add page numbers, encrypt/decrypt, redact, extract tables, extract text, PDF to image, image to PDF
- **Text/Dev** — JSON formatter, base64, URL encoder, UUID generator, password generator, QR code, hash (MD5/SHA), Markdown/HTML, text diff, word counter, regex tester, lorem ipsum, timestamp converter, color converter

## Packages

| Package | Description |
|---|---|
| `packages/core` | Tool library (`@wyreup/core`) — framework-free, dual browser/Node build |
| `packages/web` | Astro 4 static site — wyreup.com (57 pages, fully static) |
| `packages/cli` | `wyreup` command-line interface (`@wyreup/cli`) |
| `packages/mcp` | MCP server for agent access (`@wyreup/mcp`) |
| `packages/claude-skill` | Claude Code skill for using Wyreup tools in AI workflows |

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

## Deployment

The site deploys to Cloudflare Pages via GitHub Actions on every push to `main`.

### One-time manual setup (Cloudflare + GitHub)

Before the deploy workflow can run, complete these steps once:

**Cloudflare:**

1. Create a Cloudflare account at [dash.cloudflare.com](https://dash.cloudflare.com) if you don't have one
2. Go to **Workers & Pages** → **Create** → **Pages** → create a project named `wyreup`
3. Go to **My Profile** → **API Tokens** → **Create Token** with scope: **Account → Pages → Edit**
4. Note your **Account ID** (visible in the Workers & Pages dashboard sidebar)

**DNS:**

5. Add `wyreup.com` to Cloudflare (or transfer DNS there)
6. In the Pages project settings → **Custom domains** → add `wyreup.com` and `www.wyreup.com`
7. Cloudflare provisions TLS automatically

**GitHub secrets:**

8. In your GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
9. Add `CLOUDFLARE_API_TOKEN` (the token from step 3)
10. Add `CLOUDFLARE_ACCOUNT_ID` (the account ID from step 4)

After that, every push to `main` triggers a build and deploy automatically.

### CI/CD workflows

- **`ci.yml`** — runs on all PRs and pushes to `main`: lint, types, unit tests, full build, isolation check, privacy scan, bundle size check
- **`deploy.yml`** — runs on pushes to `main`: builds core + web, deploys via `wrangler pages deploy`

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
