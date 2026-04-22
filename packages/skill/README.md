# @wyreup/skill

An agent skill that teaches AI assistants how to use Wyreup's 72 local file-processing tools. Written in the standard `skill.md` format (YAML frontmatter + markdown body), compatible with any agent runtime that supports skills — Claude Code, Claude Desktop, Claude.ai, and others.

This is the **umbrella skill** covering both CLI and MCP backends. If you only use one backend, consider the lighter alternatives:
- `@wyreup/cli-skill` — CLI only (no MCP guidance, smaller footprint)
- `@wyreup/mcp-skill` — MCP only (no CLI guidance, smaller footprint)

## What this is

This package contains `skill.md` — a structured instruction file that an agent reads to understand when and how to invoke Wyreup tools. It covers all 72 tools across six categories: image, PDF, audio, text/dev, create, and finance.

When the skill is installed, an agent can:
- Recognize when a user's file task is a good fit for Wyreup
- Choose the right tool from the 72 available
- Invoke it via the `wyreup` CLI or the `@wyreup/mcp` MCP server
- Handle multi-output tools, error cases, and privacy-sensitive contexts correctly

## Install

```
npm install -g @wyreup/skill
```

Then add it to your agent runtime's skill configuration. See your client's skills documentation for installation steps (e.g., the [Claude Code Skills docs](https://docs.anthropic.com/en/docs/claude-code/skills)).

Alternatively, copy `skill.md` directly into your agent's skill directory.

## Pairing with a tool backend

The skill supports two backends. Pick one (or both):

### Option A — Wyreup CLI

```bash
npm install -g @wyreup/cli
```

Your agent will invoke tools as shell commands:

```
wyreup compress photo.jpg --quality 80 -o photo-compressed.jpg
```

### Option B — MCP server

Add the Wyreup MCP server to your agent client (Claude Code, Claude Desktop, Cline, Continue, or any MCP-compatible client):

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

The MCP server exposes all 72 tools with structured JSON params.

## More

- [wyreup.com](https://wyreup.com) — try all tools in the browser, no install needed
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
