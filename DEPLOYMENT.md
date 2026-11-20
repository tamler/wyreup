# Deployment

Wyreup is a free browser/local tool library. Pages Functions retain only the public domain-registration lookup and the responses for retired APIs. Account signup, billing, email delivery and hosted inference are removed from the server source. See [free-only service retirement](docs/free-only-service.md) for the boundary and acceptance checks.

## Toolchain and existing infrastructure

Use the Node versions in `package.json`'s `engines` and the pinned `packageManager` (`pnpm@10.34.5`). Install the existing lockfile with `pnpm install --frozen-lockfile`.

The existing Cloudflare Pages project is `wyreup`. Root `wrangler.toml` names its D1 database and migrations. D1 serves public domain-lookup rate limits and their aggregate counters; historical account and credit records remain preserved. Do not recreate the production database or edit historical migrations during deployment.

The local-model asset Worker has its own configuration at `packages/worker-models/wrangler.jsonc`. It distributes model files for inference on the user's device; it does not provide hosted inference. The deployment workflow publishes this Worker before Pages.

## Configuration and local development

`SESSION_SECRET` is the only required Pages secret, used to derive private rate-limit keys for public domain lookup. The current application does not require payment, email, admin or model-provider credentials. This describes required configuration, not proof that historical secrets have been removed from an existing project.

Copy `.dev.vars.example` to the gitignored `.dev.vars` for local development and supply a distinct local secret. After applying local migrations with `pnpm db:apply:local`, `pnpm dev:pages` builds the site and serves Pages Functions with local D1. Bindings come from `wrangler.toml`; local secrets come from `.dev.vars`.

Do not copy development credentials into production. The former bulk secret-push script is removed. When explicitly authorized to provision the production rate-limit secret, use the supported interactive command without placing its value in an argument, source file or log:

```bash
pnpm exec wrangler pages secret put SESSION_SECRET --project-name=wyreup
```

Changing credentials is a separate authorized action. Source changes do not automatically rotate secrets. Preserve the deployment workflow's existing Cloudflare and npm authentication configuration; never print credential values.

## Custom domains

The existing Pages project serves `wyreup.com` and `www.wyreup.com`. Verify canonical redirects and TLS after deployment. Domain or DNS changes require explicit authority; normal releases do not recreate or reattach them.

## CI, deployment and migrations

[`ci.yml`](.github/workflows/ci.yml) runs on pull requests, main pushes and manual dispatch. All required checks must succeed for the exact source being released, including the **Free-only retirement** compiled Pages gate.

[`deploy.yml`](.github/workflows/deploy.yml) listens for successful main CI, checks the tested SHA against checkout and current main, rechecks after building, and verifies the triggering run's successful retirement job before production changes. It then applies remote D1 migrations, deploys the model-asset Worker, verifies runtime assets and deploys Pages. An authorized operator must use this source-bound path; `db:apply:remote` is not an ad-hoc setup instruction. Never substitute a stale or skipped run for successful current-source proof.

After deployment, verify the Cloudflare deployment SHA, current live catalog and local tool behavior, plus denied hosted/account/payment APIs. Inventory and retire legacy deployments and aliases before claiming live retirement. Retain a checked free-only production rollback target. Pre-retirement deployments are not valid rollback targets, even if the old database switch is disabled. Negative checks must not create accounts, send email, run hosted models or create checkouts.

## Publishing to npm

Public package behavior changes need an appropriate Changeset in the same reviewed change. Private server, documentation and test cleanup does not itself require a package version bump.

[`release.yml`](.github/workflows/release.yml) runs after successful current-main CI. It validates source identity and the downloaded release artifacts, then uses Changesets to create a version PR or invoke `release:publish`. The existing workflow can automatically merge the generated version PR. Publication goes through `release:pack`, `release:verify` and `release:publish`, including artifact preparation and the public-registry verification; do not bypass those checks with the raw publish command.

Source merge, website deployment and npm publication are distinct authority scopes. Inspect the actual automation before a release and obtain the applicable authority. Confirm the generated version changes match the approved package scope, actual-main CI and Deploy succeed, live Pages serves the new content, and public npm packages match the approved release artifacts before claiming completion.

## PWA icons

The PWA icons in `packages/web/public/` are generated from `packages/web/public/favicon.svg`. If you change the favicon, regenerate them:

```bash
# Run from the repository root; the script resolves the web package's dependencies.
node packages/web/scripts/gen-pwa-icons.mjs
```

This writes `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png`, `pwa-monochrome-512.png` and `apple-touch-icon.png` to `packages/web/public/`.
