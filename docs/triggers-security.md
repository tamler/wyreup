# Trigger Rules — Security Model

_Status: design, in-progress (Wave T)_
_Last updated: 2026-05-14_

This document is the source of truth for how trigger rules behave under
adversarial conditions. **Every change to the trigger system must be
checked against this document.** If a proposed change weakens any of the
guarantees below, the change is rejected by default — exceptions require
an explicit re-evaluation with the same level of seriousness applied to
the original spec.

## What trigger rules do (one sentence)

A trigger rule maps a file MIME pattern to a saved chain, so that when a
matching file arrives, Wyreup proposes to run the chain on it.

> **Proposes.** Never runs without explicit confirmation, ever, by default.

## Threat model

We assume an adversary can deliver a file of any type to the user — via
download, email attachment, USB stick, OS-level "Open with…", or
in-browser drop. The adversary controls the file's MIME, name, and
contents. The adversary may know which trigger rules the user has
configured (the manifest is observable).

**What the adversary wants:**

1. **Silent execution** — run a chain without the user seeing the file or
   reviewing the rule.
2. **Output exfiltration** — get the result of running a chain off the
   user's machine.
3. **Prompt injection** — embed instructions in the file that downstream
   LLM-shaped tools (`text-summarize`, `text-translate`, future Gemma)
   interpret as user intent.
4. **Resource exhaustion** — flood the trigger system to burn battery,
   model cache, or local LLM credits.
5. **Output collision / overwrite** — chains that derive output filenames
   from input could be tricked into overwriting user files.

## Guarantees

These are load-bearing. Each one is enforced by a specific code path
labelled with its guarantee number in a comment.

### G1 — Preview before every run, by default

Every trigger match shows a **preview sheet** before the chain executes.
The sheet shows:

- The file (name, size, MIME, first 256 bytes hex preview)
- The matched rule (name, MIME pattern, full chain string)
- The output(s) the chain will produce (predicted from `output.mime`)
- A pre-flight verdict from `pdf-suspicious` / `text-suspicious` /
  equivalent (see G4)

The user must click **Run** for execution to proceed. Closing the sheet,
hitting Escape, or clicking Skip = no execution.

### G2 — "Don't ask again" is per-rule, never global

A user may mark an individual rule as `confirmed: true`. Subsequent
matches for *that exact rule* skip the preview sheet. There is **no
global setting** to disable previews for all rules — that would defeat
G1's entire purpose.

A rule loses `confirmed: true` whenever:

- Its chain string is edited
- Its MIME pattern is edited
- Its name is edited
- The user explicitly toggles confirmed off in `/my-kit`

Editing a rule re-arms the preview. New rules start `confirmed: false`.

### G3 — `file_handlers` never bypasses G1

When the user installs Wyreup as a PWA, the `file_handlers` manifest
entries route OS-level "Open with Wyreup" to a page that shows the
preview sheet — *not* directly to chain execution. The PWA entry point
for a file-handler invocation is the same code path as an in-page drop;
both go through G1.

There is no `file_handlers` mode that auto-runs. There is no URL
parameter that auto-runs. There is no "headless" trigger surface.

### G4 — Suspicious-file pre-flight on every preview

Before the preview sheet renders the Run button, Wyreup runs
suspicious-content analysis on the file (`pdf-suspicious` for PDFs,
`text-suspicious` for text-shaped inputs, etc.). The result is displayed
on the sheet *above* the Run button:

- **clean** — no notice
- **low / medium** — a yellow notice naming the finding
- **high** — a red notice; the Run button is moved behind a
  secondary "Run anyway" confirmation

The pre-flight is read-only and runs locally. It never blocks the user
from running — it makes the security state legible before they decide.

### G5 — No network egress from chain execution

This is an existing invariant of `@wyreup/core` enforced by
`tools/check-privacy.mjs`. The trigger system does not loosen it.
Tools that need network access (currently: none in the auto-run set)
are explicitly excluded from being chainable behind a trigger.

In particular: `webhook-replay` runs in `analyze`-only mode under
trigger context. The `--send` mode that actually fires the request is
manual-only.

### G6 — Output-path collisions are reported, never silent

When a chain writes a file, the output path is shown on the preview
sheet *before* the user clicks Run. If the path collides with an
existing file, the sheet shows "would overwrite: /path/to/x.pdf" in
red, and the user must explicitly choose Overwrite or Rename.

This is enforced by the chain runner, not by the trigger system, so it
applies to every chain run regardless of how it was initiated.

### G7 — Resource limits per rule

Each rule has a hidden rate limit: a single rule cannot fire more than
N times in T seconds (default N=10, T=60). The (N, T) values are
configurable per-rule but cannot be disabled. When the limit is hit,
subsequent triggers within the window show a "rate-limited: N matches
in T seconds" notice instead of the preview sheet.

This is a flood-prevention guarantee. The user can still drag a folder
of 500 files in and process them through batch mode — batch mode is a
distinct surface that bypasses triggers entirely.

## What auto-run will NEVER do

Recording these explicitly so a future PR can be rejected by reference.

1. **Never** run a chain on a file the user has not seen the metadata of.
2. **Never** run a chain that includes a network-egress step under
   trigger context.
3. **Never** auto-confirm a rule on the user's behalf (e.g. "we noticed
   you ran this 5 times, marking it confirmed"). Confirmation is an
   explicit action.
4. **Never** route around the preview sheet via a URL param, query
   string, manifest field, or skill-installed default.
5. **Never** silently update an existing rule when a chain is shared via
   URL. Shared chains import as `confirmed: false` and require explicit
   acceptance.
6. **Never** trust the MIME header alone. The matcher uses MIME for
   speed but the preview sheet displays the first 256 bytes of the file
   so the user can spot mismatches (e.g. a `.pdf` that's actually a ZIP).

## How to add a new auto-runnable surface

Future surfaces (browser extension right-click, CLI `wyreup watch`, MCP
agent invocations) inherit this model. To add a new surface:

1. Identify the code path that would skip G1 in your implementation.
   That path doesn't exist; do not create it.
2. Route the surface through the same preview-sheet component (web) or
   the equivalent confirmation prompt (CLI / MCP).
3. Add a paragraph to this document naming the new surface and stating
   how G1–G7 are enforced on it.
4. Add a test that drops a malicious-shaped file through the surface
   and asserts that no chain executed before user confirmation.

## Trusted contexts that *are* allowed to skip the preview

Two surfaces legitimately bypass G1, both of which are user-initiated
and visible:

1. **In-page "Run this chain" buttons** — the user explicitly clicked a
   run button on a tool or chain page. They've already seen the file
   and chosen the action.
2. **`wyreup watch` daemon with explicit `--auto-run` flag** — CLI-only,
   user typed the flag themselves, the flag's help text names this
   document. Default behavior of `wyreup watch` is preview-via-stdout
   prompt.

These are not exemptions — they're surfaces where the consent step
happens before the chain match, not after.

## Open questions (resolve before shipping)

- **Confirmation TTL.** Should `confirmed: true` expire after N days of
  inactivity? Probably yes — recommendation: 30 days, configurable per
  rule. A long-confirmed rule whose threat surface has shifted is more
  dangerous than a freshly-confirmed one.
- **Per-MIME pre-flight tools.** `pdf-suspicious` covers PDFs;
  `text-suspicious` covers text. What's the pre-flight for `image/*`?
  Today: nothing useful (no homoglyph attack surface in raster). For
  `audio/*`: nothing useful (we'd need a real audio prompt-injection
  detector, which doesn't exist yet). Leave those categories unflagged
  rather than fake a verdict.
- **Trigger rule export / import.** When a user exports their kit to
  share or sync, exported rules should always import as
  `confirmed: false` on the receiver — even if the sender had them
  confirmed. The receiver hasn't reviewed them.
