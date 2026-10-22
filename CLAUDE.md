# CLAUDE.md

@AGENTS.md

**All project rules live in `AGENTS.md`.** The `@AGENTS.md` line above is a Claude Code *import* —
it loads that file's contents into context automatically, so the rules are actually in memory rather
than merely linked.

`AGENTS.md` is the [cross-tool standard](https://agents.md/), read natively by Codex, Grok Build,
Cursor, Copilot, Gemini CLI, Aider and 20+ other agent CLIs. Keeping the rules there rather than
duplicating them here means every tool sees the same instructions and they cannot drift apart.

This file exists because Claude Code is guaranteed to read it. It carries only the import above plus
any Claude-specific notes — there are currently none.
