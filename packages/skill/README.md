# @wyreup/skill

An agent skill that teaches AI assistants how to use Wyreup's 53 local file-processing tools. The skill is written in the standard skill.md format (YAML frontmatter + markdown body), which is supported by Claude Code and any other agent runtime that consumes skills.

## What this is

This package contains `skill.md` — a structured instruction file that an agent reads to understand when and how to invoke Wyreup tools. It covers all 53 tools across five categories: image, PDF, text/dev, create, and AI/privacy.

When the skill is installed, an agent can:
- Recognize when a user's file task is a good fit for Wyreup
- Choose the right tool from the 53 available
- Invoke it via the `wyreup` CLI or the `@wyreup/mcp` MCP server
- Handle multi-output tools, error cases, and privacy-sensitive contexts correctly

## How to install

1. Install the package (or reference it locally):
   ```
   npm install -g @wyreup/skill
   ```

2. Add it to your Claude Code configuration. See the [Claude Code Skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills) for the current installation steps.

Alternatively, copy `skill.md` into your Claude Code skills directory directly.

## Pairing with a tool backend

The skill supports two backends. Pick one (or both):

### Option A — Wyreup CLI

Install the CLI globally:

```
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

The MCP server exposes all 53 tools with structured JSON params. Claude can call them directly with `input_paths`, `output_path`/`output_dir`, and `params`.

## License

MIT
