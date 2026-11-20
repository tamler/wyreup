# Free-only service retirement

The November 20, 2026 product decision makes Wyreup a free browser/local tool library with a disclosed public domain-registration lookup. Local AI tools may download model assets from the first-party model CDN before inference on the user's device. Hosted inference, payments and account signup are retired. There is no email signup or cross-product promotion.

## Server boundary

API middleware allows only the public domain lookup with its supported POST method. Other API requests return HTTP 410 before authentication, body parsing, database access, email or provider work. Retired handlers cannot dispatch hosted models or process payments. The orphaned sales-funnel counter is retired too; its historical table is preserved. The Workers AI deployment binding is removed. Old CLI/MCP hosted definitions remain compatible in published packages, but their service requests receive the same retirement response.

The disable-switch migration preserves account, balance and history rows. It is defense in depth: changing the old database switch cannot enable the retired service. Existing migrations are immutable. No customer refunds or notifications are part of this change.

## Website boundary

The website projects the validated library registry to free, web-supported tools for pages, search, categories, recommendations, tasks, chains and triggers. Stored/imported chains referencing retired tools fail before execution. Pricing, account and admin paths redirect to the tool catalog. Hosted task pages and sales/upgrade prompts are removed. Local tools retain input validation and capability checks.

Core and MCP runtime source is unchanged. The CLI installer requires a patch release updating its three integrity hashes to the current free-only skill documents; it still rejects mismatched content. Older installed clients reject the changed documents, so upgrade to the matching CLI release before installing them. Local tool commands are unchanged. The CLI-only patch changeset is part of this source change.

## Release gate

The mandatory **Free-only retirement** CI job builds the current Core and website, runs retirement tests and probes the actual compiled Pages Functions worker. Negative probes require HTTP 410 without model/email/payment egress; positive controls retain the local catalog and permitted public API routing. Normal build, security, privacy, type, unit, consumer and production browser gates remain required.

Deployment requires successful CI for the exact current main SHA, rechecks current main before production changes and verifies the triggering CI run contains exactly one successful Free-only retirement job for that source. This replaces the obsolete inbox-recovery rehearsal for a service no longer issuing accounts. It does not claim an inbox test happened or reuse older rehearsal approval. Retirement proof precedes every production mutation.

After merge, verify actual-main CI and Pages deployment, then inspect the live catalog, redirects, search index, privacy policy, old hosted/payment/signup API responses and a representative local tool. Negative probes must never call a real model, send email or create checkout. Distinguish observed zero provider invocations during verification from unmeasured historical billing totals. Retain the release SHA, deployment identifier and checks in the coordinator receipt.

Re-enabling any retired service requires a new explicit product decision, independent review and relevant runtime qualification.

The existing release workflow can automatically create and merge a version PR and publish the CLI patch after successful main CI. Site deployment and npm publication are distinct authority scopes. Prepare and review the full change first, and resolve publication authority before landing the changeset on main; do not silently publish or weaken installer integrity to avoid the release dependency.
