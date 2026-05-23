# Spec: Pro on CLI + MCP

**Status:** Approved scope, implementation next session.
**Author:** Drafted 2026-05-23.
**Supersedes nothing — extends pro-auth-spec.md §6 (the auth model section explicitly notes "CLI/MCP variant ships when ToolRunContext carries an API key.")

---

## Goal

Make every Pro tool runnable from the CLI (`wyreup transcribe-pro audio.mp3`) and from any MCP-connected agent (Claude.ai, Claude Code, any LangGraph/CrewAI/OpenAI Agents app), using the same API key and the same credit balance as the web surface.

Today: 30 Pro tools are web-only. The server already supports Bearer-token
auth; the gap is purely client-side plumbing. Closing it converts the
entire MCP/agent ecosystem and the CLI user base into potential Pro
customers without a browser detour.

---

## Audited current state

Server (already done):
- `functions/_lib/auth.ts:16-62` — `resolveUser()` accepts both
  `wyreup_session` cookie AND `Authorization: Bearer <key>`. Hashes the
  raw key with `sha256hex`, compares against `api_keys.key_hash`,
  rejects revoked keys.
- `functions/api/tools/pro/run.ts` — routes through `resolveUser()`,
  so a valid Bearer token works for the run endpoint today.
- `/api/account/balance` — same pattern.

Client gap:
- `packages/core/src/lib/pro-runner.ts:43` — uses
  `fetch('/api/tools/pro/run', { credentials: 'same-origin' })`. Assumes
  cookie auth, browser context.
- `packages/core/src/types.ts:102-112` — `ToolRunContext` doesn't carry
  an API key.
- All 30 Pro tool modules ship `surfaces: ['web']`.
- `packages/cli/src/index.ts:274` and `packages/mcp/src/server.ts:138`
  filter the registry via `toolRunsOnSurface(t, 'cli'|'mcp')`, so Pro
  tools never appear.
- CLI has no API key storage today.
- MCP server has no auth surface today.

---

## Threat model

Adding Pro on CLI/MCP introduces new credential-handling surfaces. New
risks to design against:

1. **Local API key exfiltration.** A key stored in `~/.wyreup/config.json`
   leaks to anyone with read access to that file. Mitigation: write the
   file with mode `0600`, document explicitly, and offer
   `WYREUP_API_KEY` env var as the "I'd rather not put it on disk" path.
   (Defer OS keychain integration to a v2 — `keytar`/Win Credential
   Manager/macOS Keychain are platform-specific and out of v1 scope.)

2. **Accidental commit of the key.** Add `~/.wyreup/` to a documented
   `.gitignore` recommendation. Mention in the `wyreup login` output.

3. **MCP server running on a multi-user machine.** The MCP server reads
   `WYREUP_API_KEY` from env. If the user starts it for themselves but a
   second OS user can read the process env, they can grab the key. Out
   of scope — same as any process env handling. Documented as "MCP
   server inherits the env it was launched from; don't share."

4. **No key rotation flow today.** Out of scope for this spec — already
   handled by `/account/keys` page where users can revoke and re-issue.
   CLI just needs to react to 401s by prompting `wyreup login` again.

NOT in scope (handled elsewhere):
- Server-side auth (already done — `resolveUser`)
- Credit ledger (append-only, idempotent, already audited)
- Rate limiting (already in `functions/api/tools/pro/run.ts`)
- Refund-on-failure (already done)

---

## Design

### 1. `ToolRunContext` carries an optional API key

`packages/core/src/types.ts`:

```ts
export interface ToolRunContext {
  onProgress: (p: ToolProgress) => void;
  signal: AbortSignal;
  cache: Map<string, unknown>;
  executionId: string;
  /**
   * Caller-supplied API key for Pro tools. Required when running a Pro
   * tool outside the browser (CLI, MCP). Ignored in the browser, which
   * uses the wyreup_session cookie instead.
   */
  apiKey?: string;
  /**
   * Origin to POST Pro requests to. Defaults to current origin in the
   * browser (relative URL); CLI/MCP must set this to the production
   * URL so fetch() resolves correctly.
   */
  proOrigin?: string;
}
```

### 2. `runPro` picks cookie vs Bearer based on context

`packages/core/src/lib/pro-runner.ts`:

```ts
const isBrowser = typeof window !== 'undefined';
const base = ctx.proOrigin ?? '';  // '' = same-origin in browser
const url = `${base}/api/tools/pro/run`;

const headers: HeadersInit = { 'Content-Type': 'application/json' };
const init: RequestInit = {
  method: 'POST',
  headers,
  body: JSON.stringify({ toolId, input }),
  signal: ctx.signal,
};

if (isBrowser && !ctx.apiKey) {
  // Browser path — rely on the wyreup_session cookie.
  init.credentials = 'same-origin';
} else {
  // CLI / MCP path — Bearer.
  if (!ctx.apiKey) {
    throw new Error('PRO tools require an API key in CLI/MCP. Run `wyreup login` or set WYREUP_API_KEY.');
  }
  (headers as Record<string, string>).Authorization = `Bearer ${ctx.apiKey}`;
}

const res = await fetch(url, init);
// ... existing 401/402/429 handling, no change
```

The `wyreup:balance-changed` dispatch is already guarded for
`typeof window !== 'undefined'` — no change.

### 3. Open the Pro tool surfaces

Drop `surfaces: ['web']` from all 30 Pro tool modules. (Or set to
`['web', 'cli', 'mcp']` explicitly — either works since `undefined`
= all surfaces by convention.) Dropping is preferred — less to
maintain.

Affected files (auto-find by grep):
```bash
grep -rln "surfaces: \['web'\]" packages/core/src/tools/
```

### 4. CLI credential storage

New file: `packages/cli/src/lib/credentials.ts`.

```ts
// Read order: env var → config file. Write to config file only via
// the explicit `wyreup login` command — never silently.

import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.wyreup');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

interface Config {
  apiKey?: string;
}

export async function readApiKey(): Promise<string | null> {
  // 1. Env var wins — useful for CI and ephemeral shells.
  const fromEnv = process.env.WYREUP_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();

  // 2. Config file fallback.
  try {
    const text = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(text) as Config;
    return parsed.apiKey?.trim() || null;
  } catch {
    return null;
  }
}

export async function writeApiKey(key: string): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify({ apiKey: key }, null, 2), 'utf8');
  await chmod(CONFIG_PATH, 0o600);  // user-only read/write
}

export async function deleteApiKey(): Promise<void> {
  // For `wyreup logout`. Just zero out the file; don't unlink so any
  // user-added config keys stay.
  try {
    await writeFile(CONFIG_PATH, JSON.stringify({}, null, 2), 'utf8');
    await chmod(CONFIG_PATH, 0o600);
  } catch {
    // No file = nothing to log out from.
  }
}
```

### 5. CLI commands

New: `packages/cli/src/commands/login.ts`
- Prompt for API key (or accept as `wyreup login <key>` positional arg)
- Validate by hitting `/api/account/balance` with Bearer
- On 200: write to `~/.wyreup/config.json` with 0600
- Print: "Logged in as <email>. Balance: <N> credits." + a one-line
  reminder that the key lives at `~/.wyreup/config.json` and to
  gitignore that path if relevant

New: `packages/cli/src/commands/logout.ts`
- Zero out the config file
- Print: "Logged out. Use `wyreup login` to sign back in."

New: `packages/cli/src/commands/balance.ts`
- Hit `/api/account/balance` with Bearer
- Print balance + subscription status

Modified: `packages/cli/src/index.ts`
- On Pro-tool dispatch, call `readApiKey()`, populate
  `ctx.apiKey` and `ctx.proOrigin` (defaults to `https://wyreup.com`
  — overridable via `WYREUP_ORIGIN` env var for testing)
- If key missing, print "This is a PRO tool. Run `wyreup login`
  first." and exit 2

### 6. MCP server changes

Modified: `packages/mcp/src/server.ts`
- Read `WYREUP_API_KEY` and `WYREUP_ORIGIN` from process env at
  startup
- When dispatching a tool, inject `ctx.apiKey` and `ctx.proOrigin`
- If the key is missing, list/list-only the FREE tools and print to
  stderr: "WYREUP_API_KEY not set — Pro tools hidden. Set it to enable
  them."
- Don't hard-fail the server without a key; downgrade gracefully

### 7. Onboarding copy updates

- `packages/web/src/pages/cli.astro` — add a "Sign in to use Pro
  tools" section: install, then `wyreup login`, then run any Pro tool
- `packages/web/src/pages/mcp.astro` — add a "Pro tools in MCP"
  section: get a key at `/account`, set `WYREUP_API_KEY` in your MCP
  config, restart the MCP server, run tools
- `README.md` — update the line that said "CLI/MCP support is on the
  roadmap" to reflect that it shipped, with the env-var + `wyreup
  login` examples
- `docs/pro-auth-spec.md` §6 — update the note that says CLI/MCP needs
  ToolRunContext to carry an API key (now it does)

### 8. Error handling outside the browser

`pro-runner.ts` already maps 401/402/429 to readable error messages.
In non-browser contexts, `runPro` throws a regular Error and the CLI
prints it to stderr / MCP returns it as a tool error result. No
special handling needed beyond what's already there.

One specific case to handle: 401 in CLI should hint "Your key may be
revoked — run `wyreup login` to set a new one." Add to the 401 path
in `pro-runner.ts`, gated on `!isBrowser`.

### 9. Tests

- `packages/cli/test/credentials.test.ts` — read/write/delete round-trip,
  env-var precedence, file permission verification (stat the file,
  check `0o600`)
- `packages/cli/test/login-command.test.ts` — mock fetch, verify
  on-success write, on-401 error path
- `packages/mcp/test/server-pro.test.ts` — mock the run endpoint,
  verify the Bearer header is set when `WYREUP_API_KEY` is in env
- `packages/core/test/lib/pro-runner.test.ts` — Bearer path with
  `ctx.apiKey`, cookie path without, missing-key throw

### 10. Rollout

No DB migration needed. No env var changes on the server. Pure
client + tool-module changes. Ship as a single PR; release notes
should call this out loudly because it's a meaningful capability
expansion.

Suggested release-note framing: *"Pro tools now run from the CLI
and MCP servers — same key, same balance, no browser detour. Set
your API key with `wyreup login` (CLI) or `WYREUP_API_KEY` (MCP),
and every Pro tool just works."*

---

## Out of scope (deferred)

- **OS keychain integration** (`keytar` / macOS Keychain / Windows
  Credential Manager). v2 once we have demand signal. The 0600
  config file is fine for v1.
- **Multi-account switching in the CLI.** Single account, single key.
  Most users have one wyreup account.
- **MCP server discovering a key via the user's web session.** No
  cross-context handoff — keep them independent.
- **CLI offline mode for Pro tools.** Pro tools always require the
  network; the cache layer on top is a separate problem.

---

## Estimated effort

- Engine + client (`ToolRunContext`, `pro-runner`, drop surfaces): half a
  session. **Shipped 2026-05-23 in commit `f7848e7`.**
- CLI (credentials, login/logout/balance commands, dispatch wiring,
  tests): one session. **Shipped 2026-05-23 in commit `6002e23`.**
- MCP (env-var injection, graceful degrade, tests): half a session.
  **Shipped 2026-05-23 in commit `bf54eb7`.**
- Docs (cli.astro, mcp.astro, README, pro-auth-spec): half a session.
  **Shipped 2026-05-23 in commit `98b4ce7`.**
- Inline auto-prompt for missing-key case (followup): half a session.
  **Shipped 2026-05-23 in `lib/interactive-login.ts`.**

**Total: shipped in one session 2026-05-23.**

---

## Appendix A — Browser-launch login (v2)

Out of scope for the v1 ship above. Captured here so it doesn't get
lost; not a blocker on anything queued.

**Goal:** replace the "go find your API key, copy-paste it" step with
a one-click flow modeled on `gh auth login`, `gcloud auth login`,
`npm login`.

**Flow:**
1. User runs `wyreup login --browser`.
2. CLI starts an ephemeral HTTP server on a free localhost port
   (`http://127.0.0.1:<port>/callback`). Port chosen by Node, not
   hardcoded, so multiple CLIs can run concurrently.
3. CLI generates a one-time, single-use random `state` token, opens
   the user's browser to
   `https://wyreup.com/cli-auth?port=<port>&state=<state>`. (Use
   `node:child_process` + platform-specific opener, with a printed
   URL fallback for headless environments.)
4. The wyreup.com page resolves the user's session, lets them pick
   an existing API key or mint a new one ("Authorize wyreup CLI on
   this device — name: macbook-pro"), then POSTs
   `{ apiKey, state }` to the localhost callback.
5. CLI validates `state`, validates the key against
   `/api/account/balance`, persists via `writeApiKey()`, exits.

**New server surface:**
- `/cli-auth` page on wyreup.com (Astro + ProSignup if logged out;
  key picker + "Send to CLI" button if logged in)
- No new API endpoint needed — the page POSTs directly to the
  localhost callback in the user's own browser.

**Security:**
- `state` is HMAC-signed with a session-secret so the localhost
  callback can verify the POST originated from the user's authorized
  browser session, not a drive-by.
- The localhost server only accepts a single POST then shuts down.
- Bind to `127.0.0.1` only, not `0.0.0.0`.

**Estimated effort:** ~1 session — the Astro page + a small Node
HTTP server in the CLI + state handling.

**Why this is queued, not shipped:** the inline auto-prompt (v1
covers the activation case for ~95% of users — they paste a key
they already have in their dashboard. Browser flow becomes valuable
when (a) the dashboard makes minting a key the natural next step
after signup, and (b) we want to eliminate the "find the dashboard"
step entirely. Revisit when signup → first-Pro-run conversion data
suggests the copy-paste is the bottleneck.
