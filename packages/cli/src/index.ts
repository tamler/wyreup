#!/usr/bin/env node
import { Command } from 'commander';
import { createReadStream } from 'node:fs';
import { listCommand } from './commands/list.js';
import { initToolCommand } from './commands/init-tool.js';
import { makeInstallSkillCommand } from './commands/install-skill.js';
import { executeTool, addToolOptions, mergeToolOptions } from './commands/run.js';
import { executeChain } from './commands/chain.js';
import { executeWatch } from './commands/watch.js';
import { prefetchCommand } from './commands/prefetch.js';
import { cacheListCommand, cacheClearCommand } from './commands/cache.js';
import { createDefaultRegistry, toolRunsOnSurface } from '@wyreup/core';

// Read version from package.json at runtime so it never drifts.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const program = new Command();

program
  .name('wyreup')
  .description('Wyreup CLI — wire up your tools from the shell')
  .version(pkg.version);

// ──── list ────────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List all available tools, grouped by category')
  .action(() => {
    listCommand();
  });

// ──── init-tool ───────────────────────────────────────────────────────────────

program
  .command('init-tool')
  .description('Scaffold a new ToolModule into the monorepo')
  .action(async () => {
    await initToolCommand();
  });

// ──── install-skill ───────────────────────────────────────────────────────────

program.addCommand(makeInstallSkillCommand());

// ──── prefetch ────────────────────────────────────────────────────────────────

program
  .command('prefetch')
  .description('Pre-download model weights for AI/ML tools so first-use is offline-ready')
  .argument('[tool-ids...]', 'Tool IDs to prefetch (e.g. transcribe image-caption)')
  .option('--group <name>', 'Prefetch every tool in an install group (e.g. speech, vision-llm, image-ai)')
  .option('--chain <chain>', 'Prefetch every tool in a chain string ("tool1|tool2[k=v]|tool3")')
  .option('--all', 'Prefetch every tool with a downloadable model')
  .option('--verbose', 'Print download progress')
  .addHelpText(
    'after',
    `
Examples:
  wyreup prefetch transcribe                                       # one tool
  wyreup prefetch transcribe image-caption                         # several tools
  wyreup prefetch --group speech                                   # whole install group
  wyreup prefetch --chain "transcribe|text-summarize|markdown-to-html"  # preflight a chain
  wyreup prefetch --all                                            # every model-backed tool
  wyreup prefetch --all --verbose                                  # with download progress

The cache is stored where Transformers.js puts it (typically
~/.cache/huggingface/hub) and is shared across CLI / MCP invocations.`,
  )
  .action(async (toolIds: string[], opts: Record<string, unknown>) => {
    await prefetchCommand(toolIds, {
      group: opts['group'] as string | undefined,
      chain: opts['chain'] as string | undefined,
      all: opts['all'] as boolean | undefined,
      verbose: opts['verbose'] as boolean | undefined,
    });
  });

// ──── cache ───────────────────────────────────────────────────────────────────

const cacheCmd = program
  .command('cache')
  .description('Inspect or clear the local model cache shared with MCP');

cacheCmd
  .command('list')
  .description('Show downloaded models and total cache size')
  .option('--json', 'Emit machine-readable JSON')
  .action(async (opts: Record<string, unknown>) => {
    await cacheListCommand({ json: opts['json'] as boolean | undefined });
  });

cacheCmd
  .command('clear')
  .description('Delete all cached model weights (frees disk; next use re-downloads)')
  .option('--force', 'Skip the confirmation prompt')
  .action(async (opts: Record<string, unknown>) => {
    await cacheClearCommand({ force: opts['force'] as boolean | undefined });
  });

// ──── run ─────────────────────────────────────────────────────────────────────

const runCmd = program
  .command('run')
  .description('Run a tool by ID')
  .argument('<tool-id>', 'Tool identifier (e.g. compress, merge-pdf, hash)')
  .argument('[inputs...]', 'Input file paths (use - for stdin)')
  .option('-o, --output <path>', 'Output file path (single-output tools)')
  .option('-O, --output-dir <dir>', 'Output directory (multi-output tools)')
  .option('--param <key=value>', 'Tool parameter override (repeatable)', (v: string, prev: string[]) => [...prev, v], [] as string[])
  .option('--input-format <mime>', 'Override input MIME type (useful when piping)')
  .option('--json', 'Force JSON output to stdout')
  .option('--verbose', 'Print progress to stderr')
  .action(async (toolId: string, inputs: string[], opts: Record<string, unknown>) => {
    await executeTool(toolId, inputs, {
      output: opts['output'] as string | undefined,
      outputDir: opts['outputDir'] as string | undefined,
      param: opts['param'] as string[],
      inputFormat: opts['inputFormat'] as string | undefined,
      json: opts['json'] as boolean | undefined,
      verbose: opts['verbose'] as boolean | undefined,
    });
  });

// Allow `wyreup run <tool-id> --help` to show param schema flags too.
// We can only do this at the top level since we don't know the tool ID at option-parse time.
// Per-tool flags are better served by the shorthand path below.

void runCmd; // referenced

// ──── chain ───────────────────────────────────────────────────────────────────

program
  .command('chain')
  .description('Run a chain of tools in sequence')
  .argument('[inputs...]', 'Input file paths (use - for stdin, or omit for stdin when piping)')
  .option('--steps <chain>', 'Chain string: "tool1|tool2[key=val]|tool3"')
  .option('--from-url <url>', 'Parse chain from a Wyreup chain URL (?steps=...)')
  .option('--from-kit <path>', 'Read a chain from a Toolbelt JSON export (use with --name)')
  .option('--name <name>', 'Chain name or id to load from --from-kit')
  .option('-o, --output <path>', 'Output file path')
  .option('-O, --output-dir <dir>', 'Output directory for multi-output chains')
  .option('--save-intermediates <dir>', 'Save each step\'s output to this directory')
  .option('--input-format <mime>', 'Override input MIME type')
  .option('--dry-run', 'Print the parsed plan, MIME flow, and install-group totals without running anything')
  .option('--verbose', 'Print progress to stderr')
  .addHelpText(
    'after',
    `
Chain string syntax:
  tool-id                         — run with defaults
  tool-id[key=val,key2=val2]     — run with param overrides
  tool1|tool2|tool3               — pipe output of each step to next

Examples:
  wyreup chain photo.jpg --steps "strip-exif|compress[quality=75]" -o clean.jpg
  wyreup chain photo.jpg --from-url "https://wyreup.com/chain/run?steps=strip-exif|compress" -o out.jpg
  wyreup chain photo.jpg --from-kit ~/wyreup-kit.json --name "photo cleanup" -o clean.jpg
  cat photo.jpg | wyreup chain --steps "strip-exif" --input-format image/jpeg > clean.jpg
  wyreup chain --steps "transcribe|text-summarize" --dry-run   # preview only

Saved chains:
  Export your toolbelt from /toolbelt on the web (uses the same JSON
  format the CLI's --from-kit reads). Name match is case-insensitive
  and accepts substrings or chain ids.`,
  )
  .action(async (inputs: string[], opts: Record<string, unknown>) => {
    await executeChain(inputs, {
      steps: opts['steps'] as string | undefined,
      fromUrl: opts['fromUrl'] as string | undefined,
      fromKit: opts['fromKit'] as string | undefined,
      name: opts['name'] as string | undefined,
      output: opts['output'] as string | undefined,
      outputDir: opts['outputDir'] as string | undefined,
      saveIntermediates: opts['saveIntermediates'] as string | undefined,
      inputFormat: opts['inputFormat'] as string | undefined,
      dryRun: opts['dryRun'] as boolean | undefined,
      verbose: opts['verbose'] as boolean | undefined,
    });
  });

// ──── watch ───────────────────────────────────────────────────────────────────

program
  .command('watch')
  .description('Watch a folder and run a chain on every new file (daemon)')
  .argument('<directory>', 'Directory to watch (only new files trigger runs)')
  .option('--steps <chain>', 'Chain string: "tool1|tool2[key=val]|tool3"')
  .option('--from-url <url>', 'Parse chain from a Wyreup chain URL (?steps=...)')
  .option('--from-kit <path>', 'Read a chain from a Toolbelt JSON export (use with --name)')
  .option('--name <name>', 'Chain name or id to load from --from-kit')
  .option('--out-dir <name>', 'Output subfolder name inside the watched directory (default _wyreup-out)')
  .option('--concurrency <n>', 'Max concurrent runs (1-8, default 2)', (v: string) => parseInt(v, 10))
  .option('--max-files <n>', 'Stop after this many runs finish (succeeded or failed). Useful for piloting a chain.', (v: string) => parseInt(v, 10))
  .option('--follow-symlinks', 'Follow symbolic links into the watched tree (off by default for safety)')
  .option('--allow-system', 'Override the safety guard against watching system / home dirs (you almost never want this)')
  .option('--verbose', 'Print per-file progress to stderr')
  .addHelpText(
    'after',
    `
Examples:
  wyreup watch ./screenshots --steps "strip-exif|compress[quality=80]"
  wyreup watch ./inbox --from-kit ~/wyreup-kit.json --name "photo cleanup"
  wyreup watch ./drops --from-url "https://wyreup.com/chain/run?steps=transcribe|text-summarize" --verbose
  wyreup watch ./pilot --steps "strip-exif|compress" --max-files 5  # try on 5 then exit

Behavior:
  - Watches for files added or moved into the directory (not edits to existing files).
  - Skips dotfiles, the output subfolder, and files whose MIME doesn't match the chain's first tool.
  - Outputs to ./<watch-dir>/_wyreup-out/ (configurable). Source files are never modified.
  - Symlinks are NOT followed by default. Pass --follow-symlinks to opt in.
  - Refuses to watch /, $HOME, /etc, /usr, etc. Pass --allow-system to override.
  - Logs paths, sizes, and durations only — never file contents.
  - Ctrl-C drains in-flight work, then exits cleanly.
  - --max-files counts processed + failed (skipped files don't count).`,
  )
  .action(async (directory: string, opts: Record<string, unknown>) => {
    await executeWatch(directory, {
      steps: opts['steps'] as string | undefined,
      fromUrl: opts['fromUrl'] as string | undefined,
      fromKit: opts['fromKit'] as string | undefined,
      name: opts['name'] as string | undefined,
      outDir: opts['outDir'] as string | undefined,
      concurrency: opts['concurrency'] as number | undefined,
      maxFiles: opts['maxFiles'] as number | undefined,
      followSymlinks: opts['followSymlinks'] as boolean | undefined,
      allowSystem: opts['allowSystem'] as boolean | undefined,
      verbose: opts['verbose'] as boolean | undefined,
    });
  });

// ──── tool-id shorthand (fall-through) ───────────────────────────────────────
//
// If the first argument is a known tool ID and not a built-in subcommand,
// route it to `executeTool`. This enables `wyreup compress photo.jpg -o out.jpg`.

const BUILTIN_COMMANDS = new Set([
  'list',
  'init-tool',
  'install-skill',
  'prefetch',
  'cache',
  'run',
  'chain',
  'watch',
  'help',
]);

// Check if argv[2] is a known tool ID before Commander gets its hands on it.
const firstArg = process.argv[2];
if (
  firstArg &&
  !firstArg.startsWith('-') &&
  !BUILTIN_COMMANDS.has(firstArg)
) {
  // Peek at the registry; if the tool exists AND runs on this
  // surface, handle it directly. Tools gated to web-only (e.g.
  // record-audio) fall through and Commander emits "unknown command".
  const registry = createDefaultRegistry();
  const tool = registry.toolsById.get(firstArg);

  if (tool && toolRunsOnSurface(tool, 'cli')) {
    // Build a sub-program for this tool so --help works correctly.
    const toolCmd = new Command(tool.id)
      .description(tool.description)
      .argument('[inputs...]', 'Input file paths (use - for stdin)')
      .option('-o, --output <path>', 'Output file path')
      .option('-O, --output-dir <dir>', 'Output directory (multi-output tools)')
      .option(
        '--param <key=value>',
        'Parameter override (repeatable)',
        (v: string, prev: string[]) => [...prev, v],
        [] as string[],
      )
      .option('--input-format <mime>', 'Override input MIME type')
      .option('--json', 'Force JSON output to stdout')
      .option('--verbose', 'Print progress to stderr');

    addToolOptions(toolCmd, tool);

    toolCmd.action(async (inputs: string[], opts: Record<string, unknown>) => {
      const extraParams = mergeToolOptions(opts, tool);
      const paramList = [...(opts['param'] as string[] ?? []), ...extraParams];
      await executeTool(tool.id, inputs, {
        output: opts['output'] as string | undefined,
        outputDir: opts['outputDir'] as string | undefined,
        param: paramList,
        inputFormat: opts['inputFormat'] as string | undefined,
        json: opts['json'] as boolean | undefined,
        verbose: opts['verbose'] as boolean | undefined,
      });
    });

    // Swap out argv[2] so Commander sees the tool id as a subcommand.
    process.argv.splice(2, 1, tool.id);
    program.addCommand(toolCmd);
  }
}

program.parse();

// Suppress unused import warning
void createReadStream;
