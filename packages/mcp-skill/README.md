> **Deprecated**: Use `npx @wyreup/cli install-skill` instead. This package only shipped a markdown file that you had to manually copy. The CLI command handles the install.

# @wyreup/mcp-skill

An agent skill that teaches AI assistants how to invoke Wyreup's local file tools through the `@wyreup/mcp` MCP server. Smaller token footprint than `@wyreup/skill` — no CLI guidance, just MCP tool call shapes.

Use this package when your agent runtime is MCP-equipped (Claude Code, Claude Desktop, Cline, Continue, or any MCP-compatible client) and you don't need shell command guidance. If you want CLI support as well, use `@wyreup/skill`. If you want CLI-only, use `@wyreup/cli-skill`.

## What this is

This package contains `skill.md` — a structured instruction file that an agent reads to understand when and how to invoke Wyreup tools via the MCP server. It covers tools across image, PDF, audio, text/dev, create, and finance categories.

When the skill is installed, an agent can:
- Recognize when a user's file task is a good fit for Wyreup
- Confirm the MCP server is connected
- Choose the right tool for the task
- Invoke it with the correct MCP tool call shape: `{name, arguments: {input_paths, output_path|output_dir, params}}`
- Handle multi-output tools, error cases, and privacy-sensitive contexts correctly

## Install

```bash
npm install -g @wyreup/mcp-skill
```

Then add it to your agent runtime's skill configuration. The exact location depends on your client — see your client's documentation for skill installation steps.

Alternatively, copy `skill.md` directly into your skill directory.

## Pairing with the MCP server

Install and register the Wyreup MCP server in your agent client's config:

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

Config file locations:
- **Claude Desktop (macOS)**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop (Windows)**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Claude Code (project)**: `.mcp.json` in project root
- **Cline / Continue / Zed**: see your client's MCP settings panel

Once registered, the agent can call any Wyreup tool directly.

## Skill packages

| Package | Backend | Token footprint |
|---|---|---|
| `@wyreup/skill` | CLI + MCP | Largest (covers both) |
| `@wyreup/cli-skill` | CLI only | Smaller |
| `@wyreup/mcp-skill` | MCP only | Smaller |

## More

- [wyreup.com](https://wyreup.com) — try every tool in the browser, no install needed
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
