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

## PRO tier infrastructure

The PRO tier (account creation, credits, hosted-model tools) adds D1, Pages
Functions, Workers AI, ZeptoMail (transactional email), an external image-model
provider (swappable — see `functions/_lib/providers/image-models.ts`), and
Paddle (new payments). The Lemon Squeezy notification endpoint remains
available for earlier subscriptions and refunds.

### One-time D1 setup

```bash
# Create the database (only once per environment)
pnpm wrangler d1 create wyreup-prod
# Paste the returned database_id into wrangler.toml ([[d1_databases]])

# Apply migrations to both remote and local
pnpm db:apply:remote
pnpm db:apply:local
```

### Production secrets (CF Pages → wyreup project)

Set each via the wrangler CLI so values never enter the repo or git history:

```bash
pnpm wrangler pages secret put SESSION_SECRET     --project-name=wyreup  # openssl rand -hex 32
pnpm wrangler pages secret put ZEPTOMAIL_TOKEN    --project-name=wyreup
pnpm wrangler pages secret put ZEPTOMAIL_SENDER   --project-name=wyreup  # e.g. noreply@wyreup.com
pnpm wrangler pages secret put IMAGE_MODEL_TOKEN  --project-name=wyreup
```

### Local development

`.dev.vars` at the repo root is gitignored and read by `wrangler pages dev`.
Copy `.dev.vars.example`, fill it in with local values (use a *different*
`SESSION_SECRET` from prod), then:

```bash
# Builds the static site and serves it with Pages Functions + local D1
pnpm dev:pages
```

Bindings (D1, AI) come from `wrangler.toml`. Secrets come from `.dev.vars`.

### Paddle billing

Billing starts disabled. Use a separate, project-owned Cloudflare Pages
project, hostname, and D1 database for sandbox. The checked-in
`wrangler.toml` targets production D1. Point the sandbox project and
migration command at its own D1 before applying any migrations. Verify
the bindings in Cloudflare and use separate session settings and synthetic
account records. Reserve `https://wyreup.com` and `wyreup-prod` for live.

Configure the following in the selected Pages environment.

| Setting | Sandbox | Live |
| --- | --- | --- |
| `PADDLE_ENVIRONMENT` | `sandbox` | `live` |
| `APP_ORIGIN` | Exact sandbox origin, with no path or trailing slash | `https://wyreup.com` |
| `PADDLE_API_KEY` | Sandbox API key | Live API key |
| `PADDLE_CLIENT_TOKEN` | Paddle.js `test_` token | Paddle.js `live_` token |
| `PADDLE_WEBHOOK_SECRET` | Sandbox notification destination signing secret | Live notification destination signing secret |
| `PADDLE_PRICE_STARTER` | 220 credits for USD 5 | Live price for the same pack |
| `PADDLE_PRICE_STANDARD` | 480 credits for USD 10 | Live price for the same pack |
| `PADDLE_PRICE_POWER` | 1,000 credits for USD 20 | Live price for the same pack |
| `PADDLE_PRICE_MONTHLY` | 440 credits for USD 8 per month | Live price for the same plan |

Use distinct catalog price IDs with minimum and maximum quantity both 1,
no country price overrides, and no trial. The three packs have no billing
cycle. The monthly billing interval is one month. Keep buyer-entered
discounts off and validate tax settings in sandbox. The key requires
`price.read`, `customer.read`, `customer.write`, `transaction.write`
and `customer_portal_session.write`. Only the client-side token is sent
to the checkout page. The verified Wyreup email is used to look up or
create its corresponding Paddle customer.

Set the Paddle default payment link to the environment's `/checkout`.
Live requires an approved checkout domain. Set the notification
destination to the same environment's `/api/webhooks/paddle` and
subscribe to `transaction.completed`, `transaction.canceled`,
`adjustment.created`, `adjustment.updated`, `subscription.created`,
`subscription.updated`, `subscription.activated`, `subscription.canceled`,
`subscription.past_due`, `subscription.paused`, `subscription.resumed` and
`subscription.trialing`.

Migration 0009 initializes the D1 billing marker to `disabled`. After
verifying the intended database and the matching Pages and Paddle settings,
assign its marker once to `sandbox` or `live` using
`UPDATE paddle_billing_mode SET mode = '<approved environment>' WHERE id = 1 AND mode = 'disabled'`.
Never use the same database for both. The production secret helper accepts
Paddle configuration only for the canonical live project. Keep sandbox
configuration on its dedicated project.

Before the live cutover, complete the [purchase verification checklist](docs/T21-PURCHASE-TEST-CHECKLIST.md),
the [protected-source release gate](docs/auth-migration-release.md), and
reconcile open Lemon Squeezy checkouts and billable subscriptions against
their original obligations. Keep `/api/webhooks/lemonsqueezy`,
`LS_WEBHOOK_SECRET`, and legacy `LS_VARIANT_*` configured during the
transition. Existing subscriptions continue under their original receipt.
Neither deployment nor the new checkout moves or cancels them.

If checkout creation returns an uncertain outcome, inspect its
`paddle_checkouts` reservation and exact transaction in the same Paddle
environment. The server-created `wyreup_intent` reference aids dashboard
reconciliation. It does not establish ownership. Confirm the transaction
is terminal or safely bind the confirmed transaction to that reservation
before reopening purchases. Keep pending paid transactions and their
webhook destinations available during rollback or a catalog-ID change.

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
