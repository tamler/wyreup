# @wyreup/skill

An agent skill that teaches AI assistants how to use Wyreup's 66 local file-processing tools. Written in the standard `skill.md` format (YAML frontmatter + markdown body), compatible with Claude Code and any agent runtime that supports skills.

## What this is

This package contains `skill.md` — a structured instruction file that an agent reads to understand when and how to invoke Wyreup tools. It covers all 66 tools across five categories: image, PDF, audio, text/dev, and create.

When the skill is installed, an agent can:
- Recognize when a user's file task is a good fit for Wyreup
- Choose the right tool from the 66 available
- Invoke it via the `wyreup` CLI or the `@wyreup/mcp` MCP server
- Handle multi-output tools, error cases, and privacy-sensitive contexts correctly

## Install

```
npm install -g @wyreup/skill
```

Then add it to your Claude Code configuration. See the [Claude Code Skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills) for installation steps.

Alternatively, copy `skill.md` into your Claude Code skills directory directly.

## Pairing with a tool backend

The skill supports two backends. Pick one (or both):

### Option A — Wyreup CLI

```bash
npm install -g @wyreup/cli
```

Claude will invoke tools as shell commands:

```
wyreup compress photo.jpg --quality 80 -o photo-compressed.jpg
```

### Option B — MCP server

Add the Wyreup MCP server to Claude Code or Claude Desktop:

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

The MCP server exposes all 66 tools with structured JSON params.

## More

- [wyreup.com](https://wyreup.com) — try all tools in the browser, no install needed
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
