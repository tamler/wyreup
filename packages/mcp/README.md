# @wyreup/mcp

MCP server exposing Wyreup's tools to Claude Code, Claude Desktop, Cline, Continue, and any MCP-compatible agent. All tools run locally — no files leave your machine.

## Install

No install required — use `npx`:

```bash
npx @wyreup/mcp
```

Or install globally:

```bash
npm install -g @wyreup/mcp
```

Requires Node >= 20.

## Configure in Claude Code

Add to your Claude Code MCP settings (`.claude/settings.json` or user settings):

```json
{
  "mcpServers": {
    "wyreup": {
      "command": "npx",
      "args": ["-y", "@wyreup/mcp"]
    }
  }
}
```

## Configure in Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wyreup": {
      "command": "npx",
      "args": ["-y", "@wyreup/mcp"]
    }
  }
}
```

## What tools are exposed

Every Wyreup tool is exposed as an MCP tool call with structured JSON params:

- `input_paths` — array of local file paths
- `output_path` / `output_dir` — where to write results
- `params` — tool-specific options

Example agent invocation (handled by MCP automatically):

```json
{
  "tool": "compress",
  "input_paths": ["/home/user/photo.jpg"],
  "output_path": "/home/user/photo-small.jpg",
  "params": { "quality": 75 }
}
```

## Tool categories

Tools span image, PDF, audio, video, text, dev, geo, archive, finance, security/auth, and other categories — the full set ships in this server and tracks the registry automatically. Browse the live catalog at [wyreup.com/tools](https://wyreup.com/tools).

## Privacy

The MCP server is a local stdio process. All file operations run in-process on your machine. Nothing is sent to Wyreup's servers.

## Security & environment

`@wyreup/mcp` enforces defense-in-depth on every tool call. The defaults are conservative; production deployments should review and tune.

### Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `WYREUP_API_KEY` | — | Pro tools' bearer token. Read once at startup. Never inherited by worker env (passed via IPC). |
| `WYREUP_ORIGIN` | `https://wyreup.com` | Pro endpoint origin. Sole permitted destination for `fetch`. |
| `WYREUP_ALLOW_PATHS` | `<cwd>:<os.tmpdir()>` | Colon-separated absolute path roots. `*` disables the allowlist (not recommended). |
| `WYREUP_MAX_INPUT_BYTES` | `524288000` (500 MB) | Aggregate cap on input file bytes per call. |
| `WYREUP_AUDIT_LOG` | — | If set, append per-call JSONL audit lines to this path (mode 0600). |
| `WYREUP_AUDIT_REQUIRED` | — | `1` makes audit-write failure fail the call. |
| `WYREUP_ALLOW_DISABLE_TIMEOUT` | — | `1` permits `timeout_ms: 0` (disable). |
| `WYREUP_DISABLE_WORKER_ISOLATION` | — | `1` runs tools in-process (debug only). |
| `WYREUP_DISABLE_EGRESS_LOCK` | — | `1` skips installing the `fetch` egress lock. |

### Per-call schema fields

Every tool accepts these in addition to its tool-specific `params`:

- `input_paths: string[]` — absolute paths to input files
- `output_path: string` or `output_dir: string` — where to write
- `timeout_ms: number` — max runtime, default 300000, range `[1, 3600000]`
- `allow_overwrite: boolean` — default `false`; refuses to clobber existing outputs

### What this does NOT defend against

See `docs/superpowers/specs/2026-05-24-wyreup-mcp-hardening-design.md § Security limitations` for the authoritative list. In short:

- Raw socket egress (`node:http`/`node:https`/`node:net`/native bindings)
- Tool-spawned subprocesses
- DNS-channel exfiltration
- Hostile-tmpdir scenarios
- MCP clients that ignore capability annotations

## More

- [wyreup.com](https://wyreup.com) — try tools in the browser
- [CLI (@wyreup/cli)](https://wyreup.com/cli) — shell interface
- [Agent skill](https://wyreup.com/skill) — teaches Claude when and how to use Wyreup. Install via `wyreup install-skill`.
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
