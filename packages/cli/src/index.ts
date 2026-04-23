#!/usr/bin/env node
import { Command } from 'commander';
import { createReadStream } from 'node:fs';
import { listCommand } from './commands/list.js';
import { initToolCommand } from './commands/init-tool.js';
import { makeInstallSkillCommand } from './commands/install-skill.js';
import { executeTool, addToolOptions, mergeToolOptions } from './commands/run.js';
import { executeChain } from './commands/chain.js';
import { createDefaultRegistry } from '@wyreup/core';

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
  .option('-o, --output <path>', 'Output file path')
  .option('-O, --output-dir <dir>', 'Output directory for multi-output chains')
  .option('--save-intermediates <dir>', 'Save each step\'s output to this directory')
  .option('--input-format <mime>', 'Override input MIME type')
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
  cat photo.jpg | wyreup chain --steps "strip-exif" --input-format image/jpeg > clean.jpg`,
  )
  .action(async (inputs: string[], opts: Record<string, unknown>) => {
    await executeChain(inputs, {
      steps: opts['steps'] as string | undefined,
      fromUrl: opts['fromUrl'] as string | undefined,
      output: opts['output'] as string | undefined,
      outputDir: opts['outputDir'] as string | undefined,
      saveIntermediates: opts['saveIntermediates'] as string | undefined,
      inputFormat: opts['inputFormat'] as string | undefined,
      verbose: opts['verbose'] as boolean | undefined,
    });
  });

// ──── tool-id shorthand (fall-through) ───────────────────────────────────────
//
// If the first argument is a known tool ID and not a built-in subcommand,
// route it to `executeTool`. This enables `wyreup compress photo.jpg -o out.jpg`.

const BUILTIN_COMMANDS = new Set(['list', 'init-tool', 'install-skill', 'run', 'chain', 'help']);

// Check if argv[2] is a known tool ID before Commander gets its hands on it.
const firstArg = process.argv[2];
if (
  firstArg &&
  !firstArg.startsWith('-') &&
  !BUILTIN_COMMANDS.has(firstArg)
) {
  // Peek at the registry; if the tool exists, handle it directly.
  const registry = createDefaultRegistry();
  const tool = registry.toolsById.get(firstArg);

  if (tool) {
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
