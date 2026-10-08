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
| **Cloudflare worker** (`@wyreup/worker-models`, `models.wyreup.com`) | Supply-chain proxy for AI model assets; bandwidth/storage abuse | Hard allowlist of HuggingFace slugs + version-pinned prefixes; path-traversal rejection; method allowlist (GET/HEAD/OPTIONS). ONNX runtime assets require exact pinned lengths and native R2 SHA-256 verification before serving, with a 120 s fetch timeout. Other model assets retain the 1.5 GB streaming cap and 30 s timeout. Immutable headers apply to successful responses. |

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

HTML rendering must preserve these boundaries:

- Tool-page JSON-LD uses trusted server-derived metadata, not user input.
- Share-receive templates use literal HTML without interpolating user input.
- The layout search dropdown escapes tool fields with `escapeHtml()` and builds URL parameters with `URLSearchParams`.
- HTML result runners (`TextResultRunner`, `TextInputRunner`, `TwoTextInputRunner`) sanitize tool-produced HTML with `DOMPurify.sanitize()`.

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

## Web framework and remote image cache

The website uses Astro 7 and Svelte 5. Astro pages remain statically generated;
separate Cloudflare Pages Functions implement API routes. The
`web-security-invariants` CI job rejects Astro `server:` directives in page source.

The exact-version Astro patch removes the unused remote-image HTTP cache and
its `http-cache-semantics` dependency. Remote image requests revalidate rather
than trusting cached policy decisions. `check:remote-cache` exercises expiry,
conditional requests, empty responses and errors against the installed patched
source. Astro upgrades must review and replace the patch before installation.

## What this does NOT defend against

Open work, in priority order:

1. **Raw socket egress** — the fetch egress lock does not intercept `node:http`, `node:https`, `node:net`, `node:dgram`, or native-extension sockets. A compromised dependency that uses raw sockets can still exfiltrate.
2. **Subprocesses spawned by tools** — not sandboxed.
3. **DNS-channel exfiltration** — allowed origin still resolves DNS; a compromised dependency could encode data in DNS queries.
4. **MCP clients that ignore capability annotations** — `openWorldHint` / `idempotentHint` are advisory.
5. **Image-dimension budgets** — PDF page-count and audio/video duration budgets ship in `@wyreup/core`. Image-dimension budgets are not declared per-tool yet; sharp/jsquash enforce internal limits, and `WYREUP_MAX_INPUT_BYTES` caps total bytes.
6. **Pre-populated manifest** — `worker-models` ships streaming SHA-256 verification via `crypto.DigestStream`, but the manifest itself starts empty. Until populated (via `pnpm --filter @wyreup/worker-models populate-manifest`) and `STRICT_VERIFICATION = true` is flipped, unverified paths pass through. Streaming SHA covers all model sizes including m2m100 (~1 GB) — the prior 100 MB buffered cap is removed.

## Dependency hygiene

- CI blocks on both production and complete dependency audits at every severity.
  No advisory exclusions or soft failures are permitted.
- Dependabot proposes weekly grouped updates; security and parser libraries
  require compatibility checks alongside the audit.
- Workspace overrides affect repository installations only. Published package
  safety is checked by installing actual release tarballs into isolated npm and
  pnpm projects without consumer overrides. Normal and disabled install scripts
  are covered, with full audits and a walk of nested dependency versions.
- Runtime releases require Node 22.13 or a supported newer release. OpenPGP 6
  keeps standard version-4 keys compatible but rejects legacy version-5 keys by
  default; see the package READMEs for migration guidance.

## AI dependencies and existing consumer locks

Core keeps the official `@huggingface/transformers` runtime as an optional peer;
CLI and MCP include it for their AI tools. The supported range starts at
Transformers 4.3.1. Clean-consumer checks require native ONNX CPU inference,
image decoding, and patched nested versions, including sharp 0.35.5 or newer.

Existing lockfiles can retain an older vulnerable version allowed by an upstream
range. Updating Wyreup alone does not guarantee that transitive locks refresh.
Update the dependency graph and audit it:

```sh
npm update
npm audit
# or
pnpm update --depth Infinity
pnpm audit
```

The consumer gate retains before/after locks and audits for a seeded vulnerable
Transformers/sharp graph and requires the updated graph to pass without overrides.

## Maintained library distributions and release artifacts

`@wyreup/exceljs` and `@wyreup/mammoth` are scoped library distributions built
from pinned upstream archives. They retain upstream licenses and provenance,
rebuild browser bundles from declared dependencies, and verify generated-file
inventories before packing. ExcelJS compatibility changes preserve file and
stream APIs; Mammoth excludes upstream CLI-only dependencies.

Release artifacts record the source commit, versions and tarball hashes. CI
verifies exact tarballs before consumer tests; publishing uses those artifacts.
Changesets owns version bumps. Repository audits and a successful source push
alone do not establish that npm consumers received the release.

## Production deployment checklist

For operators running `@wyreup/mcp` or `@wyreup/cli` in production:

- [ ] Set `WYREUP_ALLOW_PATHS` explicitly — don't rely on the CWD + tmpdir default
- [ ] Set `WYREUP_AUDIT_LOG` to a path on persistent storage if compliance requires call tracking
- [ ] Set `WYREUP_AUDIT_REQUIRED=1` if audit-write failure should fail the call (default is loose)
- [ ] Do NOT set `WYREUP_DISABLE_WORKER_ISOLATION` or `WYREUP_DISABLE_EGRESS_LOCK` in production
- [ ] Do NOT set `WYREUP_ALLOW_PATHS=*` in production
- [ ] Treat `WYREUP_API_KEY` as a secret (file mode `0o600` in `~/.wyreup/config.json` for CLI, env var for MCP)
- [ ] Audit log files have mode `0o600` on creation — preserve that mode in rotation
