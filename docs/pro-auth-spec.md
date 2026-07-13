# Wyreup PRO — Auth, Credits & Lemon Squeezy Spec

**Version:** 2.1  
**Status:** Ready for implementation  
**Stack:** Astro 4 + Svelte + Cloudflare Pages Functions + D1 + Lemon Squeezy  
**Principle:** Free tools stay free and open, forever. PRO is opt-in. One auth mechanism everywhere.

---

## 1. Philosophy

- **No account required** to use any free tool. The anonymous experience is unchanged.
- **One auth mechanism:** API key. Works in the browser, CLI, and MCP without special cases.
- **Account = API key + credit balance + saved chains + run history.**
- **Credits = fuel for PRO tools.** One-time purchase, no subscription, no expiry.
- **Lemon Squeezy** handles payment, VAT, receipts, refunds. Wyreup never touches a card number.

---

## 2. What Requires PRO

The `ToolModule` interface in `@wyreup/core` already has `cost: 'free' | 'credit'` — we reuse it and add a `creditCost?: number`:

```ts
export interface ToolModule<Params = unknown> {
  // ... existing fields
  cost: 'free' | 'credit';     // existing; 'credit' = PRO
  creditCost?: number;          // credits consumed per run (PRO tools only)
}
```

Earlier drafts proposed a separate `tier: 'free' | 'pro'` field. Dropped — it would have been a synonym for `cost: 'credit'` and the existing field was already in the type, just unused.

### Dual-version tools (free + PRO)

Each version is its own registry entry with its own `id`. Don't try to encode "this tool has both a free and a pro mode" in a single entry — UI gate, credit cost, run history, and routing all key off the tool id, and the two implementations usually live in different code paths anyway.

```
transcribe         → cost: 'free' (small quantized, in-browser)
transcribe-pro     → cost: 'credit', creditCost: 5 (Whisper large-v3, hosted)
```

The UI shows them as one tool with a "Free / PRO" toggle; selecting PRO swaps the active tool id.

### PRO tool candidates (hosted model inference)

| Tool ID | Credit Cost | Why PRO |
|---------|-------------|---------|
| `transcribe-pro` | 5 | Whisper large-v3 hosted |
| `text-summarize-pro` | 3 | LLM summarization |
| `text-translate-pro` | 3 | LLM translation |
| `text-sentiment-pro` | 2 | LLM sentiment |
| `text-ner-pro` | 2 | LLM named entity |
| `bg-remove-pro` | 4 | Large RMBG model |
| `upscale-2x-pro` | 4 | Large upscale model |
| `text-redact-pro` | 3 | PII detection via LLM |
| `translate-document-pro` | 3 | Whole-document PDF/text translation with hosted m2m100 |

The server keeps its own authoritative price map in `functions/_lib/pricing.ts` — the client's `creditCost` is for UI display only.

**Free tier of PRO tools:** Small/quantized local versions remain free under the bare tool id. PRO unlocks the hosted high-quality version. The free version genuinely works — PRO is just better.

---

## 3. API Key Design

### Format

```
wk_live_<64 hex chars>   ← production
wk_test_<64 hex chars>   ← sandbox / dev
```

32 random bytes from `crypto.getRandomValues`, hex-encoded (64 chars). Shown **once** at creation — never stored in plain text, only SHA-256 hash stored in D1.

### How it works everywhere

| Surface | How the key is used |
|---------|--------------------|
| **Browser** | User pastes key once. Server exchanges it for a signed `wyreup_session` cookie (24h TTL). Raw key never written to `localStorage`. Re-paste on cookie expiry; password manager autofill handles repeat visits. See §7. |
| **CLI** | `wyreup auth set <key>` — saved to `~/.wyreup/credentials` or OS keychain. Sent as `Authorization: Bearer wk_live_...` on every request. |
| **MCP** | `WYREUP_API_KEY=wk_live_...` env var in MCP config. Same header. |

All three surfaces resolve to the same user via `resolveUser()` (§6), which accepts either the cookie (browser) or the Bearer header (CLI/MCP).

---

## 4. Data Model (Cloudflare D1)

### Setup

This app deploys as Cloudflare **Pages Functions**, not a standalone Worker. The D1 binding lives in the Pages project, configured either:

- via the Pages dashboard → Settings → Functions → D1 bindings, or
- via `wrangler.toml` at the repo root (Pages reads it when `pages_build_output_dir` is set):

```toml
# wrangler.toml (repo root, for the Pages project)
name = "wyreup"
pages_build_output_dir = "dist"
compatibility_date = "2026-01-01"

[[d1_databases]]
binding = "DB"
database_name = "wyreup-prod"
database_id = "<to be created>"
```

All `/api/*` routes live under `functions/api/` and receive `env.DB` via the Pages Functions context.

### Schema

```sql
-- Users
CREATE TABLE users (
  id          TEXT PRIMARY KEY,       -- nanoid, e.g. "usr_abc123"
  email       TEXT UNIQUE NOT NULL,
  created_at  INTEGER NOT NULL,       -- unix ms
  last_seen   INTEGER
);

-- API keys (supports multiple keys per user)
CREATE TABLE api_keys (
  id          TEXT PRIMARY KEY,       -- nanoid
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash    TEXT NOT NULL UNIQUE,   -- SHA-256(raw_key), hex
  name        TEXT NOT NULL,          -- "Browser", "MacBook CLI", "Cursor MCP"
  last_used   INTEGER,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER                 -- NULL = active
);

-- Credit ledger (append-only, never update rows)
CREATE TABLE credit_events (
  id          TEXT PRIMARY KEY,       -- nanoid
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,          -- 'purchase' | 'spend' | 'refund' | 'bonus'
  amount      INTEGER NOT NULL,       -- positive = credit, negative = debit
  tool_id     TEXT,                   -- set for 'spend' events
  ls_order_id TEXT,                   -- set for 'purchase' events
  note        TEXT,
  created_at  INTEGER NOT NULL
);

-- Saved chains (synced to account)
CREATE TABLE saved_chains (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  steps       TEXT NOT NULL,          -- JSON
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Tool run history
CREATE TABLE run_history (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id      TEXT NOT NULL,
  tier         TEXT NOT NULL,         -- 'free' | 'pro'
  credits_used INTEGER NOT NULL DEFAULT 0,
  file_name    TEXT,                  -- original filename only, no content stored
  ran_at       INTEGER NOT NULL
);

CREATE INDEX        idx_api_keys_hash    ON api_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX        idx_credit_user      ON credit_events(user_id, created_at DESC);
CREATE INDEX        idx_history_user     ON run_history(user_id, ran_at DESC);
CREATE INDEX        idx_chains_user      ON saved_chains(user_id);
CREATE UNIQUE INDEX idx_credit_ls_order  ON credit_events(ls_order_id) WHERE ls_order_id IS NOT NULL;
```

`idx_credit_ls_order` is the idempotency guarantee for webhooks — `INSERT OR IGNORE` (or `ON CONFLICT DO NOTHING`) on `ls_order_id` is now safe across concurrent retries.

### Credit balance

Derived from the ledger — never a stored column:

```sql
SELECT COALESCE(SUM(amount), 0) AS balance
FROM credit_events
WHERE user_id = ?;
```

Append-only ledger = auditable history, trivial refunds, no balance drift bugs.

---

## 5. Account Creation Flow

```
User: clicks "Get API Key" (header or PRO tool gate)
  → Modal: "Enter your email"
  → POST /api/account/create  { email, surface: 'browser' | 'cli' }
      Server:
        1. Rate limit: per email (5/day) AND per IP (10/day). Reject with 429 otherwise.
        2. If email exists:
             a. Do NOT issue a new key. Do NOT touch the existing user row.
             b. Send a "someone tried to create an account with your email" notice
                (links to /account for key management, no key in the email).
             c. Return { status: 'exists' } — same response shape as new-user path
                to avoid leaking which emails are registered.
        3. If new:
             a. INSERT into users
             b. Generate raw key: 32 random bytes (crypto.getRandomValues) → hex → prefix
             c. INSERT into api_keys { key_hash: sha256(raw), name: 'Default', user_id }
             d. Send welcome email with the raw key (Resend / MailChannels)
             e. surface === 'browser': return { status: 'created', rawKey, keyPreview }
                surface === 'cli':     return { status: 'created', keyPreview }  (no rawKey)
      Email body (new user):
        "Your Wyreup API key: wk_live_[full key]
         Save this — we don't store it and can't show it again.
         Paste it at wyreup.com/account to activate PRO."
  → Browser: shows the key once in a "Copy your key" modal (also points user to email).
  → CLI:     "Check your email — your key is waiting."
```

The raw key is shown **at most twice**: once in the browser create-modal (if the request originated there), and once in the welcome email. After the modal closes and the email is sent, the raw value is unrecoverable. CLI / MCP creation flows do not return the raw key in the response — email is the only channel — so a stolen request log can't leak it.

If lost, user generates a new key from `/account` (old one is revoked).

**Why the existing-email branch never issues a new key:** the email field is not verified at submission time. Letting a stranger POST `victim@example.com` and trigger a new live key for that account would be account hijack via inbox spam. Key rotation must happen from `/account` while authenticated.

---

## 6. Key Resolution (Server)

Every authenticated API route runs this. It accepts an `Authorization: Bearer` header (CLI/MCP path) or the `wyreup_session` cookie set by `/api/account/verify` (browser path).

```ts
async function resolveUser(request: Request, env: Env): Promise<User | null> {
  // 1. Cookie path (browser)
  const cookie = parseCookies(request.headers.get('Cookie'))['wyreup_session'];
  if (cookie) {
    const payload = await verifySessionCookie(cookie, env.SESSION_SECRET);
    if (payload) {
      // Cheap lookup — we still need email + confirm key not revoked
      const row = await env.DB.prepare(`
        SELECT u.id, u.email
        FROM users u
        JOIN api_keys ak ON ak.user_id = u.id
        WHERE u.id = ? AND ak.id = ? AND ak.revoked_at IS NULL
      `).bind(payload.uid, payload.kid).first();
      if (row) return { id: row.id, email: row.email };
    }
  }

  // 2. Bearer path (CLI / MCP)
  const auth = request.headers.get('Authorization');
  const raw = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!raw) return null;

  const hash = await sha256hex(raw);
  const row = await env.DB.prepare(`
    SELECT ak.user_id, ak.id AS kid, u.email
    FROM api_keys ak
    JOIN users u ON u.id = ak.user_id
    WHERE ak.key_hash = ? AND ak.revoked_at IS NULL
  `).bind(hash).first();

  if (!row) return null;

  // Fire-and-forget: update last_used (D1 .run() returns a promise; ignore it)
  env.DB.prepare('UPDATE api_keys SET last_used = ? WHERE key_hash = ?')
    .bind(Date.now(), hash).run();

  return { id: row.user_id, email: row.email };
}
```

One D1 lookup per authenticated request. Cookie verification is HMAC-only (no DB hit needed to verify the signature; the JOIN above is still needed to confirm the underlying key wasn't revoked since the cookie was issued — revocation must take effect immediately).

---

## 7. Browser Key Entry UX

In `AuthModal.svelte` — a simple input, not a login form:

```
┌─────────────────────────────────────────┐
│  Enter your API key to use PRO tools    │
│                                         │
│  [wk_live_................................] │
│                                         │
│  [Activate]   Don't have one? Get one → │
└─────────────────────────────────────────┘
```

### Session model

The raw key is too valuable to keep in `localStorage`, but forcing re-entry on every page load is hostile. Compromise: the key is exchanged for a short-lived signed session cookie.

- On `[Activate]`: POST `/api/account/verify` with `Authorization: Bearer wk_live_...`
  - Server resolves the key, then sets a cookie:
    ```
    Set-Cookie: wyreup_session=<uid>.<kid>.<exp>.<hmac>;
                Domain=wyreup.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400
    ```
    Format and sign/verify helpers in §18. `SameSite=Lax` (not `Strict`) so the cookie survives the top-level redirect back from `lemonsqueezy.com` after checkout; `Lax` still blocks third-party iframe/image/CORS use, which is what we need here.
  - Response body: `{ email, balance }`
- Subsequent PRO API calls succeed with **either** the cookie **or** an `Authorization` header. The cookie path is what the browser uses by default; CLI/MCP still send the header.
- Key itself is held in `$apiKey` (Svelte store, memory only) just long enough to call `/verify`; after that the store is cleared and `$user` drives UI state.
- Cookie expiry (24h default) → next visit, user re-pastes the key. Password manager autofill handles this for users who saved it.
- `[Sign out]` → POST `/api/account/signout` → server clears the cookie. Underlying API key remains valid.
- "Get one →" triggers the account creation modal.

Server-side, `resolveUser()` (§6) accepts either auth path — see updated implementation there.

---

## 8. Multiple Keys Per User

Supported from day one via the `api_keys` table. Use cases:
- Separate key for CLI vs. MCP vs. browser
- Revoke a compromised key without losing account access
- Name keys for clarity: "MacBook CLI", "Cursor", "Browser"

Managed from `/account` → API Keys section:

```
API Keys

  Default          Last used: 2 hours ago    [Revoke]
  MacBook CLI      Last used: Yesterday      [Revoke]
  Cursor MCP       Last used: 5 days ago     [Revoke]

  [+ New Key]
```

New key flow: name it → generate → shown once in a modal → copy and close.

---

## 9. PRO Tool Gate (Client)

When a user tries to run a PRO tool in the browser:

1. `ToolRunner.svelte` checks `tool.cost === 'credit'`
2. Not signed in (no `wyreup_session` cookie / no `$user`) → show `<AuthModal>` ("Enter your API key")
3. Signed in, balance = 0 → show `<BuyCreditsSheet>`
4. Signed in, balance ≥ `creditCost` → POST `/api/tools/pro/run`
5. The server deducts atomically and returns the result. The client never POSTs a separate "spend" call — there is no `/api/credits/spend` endpoint. On 402 the client re-checks balance (server may have raced) and reopens `<BuyCreditsSheet>` if still short.

---

## 10. PRO Tool Worker Endpoint

`POST /api/tools/pro/run`

**Ordering: reserve credits first, run the model second, refund on failure.** A naive "check balance → run → deduct" sequence has two race bugs: (a) two parallel requests both pass the check and overspend, and (b) if the model run fails between check and deduct, no record exists at all. The reserve-and-refund pattern below fixes both.

```ts
export async function POST({ request, env }) {
  const user = await resolveUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { toolId, input } = await request.json();
  const creditCost = PRICING[toolId];                           // server-authoritative
  if (!creditCost) return json({ error: 'Not a PRO tool' }, 400);

  // 1. Reserve credits atomically. The INSERT only happens if current balance
  //    is sufficient — guarded by a subquery against the same ledger. D1
  //    serializes writes per-DB, so concurrent requests at the boundary are
  //    safe: at most one will satisfy the WHERE clause and insert.
  const spendId = nanoid();
  const reserved = await env.DB.prepare(`
    INSERT INTO credit_events (id, user_id, kind, amount, tool_id, note, created_at)
    SELECT ?, ?, 'spend', ?, ?, ?, ?
    WHERE (
      SELECT COALESCE(SUM(amount), 0)
      FROM credit_events
      WHERE user_id = ?
    ) >= ?
  `).bind(
    spendId, user.id, -creditCost, toolId, `Ran ${toolId}`, Date.now(),
    user.id, creditCost,
  ).run();

  if (reserved.meta.changes !== 1) {
    return json({ error: 'Insufficient credits' }, 402);
  }

  // 2. Run the hosted model. On failure, refund the reservation idempotently.
  let result;
  try {
    result = await runHostedTool(toolId, input, env);
  } catch (err) {
    await env.DB.prepare(`
      INSERT INTO credit_events (id, user_id, kind, amount, tool_id, note, created_at)
      VALUES (?, ?, 'refund', ?, ?, ?, ?)
    `).bind(
      nanoid(), user.id, creditCost, toolId,
      `Refund for failed run ${spendId}`, Date.now(),
    ).run();
    return json({ error: 'Run failed', detail: String(err) }, 502);
  }

  // 3. Log run history (no file content, just filename for the user's own UI)
  await env.DB.prepare(`
    INSERT INTO run_history (id, user_id, tool_id, tier, credits_used, file_name, ran_at)
    VALUES (?, ?, ?, 'pro', ?, ?, ?)
  `).bind(nanoid(), user.id, toolId, creditCost, input.fileName ?? null, Date.now()).run();

  return json({ result });
}
```

Trade-off: a model run that succeeds but whose response fails to reach the client (network drop after step 2) leaves credits deducted with no result returned. This is the standard at-most-once charge problem and is acceptable for low credit costs (≤5); for higher-cost tools later we can add a client-supplied idempotency key and stash the result keyed by it for a few minutes.

---

## 11. Lemon Squeezy Integration

### Credit Packs (one-time products)

| Pack | Credits | Price | Notes |
|------|---------|-------|-------|
| Starter | 220 | $5 | First-time buyers |
| Standard | 480 | $10 | Best value callout |
| Power | 1000 | $20 | Heavy users |

~$0.020/credit gross (~$0.018 net of Lemon Squeezy fees). A 2-credit
text-summarize-pro run = $0.04 net revenue. Worst-case Pro tool today is
chat-long-pdf-pro on Kimi K2.5 (~$0.015/run) — at 2 credits that clears
the 50% margin floor on every pack and on the $8/mo subscription.

Monthly subscription: $8 / 440 credits per cycle (best per-credit rate).

Pack sizes bumped +45% on 2026-05-22 alongside the Wave 1 Workers AI
expansion. The customer story: *"Every pack just got bigger — same price."*

### Checkout Flow

```
User: clicks "Buy Credits" → selects pack
  → POST /api/credits/checkout  { variantId }  [Authorization: Bearer wk_live_...]
      Server: resolve user, create LS checkout URL with:
        - variant ID for the selected pack
        - checkout_data.custom = { userId }
        - redirect_url = https://wyreup.com/account?purchase=success
      Return: { checkoutUrl }
  → Client: window.open(checkoutUrl)  ← new tab, user stays on current page
  → User pays on LS hosted page
  → LS fires webhook → POST /api/webhooks/lemonsqueezy
  → Original tab: polls GET /api/account/balance every 3s
  → Balance updates live when webhook lands
```

### Webhook Handler

`POST /api/webhooks/lemonsqueezy`

Handles `order_created` (credit purchase) and `order_refunded` (give credits back). Signature verification uses a constant-time compare to avoid leaking the expected MAC byte-by-byte. Idempotency is enforced at the DB layer via the `UNIQUE` index on `ls_order_id` (see §4) plus `INSERT OR IGNORE` — no TOCTOU window between SELECT and INSERT.

```ts
export async function POST({ request, env }) {
  // 1. Verify HMAC-SHA256 signature in constant time
  const sigHex = request.headers.get('X-Signature') ?? '';
  const body = await request.text();
  const expectedHex = await hmacSha256Hex(env.LS_WEBHOOK_SECRET, body);
  if (!timingSafeEqualHex(sigHex, expectedHex)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = JSON.parse(body);
  const event = payload.meta.event_name;
  const userId = payload.meta.custom_data?.userId;
  if (!userId) return new Response('Missing custom_data.userId', { status: 400 });

  // NOTE: verify against LS's current webhook payload shape before shipping.
  // The first_order_item field has been re-nested across API versions; the path
  // used here is for the v1 store webhook as of late 2025.
  const orderId = String(payload.data.id);

  if (event === 'order_created' && payload.data.attributes.status === 'paid') {
    const variant = payload.data.attributes.first_order_item.variant_id;
    const credits = VARIANT_CREDIT_MAP[variant];
    if (!credits) return new Response('Unknown variant', { status: 400 });

    // Idempotent insert — UNIQUE(ls_order_id) makes duplicates a no-op.
    await env.DB.prepare(`
      INSERT OR IGNORE INTO credit_events
        (id, user_id, kind, amount, ls_order_id, note, created_at)
      VALUES (?, ?, 'purchase', ?, ?, ?, ?)
    `).bind(
      nanoid(), userId, credits, orderId,
      `Purchased ${credits} credits`, Date.now(),
    ).run();

    return new Response('OK');
  }

  if (event === 'order_refunded') {
    // Look up the original purchase to know how many credits to reverse.
    const original = await env.DB.prepare(
      `SELECT amount FROM credit_events WHERE ls_order_id = ? AND kind = 'purchase'`
    ).bind(orderId).first<{ amount: number }>();
    if (!original) return new Response('OK');  // never credited; nothing to refund

    // Use a distinct ls_order_id for the refund row so UNIQUE doesn't collide
    // and the refund itself is idempotent across webhook retries.
    const refundKey = `${orderId}:refund`;
    await env.DB.prepare(`
      INSERT OR IGNORE INTO credit_events
        (id, user_id, kind, amount, ls_order_id, note, created_at)
      VALUES (?, ?, 'refund', ?, ?, ?, ?)
    `).bind(
      nanoid(), userId, -original.amount, refundKey,
      `Refund for order ${orderId}`, Date.now(),
    ).run();
    // Balance may go negative if user spent credits before the refund — that's
    // intentional. Negative balance blocks future PRO runs until topped up.

    return new Response('OK');
  }

  // Ignore subscription_*, order_updated (non-paid), etc.
  return new Response('OK');
}
```

`hmacSha256Hex` and `timingSafeEqualHex` are thin helpers around `crypto.subtle` — see §18 (Crypto helpers).

### Environment Variables (CF Pages secrets — never in code)

```
SESSION_SECRET=          # HMAC key for wyreup_session cookie (≥32 random bytes)

LS_API_KEY=              # Lemon Squeezy API key
LS_WEBHOOK_SECRET=       # Webhook signing secret
LS_STORE_ID=             # Your LS store ID
LS_VARIANT_STARTER=      # variant IDs after creating the 3 credit packs in LS
LS_VARIANT_STANDARD=
LS_VARIANT_POWER=

# Email — ZeptoMail (Zoho transactional, HTTP API). SMTP-based email cannot
# be sent from Workers/Pages Functions; this is the working path.
ZEPTOMAIL_TOKEN=         # "Zoho-enczapikey ..." token from Zoho → Mail Agents
ZEPTOMAIL_SENDER=        # verified from address, e.g. noreply@wyreup.com
ZEPTOMAIL_SENDER_NAME=   # display name, defaults to "Wyreup"

# Image-model provider (PRO tool inference for images) — current vendor is
# wrapped in functions/_lib/providers/image-models.ts; swap that file + this
# token together when changing backends.
IMAGE_MODEL_TOKEN=       # for bg-remove-pro, upscale-2x-pro
# Workers AI: bound via [ai] in wrangler.toml (binding name: AI). Used by
# transcribe-pro + all 5 text PRO tools. Not a secret.
```

Rotate `SESSION_SECRET` to invalidate every outstanding browser session at once (does not affect API keys themselves).

### Model routing

| PRO tool | Provider | Notes |
|---|---|---|
| `transcribe-pro` | Workers AI (`@cf/openai/whisper-large-v3-turbo`) | Native binding, no egress |
| `text-*-pro` (summarize/translate/sentiment/NER/redact) | Workers AI (Llama 3.3 70B or Mistral) | Same — cheapest path |
| `bg-remove-pro` | external image-model provider (RMBG-2.0) | HTTP API |
| `upscale-2x-pro` | external image-model provider (Real-ESRGAN) | HTTP API |

Self-host on Thunder Compute / R2 is a deliberate v2 — defer until one tool has steady volume.

---

## 12. Account Page (`/account`)

Only accessible after entering a valid API key in the browser.

Sections:
- **Credit balance** — large number, "N credits remaining" + "Buy more"
- **Buy Credits** — 3 pack cards, opens LS checkout in new tab
- **API Keys** — list with name, last used, revoke button; "+ New Key" action
- **Run history** — last 20 runs: tool name, date, credits used
- **Saved chains** — list with run / edit / delete

---

## 13. UI Components to Build

| Component | File | Notes |
|-----------|------|-------|
| `AuthModal.svelte` | `src/components/AuthModal.svelte` | API key input + "Get one" flow |
| `BuyCreditsSheet.svelte` | `src/components/BuyCreditsSheet.svelte` | 3 pack cards → LS checkout |
| `CreditBadge.svelte` | `src/components/CreditBadge.svelte` | "⚡ 220" in header when active |
| `ProBadge.svelte` | `src/components/ProBadge.svelte` | Small "PRO" chip on tool cards |
| `AccountMenu.svelte` | `src/components/AccountMenu.svelte` | Email + balance dropdown in header |

---

## 14. Header Changes

- **No key active:** `[Get PRO]` ghost button (right side)
- **Key active:** `[⚡ 220 credits]` badge + email dropdown
- Both trigger `AuthModal` — no page navigation, tool context preserved

---

## 15. Implementation Order

| Step | What |
|------|------|
| 1 | Create D1 database via `wrangler d1 create wyreup-prod`, apply schema (incl. `UNIQUE idx_credit_ls_order`) |
| 2 | Add `[[d1_databases]]` binding to `wrangler.toml` (Pages project) |
| 3 | Crypto helpers (§18): `sha256hex`, `hmacSha256Hex`, `timingSafeEqualHex`, session sign/verify |
| 4 | `/api/account/create` — rate limit (per email + per IP) → user row → generate key → send email; existing-email path sends notice only |
| 5 | `/api/account/verify` — resolve key → set signed `wyreup_session` cookie → return `{ email, balance }` |
| 6 | `/api/account/signout` — clear cookie |
| 7 | `resolveUser()` accepting both cookie and `Authorization: Bearer` paths |
| 8 | `AuthModal.svelte` + `$apiKey` (transient) / `$user` Svelte stores |
| 9 | `CreditBadge` + `AccountMenu` in header |
| 10 | Add `tier` + `creditCost` to tool registry entries; split dual-version tools into `*` (free) and `*-pro` (PRO) entries |
| 11 | `ProBadge` on tool cards + gate in `ToolRunner.svelte` |
| 12 | Lemon Squeezy: create 3 products, note variant IDs |
| 13 | `BuyCreditsSheet.svelte` + `/api/credits/checkout` |
| 14 | `/api/webhooks/lemonsqueezy` — constant-time HMAC verify + `INSERT OR IGNORE`; handles `order_created` and `order_refunded` |
| 15 | `/api/tools/pro/run` — reserve-then-refund pattern (§10) |
| 16 | `/account` page — balance, keys, history, chains |

**Steps 1–11 first.** Working auth + PRO gate with no payments. Then 12–15 for Lemon Squeezy. Account page last.

---

## 16. What Does NOT Change

- All free tool logic in `@wyreup/core` — untouched
- Chain runner, trigger system — untouched
- PWA behavior — untouched
- Anonymous user experience — completely unchanged
- MCP server free tool calls — untouched
- CLI free tool calls — untouched

---

## 17. Security Checklist

- [ ] Raw API key never stored — only SHA-256 hash in D1
- [ ] Raw key shown at most once in the browser create-modal (browser surface only) and delivered once via email; never returned to CLI/MCP create flows; never logged
- [ ] Existing-email account creation never issues a new key (notice email only)
- [ ] Webhook signature verified with HMAC-SHA256 in **constant time** before any DB write
- [ ] `UNIQUE INDEX idx_credit_ls_order` + `INSERT OR IGNORE` enforces webhook idempotency at the DB layer
- [ ] Credit reservation is atomic (SQL guard subquery) — no TOCTOU between balance check and spend
- [ ] Failed PRO runs emit a `kind='refund'` ledger entry referencing the original spend
- [ ] Session cookie is `HttpOnly; Secure; SameSite=Lax`, signed with `SESSION_SECRET`, short TTL (24h) — `Lax` is required for the post-checkout redirect from Lemon Squeezy
- [ ] Revoking a key invalidates outstanding session cookies (cookie carries `kid`; `resolveUser` JOINs on `revoked_at IS NULL`)
- [ ] All `/api/` authenticated routes call `resolveUser()` before touching D1
- [ ] No card data, PII, or file contents ever stored
- [ ] `LS_API_KEY`, `LS_WEBHOOK_SECRET`, `ZEPTOMAIL_TOKEN`, `IMAGE_MODEL_TOKEN`, `SESSION_SECRET` in CF Pages secrets only
- [ ] CORS locked to `https://wyreup.com` on all `/api/*` routes
- [ ] OPTIONS preflight handler returns `Access-Control-Allow-Headers: Authorization, Content-Type` and `Access-Control-Allow-Credentials: true` (cookie path)
- [ ] Rate limit `/api/account/create`: 5/day per email **and** 10/day per IP; add CAPTCHA after threshold
- [ ] `userId` in LS checkout `custom_data` is set server-side from `resolveUser()`, never from the client request body

---

## 18. Crypto helpers

Small set of utilities used by `/api/webhooks/lemonsqueezy`, `resolveUser`, and the session cookie path. All built on `crypto.subtle` — available in the Workers/Pages Functions runtime, no external dependency.

```ts
const enc = new TextEncoder();

export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return bytesToHex(new Uint8Array(buf));
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return bytesToHex(new Uint8Array(sig));
}

// Constant-time hex compare. Bails early only on length mismatch (length is
// not secret). Body of compare runs in time proportional to length regardless
// of where the first differing byte is.
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Session cookie: HMAC over `${uid}.${kid}.${exp}`. Compact, no JWT library needed.
export async function signSessionCookie(
  payload: { uid: string; kid: string; exp: number },
  secret: string,
): Promise<string> {
  const body = `${payload.uid}.${payload.kid}.${payload.exp}`;
  const mac = await hmacSha256Hex(secret, body);
  return `${body}.${mac}`;
}

export async function verifySessionCookie(
  cookie: string,
  secret: string,
): Promise<{ uid: string; kid: string; exp: number } | null> {
  const parts = cookie.split('.');
  if (parts.length !== 4) return null;
  const [uid, kid, expStr, mac] = parts;
  const body = `${uid}.${kid}.${expStr}`;
  const expected = await hmacSha256Hex(secret, body);
  if (!timingSafeEqualHex(mac, expected)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  return { uid, kid, exp };
}

function bytesToHex(b: Uint8Array): string {
  let out = '';
  for (const byte of b) out += byte.toString(16).padStart(2, '0');
  return out;
}
```
