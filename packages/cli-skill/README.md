> **Deprecated**: Use `npx @wyreup/cli install-skill` instead. This package only shipped a markdown file that you had to manually copy. The CLI command handles the install.

# @wyreup/cli-skill

An agent skill that teaches AI assistants how to invoke Wyreup's local file tools via the `wyreup` CLI. Smaller token footprint than `@wyreup/skill` — no MCP guidance, no JSON schemas, just shell commands.

Use this package when your agent context is CLI-only (a shell-capable agent runtime like Claude Code, Aider, or a terminal script). If you want MCP support, use `@wyreup/mcp-skill`. If you want both CLI and MCP guidance, use `@wyreup/skill`.

## What this is

This package contains `skill.md` — a structured instruction file that an agent reads to understand when and how to invoke Wyreup tools via the CLI. It covers tools across image, PDF, audio, text/dev, create, and finance categories.

When the skill is installed, an agent can:
- Recognize when a user's file task is a good fit for Wyreup
- Choose the right tool for the task
- Invoke it as a shell command: `wyreup <tool> <input> -o <output> [--options]`
- Handle multi-output tools, error cases, and privacy-sensitive contexts correctly

## Install

```bash
npm install -g @wyreup/cli-skill
```

Then add it to your agent runtime's skill configuration. See your client's skills documentation for installation steps (e.g., the [Claude Code Skills docs](https://docs.anthropic.com/en/docs/claude-code/skills)).

Alternatively, copy `skill.md` directly into your agent's skill directory.

## Pairing with the CLI

Install the Wyreup CLI separately:

```bash
npm install -g @wyreup/cli
```

Then run tools directly:

```bash
wyreup compress photo.jpg --quality 80 -o photo-compressed.jpg
wyreup merge-pdf a.pdf b.pdf -o merged.pdf
wyreup face-blur photo.jpg -o anonymized.jpg
wyreup hash document.pdf | jq .sha256
```

One-off (no install):

```bash
npx @wyreup/cli compress photo.jpg -o compressed.jpg
```

## MCP support

This package does NOT cover MCP. If you want structured MCP tool calls, use `@wyreup/mcp-skill` (MCP only) or `@wyreup/skill` (both CLI and MCP).

## More

- [wyreup.com](https://wyreup.com) — try every tool in the browser, no install needed
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
