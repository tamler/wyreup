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

Image (16), PDF (19), Audio (3), Text/Dev (12), Create (4) — see [wyreup.com](https://wyreup.com) for the full list.

## Privacy

The MCP server is a local stdio process. All file operations run in-process on your machine. Nothing is sent to Wyreup's servers.

## More

- [wyreup.com](https://wyreup.com) — try tools in the browser
- [CLI (@wyreup/cli)](https://wyreup.com/cli) — shell interface
- [Agent skill](https://wyreup.com/skill) — teaches Claude when and how to use Wyreup. Install via `wyreup install-skill`.
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
