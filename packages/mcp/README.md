# @wyreup/mcp

MCP server exposing Wyreup's local tools, public network lookups, and hosted PRO tools to Claude Code, Claude Desktop, Cline, Continue, and any MCP-compatible agent.

## Install

No install required — use `npx`:

```bash
npx @wyreup/mcp
```

Or install globally:

```bash
npm install -g @wyreup/mcp
```

Requires Node >= 22.13.0. Model tools install the official Transformers.js runtime.
After upgrading an existing installation, refresh its transitive lockfile and
reinstall, then run a full dependency audit; old nested native dependencies can
otherwise remain pinned. See the [core migration guidance](../core/README.md)
for model dependency floors and the OpenPGP.js 6 boundary: standard v4 material
is supported, while experimental legacy v5 key packets are rejected.

Filesystem-backed tools require macOS, Linux, or WSL. Native Windows path
operations fail closed because Node does not expose the ACL and handle-relative
primitives needed to make the same local-attacker guarantee.

Input and output directories, including every ancestor, must not be writable
by another group or user (for example, use modes `0700` or `0755`). Shared
sticky directories such as `/tmp` are supported only for entries owned by the
server's uid. Errors identify the offending directory and its octal mode.
`WYREUP_ALLOW_PATHS=*` does not bypass these permission checks. Group-writable
projects created with umask `002`, permissive Docker mounts, and FAT/exFAT
volumes may be refused. Use a protected working directory; on WSL, prefer the
Linux filesystem rather than `/mnt/c` unless its mount permissions meet these
requirements. Adjust permissions only on directories you own and intend to
make private; do not broadly change shared parent directories.

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

The MCP server is a local stdio process. Local file-processing tools keep their inputs on your machine; hosted PRO tools send their declared inputs for remote processing.

Domain Registration Age is a free network lookup. The entered domain is sent to Wyreup, which reads the public IANA bootstrap without sending IANA the queried domain, then sends the domain to its registration registry. No API key is required. Registration age may differ from first-ever use. The trusted `WYREUP_ORIGIN` (default `https://wyreup.com`) travels through the existing parent-to-worker context; the normal egress lock still blocks direct registry requests. Its MCP annotation declares network access even though it is free.

Public lookups use temporary rotating HMAC network counters and random short-lived reservation tokens. Shared networks can reach public limits together. Wyreup keeps no domain-query database; expired records are pruned on later requests, and platform logs and backups have their own retention. Optional local MCP audit logs keep run metadata; your assistant provider, operator exports, saved chains, and output files may retain requests or results. Local processing does not make an agent conversation private.

## Security & environment

`@wyreup/mcp` enforces defense-in-depth on every tool call. The defaults are conservative; production deployments should review and tune.

With the fetch lock enabled, redirects are followed only for HTTP 301, 302, 303, 307 and 308, and only to the trusted `WYREUP_ORIGIN` or configured model origins. POST requests on 301/302 and methods other than GET/HEAD on 303 become GET requests with the body and body headers removed. A redirect that would retain a non-null request body, including on 307/308, is refused with `Redirect would replay a request body`. Body-free model downloads can follow redirects between allowed origins.

### Environment variables

| Var | Default | Purpose |
| --- | --- | --- |
| `WYREUP_API_KEY` | — | Pro tools' bearer token. Read once at startup. Never inherited by worker env (passed via IPC). |
| `WYREUP_ORIGIN` | `https://wyreup.com` | Trusted public lookup and Pro endpoint origin, allowed alongside configured model origins by the fetch lock. |
| `WYREUP_MODEL_CDN` | `https://models.wyreup.com` | Model mirror URL, or `disabled` to use the configured upstream model origins. Passed to workers over trusted parent IPC. |
| `WYREUP_ALLOW_PATHS` | CWD + `os.tmpdir()` | Platform-delimited absolute path roots (`:` on POSIX, `;` on Windows). `*` disables the allowlist, never directory-permission checks. |
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

Tool-specific schemas use declared types and source-backed bounds. Required
null defaults mean an active value must be supplied; they do not declare a
nullable field. Conditional fields are constrained only in their active mode,
including the mode selected by omitted defaults. Cascading choices and exact
row rules remain core-validated. JSON parameters are inert plain data, bounded
to depth 20, 20,000 scalar values and 1 MiB serialized. Unsafe objects, getters,
cycles and nonfinite values refuse before tool execution. Reviewed strict IDs
reject unknown keys; legacy tools preserve their existing fields and behavior.

Numeric-looking string fields, such as cron's `minute: "5"` and aspect-ratio
decimals, stay strings. Bank `mapping`, `pageDecisions` and `lineDecisions` are
native JSON; only its declared optional `opening`, `closing` and
`statementYear` accept null. Bank export still requires actual explicit review.
Lorem's actual engine bounds are 1000 paragraphs and 100 sentences per
paragraph, including fractional counts such as 2.5; its loops produce three.
Its default-only `wordsPerSentence` array remains available.

Finance and configuration-generator row fields are JSON **strings**, not
arrays. For example, a robots call uses:

```json
{"params":{"groupsJson":"[{\"userAgent\":\"*\",\"rule\":\"Disallow\",\"path\":\"/private\"}]","sitemapsJson":"[]"}}
```

Robots columns are `groupsJson: userAgent,rule,path` (Allow/Disallow; max 1000)
and `sitemapsJson: url` (max 20). CSP `directivesJson` has `directive,sources`
(max 10); hreflang `linksJson` has `language,url`; nginx `redirectsJson` has
`source,destination,status` (301/302/307/308; max 1000). Hreflang allows max
1000. These strings have a 100,000-character bound; the core checks exact
columns and allowed rules, directives, origins and paths. Tool schemas describe
finance row columns and explicit currency/rate assumptions. Encode row text
once as a string, not twice. Native row arrays such as board pieces and
construction materials remain arrays.

`wyreup_chain` retains the existing simple parser/coercion. Exact strings,
comma-rich values and structured row arrays/JSON require direct tool calls;
typed direct schemas do not promise typed chain roundtrips. Web-only tools are
excluded from MCP listing and invocation. Code Beautifier supports JavaScript,
CSS, XML, SQL, JSON and HTML, with TypeScript unsupported.

### What this does NOT defend against

See `docs/superpowers/specs/2026-05-24-wyreup-mcp-hardening-design.md § Security limitations` for the authoritative list. In short:

- Raw socket egress (`node:http`/`node:https`/`node:net`/native bindings)
- The parent `fetch` lock does not instrument separate file-worker globals;
  local-worker network behavior needs its own checks and is not a universal
  fetch or socket-isolation guarantee.
- Tool-spawned subprocesses
- DNS-channel exfiltration
- Processes running as the same OS user (the local trust boundary)
- Native Windows filesystem paths; use WSL for filesystem-backed tools
- MCP clients that ignore capability annotations

## More

- [wyreup.com](https://wyreup.com) — try tools in the browser
- [CLI (@wyreup/cli)](https://wyreup.com/cli) — shell interface
- [Agent skill](https://wyreup.com/skill) — teaches Claude when and how to use Wyreup. Install via `wyreup install-skill`.
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
