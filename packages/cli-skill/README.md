# @wyreup/cli-skill

An agent skill that teaches AI assistants how to invoke Wyreup's 72 local file tools via the `wyreup` CLI. Smaller token footprint than `@wyreup/skill` — no MCP guidance, no JSON schemas, just shell commands.

Use this package when your agent context is CLI-only (Claude Code invoking shell commands, a terminal agent, or a script). If you want MCP support as well, use `@wyreup/skill` instead.

## What this is

This package contains `skill.md` — a structured instruction file that an agent reads to understand when and how to invoke Wyreup tools via the CLI. It covers all 72 tools across six categories: image, PDF, text/dev, create, finance, and AI/privacy.

When the skill is installed, an agent can:
- Recognize when a user's file task is a good fit for Wyreup
- Choose the right tool from the 72 available
- Invoke it as a shell command: `wyreup <tool> <input> -o <output> [--options]`
- Handle multi-output tools, error cases, and privacy-sensitive contexts correctly

## Install

```bash
npm install -g @wyreup/cli-skill
```

Then add it to your Claude Code configuration. See the [Claude Code Skills documentation](https://docs.anthropic.com/en/docs/claude-code/skills) for installation steps.

Alternatively, copy `skill.md` directly into your Claude Code skills directory.

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

This package does NOT cover MCP. If you want structured MCP tool calls in Claude Code or Claude Desktop, use `@wyreup/skill` instead — it covers both CLI and MCP paths.

## More

- [wyreup.com](https://wyreup.com) — try all 72 tools in the browser, no install needed
- [GitHub](https://github.com/tamler/wyreup)

## License

MIT
