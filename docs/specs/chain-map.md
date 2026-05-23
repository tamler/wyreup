# Spec stub: chain-map (per-row tool fan-out)

**Status:** Stub — queued behind `pro-cli-mcp.md`. Full design round to
happen before any implementation.
**Drafted:** 2026-05-23.

---

## Goal

Add a chain-engine primitive that takes a tabular input (CSV row set or
JSON array) and runs a downstream tool per row, collating the results
back into one tabular output. Unlocks batch document processing across
the whole catalog — "for each row in articles.csv, run
text-summarize-pro on the body column and append the summary." Pairs
naturally with the just-shipped `csv-sql` tool, which can prep the
input and aggregate the output.

---

## Why this is engine work, not a tool

The chain engine (`packages/core/src/chain/`) has invariants — abort
semantics, preview-before-run, MIME-type matching, idempotent retries —
that any fan-out construct has to respect. It's a new step type, not a
new ToolModule.

---

## Open design questions (to answer in the full spec round)

1. **Concurrency.** Sequential (safe, slow) vs. capped parallelism
   (faster, hits 30/min Pro rate limit). Recommended v1: sequential.
   v2: cap at 5 with 429 back-off.

2. **Failure mode.** Three options:
   - Abort whole chain, refund all credits. Ragey UX.
   - Skip the failed row, log error to a separate `_error` column. Partial
     result, user can re-run failures. **Recommended.**
   - Stop on first error, return rows 1..N with the error attached.

3. **Per-row input shaping.**
   - For text-input tools: send a File with `text/plain` body of the
     mapped cell.
   - For URL columns + file-input tools: fetch first, then dispatch.
     Probably v2.
   - For other tools: error out at chain-build time.

4. **Output shape.** Append a column to the input table (CSV in → CSV
   out) vs. emit a new JSON array of `{input_row, tool_output}`.
   Appending wins for the common case; JSON path is escape hatch for
   non-scalar tool outputs.

5. **Chain-builder UI.** Current builder is linear. Fan-out needs a
   visual branch + a column-to-input mapper. UI changes are
   non-trivial; engine work first, UI second.

6. **Credit accounting.** Each per-row Pro invocation is a separate
   `spend` ledger row. The orphan-spend sweep from commit `0752e29`
   covers crashes mid-fan-out. Should "just work."

7. **Surface scope.** Pro tools work in chain-map only if the
   `pro-cli-mcp` work has shipped — chain-map called from CLI/MCP needs
   the per-row Pro dispatch to succeed. **Dependency order: pro-cli-mcp
   first, then chain-map.**

---

## MVP scope (probable, to confirm)

- Sequential per-row dispatch
- Text-input tools only (`input.accept` includes `text/plain` or
  `application/json`)
- Output: append columns to input table
- Failure: error-into-column, continue
- Builder UI: minimal — dropdown for tool, column → input param mapper.
  Visual fan-out arrow in v2.

**Estimated effort:** 2 sessions (engine + builder UI).

---

## Hypothetical Wave V-CLI (rejected)

A stateful `wyreup db` REPL where users load files into a persistent
session DB and query it. **Out of scope** — agents and CLI users get
all the value via the `csv-sql` tool already, no stateful CLI surface
needed.
