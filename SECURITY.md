# Security Policy

## Reporting a vulnerability

Please report security issues to **security@wyreup.com**. Include:

- A description of the issue
- Steps to reproduce (if applicable)
- Potential impact

We will acknowledge within 72 hours. Please do not open public issues for security concerns.

## Threat model

Wyreup is a privacy-first file-processing toolkit with four execution surfaces:

| Surface | Threat | Defense focus |
| --- | --- | --- |
| **Web** (`wyreup.com`) | Untrusted user-uploaded files; HTML/SVG output; cross-origin attack vectors | Client-side parsing in user's tab (no shared server state); DOMPurify on user-visible HTML; per-tool input size caps; CSP/SRI on first-party origin |
| **MCP** (`@wyreup/mcp`) | LLM agent autonomously constructs tool calls — paths, params, redirects | Path allowlist + worker re-validation; child_process fork isolation; fetch egress lock; capability annotations for client approval; per-tool timeout; atomic+symlink-safe output writes; bearer-token sanitization |
| **CLI** (`@wyreup/cli`) | User invokes commands intentionally; risk is mostly footguns | Same atomic+symlink-safe writes; fetch egress lock (multi-origin: wyreup.com + models.wyreup.com); per-command `--timeout` flag; refuse-by-default `--overwrite` |
| **Cloudflare worker** (`@wyreup/worker-models`, `models.wyreup.com`) | Supply-chain proxy for AI model assets; bandwidth/storage abuse | Hard allowlist of HuggingFace slugs + version-pinned prefixes; path-traversal rejection; method allowlist (GET/HEAD/OPTIONS); 1.5 GB streaming size cap; 30 s upstream timeout; immutable cache headers |

## Hardened components

The MCP and CLI packages shipped a comprehensive hardening pass in v0.5.0. The design and implementation are documented at:

- `docs/superpowers/specs/2026-05-24-wyreup-mcp-hardening-design.md` — full threat model, 9-layer design, limitations
- `docs/superpowers/plans/2026-05-24-wyreup-mcp-hardening.md` — 22-task implementation plan

Key environment variables (production deployments should review):

| Var | Used by | Purpose |
| --- | --- | --- |
| `WYREUP_API_KEY` | MCP, CLI | Bearer token. Read once at startup; never inherited by worker subprocesses (passed via IPC). |
| `WYREUP_ALLOW_PATHS` | MCP | Colon-separated absolute path roots. Default: CWD + `os.tmpdir()`. `*` disables (not recommended). |
| `WYREUP_MAX_INPUT_BYTES` | MCP | Aggregate input size cap. Default 500 MB. |
| `WYREUP_AUDIT_LOG` | MCP | Opt-in JSONL audit log path (file is created mode `0o600`). |
| `WYREUP_AUDIT_REQUIRED=1` | MCP | Strict mode — audit write failure fails the call. |
| `WYREUP_ALLOW_DISABLE_TIMEOUT=1` | MCP, CLI | Permit timeout disable (`timeout_ms: 0` / `--timeout 0`). |
| `WYREUP_DISABLE_WORKER_ISOLATION=1` | MCP | Debug only — runs tools in-process. |
| `WYREUP_DISABLE_EGRESS_LOCK=1` | MCP, CLI | Disables the `fetch` egress lock. |

Per-call options on every MCP tool and on `wyreup run` / `wyreup chain`:

- `timeout_ms` / `--timeout <ms>` — default 300_000, range `[1, 3_600_000]`, `0` requires the `WYREUP_ALLOW_DISABLE_TIMEOUT` env var
- `allow_overwrite` / `--overwrite` — default `false`; refuses to clobber existing outputs; rejects symlink targets in both modes

Atomic output publishing: writes go through `<target>.tmp.<pid>-<uuid>` opened with `O_EXCL`, then `rename` (overwrite mode) or `link` + `unlink` (exclusive create). Published files have mode `0o600`.

## Web HTML sink audit

The web app has 11 places that assign to `innerHTML` or use Astro `set:html`. All have been audited:

- **3 sites** in `pages/tools/[slug].astro` use `set:html={JSON.stringify(...)}` for JSON-LD structured data. Input is server-derived tool metadata, not user input. Safe.
- **7 sites** in `pages/share-receive.astro` use `innerHTML` with literal string templates (no interpolation of user input). Safe.
- **1 site** in `layouts/BaseLayout.astro` (search dropdown) interpolates tool fields through `escapeHtml()` and URL parameters through `URLSearchParams`. Safe.
- **3 runner components** (`TextResultRunner`, `TextInputRunner`, `TwoTextInputRunner`) render tool-produced HTML through `DOMPurify.sanitize()`. Safe.

No raw user input reaches HTML sinks without sanitization. New HTML rendering MUST follow one of these patterns:

- Compile-time `set:html` only for trusted server-derived JSON (e.g. JSON-LD)
- Runtime `innerHTML` only with `escapeHtml()`-wrapped interpolation or fully literal templates
- Tool-produced HTML only through `DOMPurify.sanitize()`

## Archive parsing (zip-bomb defense)

`@wyreup/core`'s archive tools (`zip-extract`, `zip-flatten`, `zip-remove`, `zip-info`) enforce:

- **Entry count cap** (50_000 entries) — rejects archives with absurd file counts
- **Uncompressed total cap** (4 GB) — rejects classic zip bombs
- **Filename sanitization** — strips leading slashes, drops `..` components, normalizes Windows separators, blocks null-byte tricks. Entries with no usable component are rejected.

`zip-create` is the producer side and is not subject to these defenses (the threat model is the opposite direction).

## Astro CVE non-exploitability

`pnpm audit` reports **GHSA-wrwg-2hg8-v723** (HIGH) — *Astro reflected XSS via the server islands feature* — against `astro@4.16.19` in `packages/web`. The fix is `astro@>=5.15.8`, a major-version upgrade.

**This advisory is non-exploitable for wyreup.com.** Evidence:

- `packages/web` is configured with `output: 'static'` (SSG only — no SSR runtime, no Pages Functions).
- The vulnerable surface is the `server:defer` directive. `grep -rn 'server:defer\|server-islands\|serverIslands' packages/web/src` returns **zero matches**. Every island in the codebase uses `client:load` (browser-side Svelte hydration), which the advisory does not affect.

**The non-exploitability is enforced by CI.** The `web-security-invariants` job in `.github/workflows/ci.yml` fails any PR that introduces an Astro `server:` directive into `packages/web/src`. Re-introducing the vulnerable surface would require either removing that CI step or completing an Astro 4 → 5 + Svelte 4 → 5 migration first (~15 `client:load` components plus PWA reconfig).

The audit job runs with `continue-on-error: true` only because of this one advisory. New high/critical advisories still surface in PR checks. The audit gate will be flipped to required when either Astro ships a 4.x backport, or when a real driver (feature need / advisory affecting a surface we actually use) justifies the Astro 5 migration.

## What this does NOT defend against

Open work, in priority order:

1. **Raw socket egress** — the fetch egress lock does not intercept `node:http`, `node:https`, `node:net`, `node:dgram`, or native-extension sockets. A compromised dependency that uses raw sockets can still exfiltrate.
2. **Subprocesses spawned by tools** — not sandboxed.
3. **DNS-channel exfiltration** — allowed origin still resolves DNS; a compromised dependency could encode data in DNS queries.
4. **MCP clients that ignore capability annotations** — `openWorldHint` / `idempotentHint` are advisory.
5. **Image-dimension budgets** — PDF page-count and audio/video duration budgets ship in `@wyreup/core`. Image-dimension budgets are not declared per-tool yet; sharp/jsquash enforce internal limits, and `WYREUP_MAX_INPUT_BYTES` caps total bytes.
6. **Pre-populated manifest** — `worker-models` ships streaming SHA-256 verification via `crypto.DigestStream`, but the manifest itself starts empty. Until populated (via `pnpm --filter @wyreup/worker-models populate-manifest`) and `STRICT_VERIFICATION = true` is flipped, unverified paths pass through. Streaming SHA covers all model sizes including m2m100 (~1 GB) — the prior 100 MB buffered cap is removed.

## Dependency hygiene

- `pnpm audit --prod --audit-level=high` runs in CI and is **blocking**. It was
  previously `continue-on-error`; that soft failure let nine HIGH advisories
  accumulate unseen, because a soft-failing job reads as a passing run. Don't
  reach for `continue-on-error` to get past it — patch the dependency, add a
  `pnpm.overrides` entry, or record a written non-exploitability argument in
  `pnpm.auditConfig` and a section here.
- Dependabot proposes weekly grouped updates; security/parser libs (DOMPurify, JSZip, pdfjs-dist, MCP/Anthropic SDKs) are flagged for prioritized review.
- Root `package.json` `pnpm.overrides` pins `fast-uri`, `protobufjs`, `serialize-javascript`, `devalue`, `sharp` and `adm-zip` to versions that close known transitive advisories.

## sharp / libvips, and why overrides don't reach consumers

`@huggingface/transformers` depends on `sharp@^0.34.5`. sharp below 0.35.0
inherits libvips advisories CVE-2026-33327, -33328, -35590 and -35591.

The root `pnpm.overrides` entry pins sharp to `^0.35.3`, which protects this
repo: local builds, CI, and everything deployed to Pages. **It does not protect
consumers of the published packages.** Overrides — pnpm's, npm's, and yarn's
`resolutions` — are only honoured in the root project doing the install. They
are not part of the published manifest.

Two fixes were tested and rejected on evidence, not assumption:

- Declaring `sharp@^0.35.3` directly in `@wyreup/core`. `^0.34.5` resolves to
  `>=0.34.5 <0.35.0`, so the ranges are disjoint: npm installs 0.35.3 hoisted
  *and* 0.34.5 nested under transformers, and transformers loads the nested
  copy. Confirmed by installing into a scratch project.
- Waiting on upstream. `4.2.0` is the current latest and still pins `^0.34.5`;
  the `next` tag is older.

What was done instead: `@huggingface/transformers` became an **optional peer
dependency** of `@wyreup/core`. Only 12 of ~276 tools need it, so the remaining
264 no longer drag in a vulnerable transitive dependency. Consumers who want the
AI tools install the peer themselves, which puts sharp in *their* root where an
override works:

```json
{ "overrides": { "sharp": "^0.35.3" } }
```

Verified by packing core and installing it into a clean project: sharp is no
longer present at all, and `npm audit` reports no HIGH advisories. Previously
the same test yielded sharp 0.34.5.

**Residual exposure:** `@wyreup/cli` and `@wyreup/mcp` are applications rather
than libraries, so they declare transformers directly to keep AI tools working
out of the box — and therefore still resolve sharp `<0.35.0` transitively.
Operators running either in production and processing untrusted images should
pin `sharp` in their own project root. This can only be closed properly upstream
in transformers; revisit when a release moves off `^0.34.5`, at which point the
`sharp` override here and the peer-dependency split can both be reconsidered.

## Production deployment checklist

For operators running `@wyreup/mcp` or `@wyreup/cli` in production:

- [ ] Set `WYREUP_ALLOW_PATHS` explicitly — don't rely on the CWD + tmpdir default
- [ ] Set `WYREUP_AUDIT_LOG` to a path on persistent storage if compliance requires call tracking
- [ ] Set `WYREUP_AUDIT_REQUIRED=1` if audit-write failure should fail the call (default is loose)
- [ ] Do NOT set `WYREUP_DISABLE_WORKER_ISOLATION` or `WYREUP_DISABLE_EGRESS_LOCK` in production
- [ ] Do NOT set `WYREUP_ALLOW_PATHS=*` in production
- [ ] Treat `WYREUP_API_KEY` as a secret (file mode `0o600` in `~/.wyreup/config.json` for CLI, env var for MCP)
- [ ] Audit log files have mode `0o600` on creation — preserve that mode in rotation
