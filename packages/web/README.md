# @wyreup/web

The Wyreup website. Astro and Svelte static site on Cloudflare Pages, with free local/browser tools, local model downloads and a disclosed public domain-registration lookup. Hosted inference, accounts and payments are retired. The site has no email signup or cross-product promotion.

## Structure

- `src/pages/` — route-per-file Astro pages
- `src/layouts/` — shared layouts
- `src/components/` — reusable components
- `public/` — static assets

## Status

The website uses a free, web-supported projection of the validated Core registry for pages, search, tasks, chains and triggers. Old hosted tool IDs are unavailable; retired account/pricing/admin pages redirect to the tools catalog. The API layer returns HTTP 410 for retired routes before database, email or provider work.

Build with `pnpm --filter @wyreup/core... build` followed by `pnpm --filter @wyreup/web build`. For the public lookup, run `pnpm db:apply:local` and `pnpm dev:pages` from the repository root. No model provider or payment credentials are required. See [the free-only release procedure](../../docs/free-only-service.md) for mandatory checks and live verification.
