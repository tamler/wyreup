# Deployment

Wyreup deploys to Cloudflare Pages via GitHub Actions on every push to `main`.

## Prerequisites

- Cloudflare account
- GitHub repository with Actions enabled
- Node >= 20, pnpm 9

## One-time setup (Cloudflare + GitHub)

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

## CI/CD workflows

- **`ci.yml`** — runs on all PRs and pushes to `main`: lint, types, unit tests, full build, isolation check, privacy scan, bundle size check
- **`deploy.yml`** — runs on pushes to `main`: builds core + web, deploys via `wrangler pages deploy`

## PWA icons

The PWA icons in `packages/web/public/` are generated from `packages/web/public/favicon.svg`. If you change the favicon, regenerate them:

```bash
# Run from packages/core (needs @resvg/resvg-js)
node ../../tools/gen-pwa-icons.mjs
```

This writes `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png`, and `apple-touch-icon.png` to `packages/web/public/`.

## Publishing to npm

Wyreup uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing.

### Adding a changeset

When you make a change that should trigger a version bump:

```bash
pnpm changeset
# Follow the prompts to select packages and bump type (patch/minor/major)
# Commit the generated .changeset/*.md file
```

### Release flow

1. Commit your changeset file alongside your code changes
2. Push to `main`
3. The Release GitHub Action creates a "Version Packages" PR that bumps versions and updates CHANGELOGs
4. Merge the PR — the action then publishes to npm automatically

### First-time setup

You must add **`NPM_TOKEN`** as a GitHub repo secret before publishing works:

1. Go to [npmjs.com](https://www.npmjs.com) → Account Settings → Access Tokens → Generate New Token (Automation type)
2. In this repo → Settings → Secrets and variables → Actions → New repository secret
3. Name: `NPM_TOKEN`, value: the token from step 1

You also need to own the `@wyreup` scope on npm (or be added as a member of the `wyreup` npm org) before the first publish will succeed.

See [Changesets docs](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md) for more.
