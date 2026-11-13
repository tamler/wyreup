# Managed Pro request recovery and release conditions

This is an implementation and operational handoff, not authorization to apply migrations, deploy, or run paid inference. The three managed tool IDs are not present in the baseline. The shared state machine alone does not enable any new tool.

## Before enabling a managed tool

- Provide a web recovery control that reuses or checks the same request key after an uncertain outcome. The current web runner creates a fresh key for a fresh invocation, so telling the user to repeat a request with the same key is not actionable there. Do not enable a paid web flow until this is resolved and tested.
- Preflight output destinations on every supported surface before billing. MCP checks `image-edit-pro` for a missing or existing output path, but other paid outputs and the CLI are not covered. A preflight cannot eliminate a later filesystem race; handle publication failure and explain that results are not retained.
- `recoverStale` currently executes a D1 write batch on every validated Pro request, including legacy calls. A D1 failure prevents admission; keyed requests perform an extra recovery batch. The status operation also performs writes and has no dedicated rate limit. Measure and review availability, request-rate and cost effects before enabling the tools.
- Register and test the real tool implementations, server prices, provider-specific consent and caps; the hard-coded server and core managed-ID lists must match. Their presence in these lists does not register a tool. Confirm model limits and pricing against current provider documentation; no inference quality, speed, runtime billing or privacy terms have been verified.
- Large bodies are parsed and strings re-encoded for hashing before the HMAC. Measure peak memory under the largest allowed multi-file input before enabling. A rotated `SESSION_SECRET` makes the same-key content check conflict; it must never permit redispatch. Keep permanent key tombstones until account deletion.

## Rollback and unknown outcomes

Migration 0009 protects a managed spend from the older orphan sweeper. If Pages is rolled back after 0009, the older code cannot perform managed stale recovery: pending managed rows may remain charged rather than be incorrectly refunded. Do not drop the migration or disable its trigger to restore the older sweeper.

After authorized recovery, restore a reviewed version containing managed recovery and the migration, then verify the deployment and invoke the authenticated status operation or a new validated Pro request for the affected account. Recovery uses the database clock and only transitions stale `reserved`/`dispatching` rows after the 270-second threshold; it records `unknown_refunded` and a unique refund without redispatch. Confirm the ledger and state before telling a customer that credit was restored. If roll-forward is unavailable, preserve the rows and arrange a separately reviewed, authorized operator procedure; do not hand-edit ledger rows or claim the old sweeper recovered them.

Even after a refund the provider may finish and charge Wyreup. A completed response that is lost in transit is not recoverable from the server: no result is retained. Status and recovery behavior require runtime verification on the target deployment and account.
