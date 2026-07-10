import * as p from '@clack/prompts';
import { mkdir, writeFile, access, readFile, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { Command } from 'commander';
import { EXIT_CODES } from '../lib/exit-codes.js';

const SKILL_VARIANTS = ['cli', 'mcp', 'combined'] as const;
type SkillVariant = (typeof SKILL_VARIANTS)[number];

const LOCATION_CHOICES = ['project', 'user', 'custom'] as const;
type LocationChoice = (typeof LOCATION_CHOICES)[number];

// Skill markdown is fetched from a remote and then consumed by Claude Code as
// instructions, so a compromised repo or MITM could inject prompt-injection
// directives. We guard the fetched bytes before trusting them: cap the size,
// require a text/markdown content-type, and — when an expected hash is pinned
// in SKILL_DEFS below — verify the SHA-256 and reject on mismatch.
//
// RECOMMENDATION: pin a `sha256` on each SKILL_DEFS entry once the upstream
// skill.md content is stable. While the files still change upstream we leave
// `sha256` unset so installs keep working, but an unpinned skill trades the
// hash guard for the size + content-type checks only.
const MAX_SKILL_BYTES = 512 * 1024; // 512 KB — skill.md files are a few KB

interface SkillDef {
  name: string;
  url: string;
  description: string;
  /** Optional pinned SHA-256 (hex) of the expected skill.md bytes. */
  sha256?: string;
}

export const SKILL_DEFS: Record<SkillVariant, SkillDef> = {
  cli: {
    name: 'wyreup-cli',
    url: 'https://raw.githubusercontent.com/tamler/wyreup/main/packages/cli-skill/skill.md',
    description: 'CLI-only (smallest, for Claude Code shell agents)',
  },
  mcp: {
    name: 'wyreup-mcp',
    url: 'https://raw.githubusercontent.com/tamler/wyreup/main/packages/mcp-skill/skill.md',
    description: 'MCP-only (for agents that call tools via MCP)',
  },
  combined: {
    name: 'wyreup',
    url: 'https://raw.githubusercontent.com/tamler/wyreup/main/packages/skill/skill.md',
    description: 'Both CLI and MCP (default; for most setups)',
  },
};

export function resolveSkillsDir(location: LocationChoice, customPath?: string): string {
  if (location === 'custom') {
    if (!customPath) throw new Error('--path is required when --location is custom');
    return customPath;
  }
  if (location === 'project') return join(process.cwd(), '.claude', 'skills');
  if (location === 'user') return join(homedir(), '.claude', 'skills');
  // Exhaustiveness check — location is `never` here.
  const exhaustive: never = location;
  throw new Error(`Unknown location: ${String(exhaustive)}`);
}

/**
 * Read a skill.md from a local path. The argument may point at a `skill.md`
 * file directly or at a directory containing one. Used by --source for local
 * iteration (and by CI tests that don't want a network roundtrip).
 */
export async function readLocalSkill(sourcePath: string): Promise<string> {
  const abs = resolve(sourcePath);
  // Open once and fstat the handle instead of stat-then-read on the path,
  // so there is no window between the check and the use. An explicit
  // isDirectory() check (not an EISDIR catch) because FreeBSD's readFile
  // on a directory returns its raw contents instead of rejecting.
  let isDirectory = false;
  try {
    const fh = await open(abs, 'r');
    try {
      isDirectory = (await fh.stat()).isDirectory();
      if (!isDirectory) return await fh.readFile({ encoding: 'utf8' });
    } finally {
      await fh.close();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read --source "${sourcePath}": ${msg}`);
  }
  const target = join(abs, 'skill.md');
  try {
    return await readFile(target, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read skill file at ${target}: ${msg}`);
  }
}

export async function fetchSkill(url: string, expectedSha256?: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Network error fetching skill from ${url}: ${msg}\n` +
        'Use --path to install from a local skill.md file instead.',
    );
  }
  if (!res.ok) {
    // 404 is the most likely real-world failure: the SKILL_DEFS URLs
    // hardcode raw.githubusercontent.com paths to packages that may
    // have moved, been renamed, or be on a different branch. Surface
    // a more specific recovery hint than a generic HTTP message.
    if (res.status === 404) {
      throw new Error(
        `Skill not found at ${url} (HTTP 404).\n` +
          'The hardcoded URL may be out of date — open an issue at\n' +
          'https://github.com/tamler/wyreup/issues so the SKILL_DEFS\n' +
          'map can be refreshed. Meanwhile, install from a local file:\n' +
          '  wyreup install-skill --path ./skill.md',
      );
    }
    throw new Error(
      `Failed to fetch skill from ${url}: HTTP ${res.status} ${res.statusText}\n` +
        'Use --path to install from a local skill.md file instead.',
    );
  }

  // Integrity guards — the fetched content becomes agent instructions, so we
  // refuse anything that isn't a plausibly-small text/markdown payload.
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (contentType && !/text\/(plain|markdown)|text\/x-markdown/.test(contentType)) {
    throw new Error(
      `Refusing skill from ${url}: unexpected content-type "${contentType}" ` +
        '(expected text/plain or markdown). Install from a local file with --path instead.',
    );
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_SKILL_BYTES) {
    throw new Error(
      `Refusing skill from ${url}: content is ${bytes.byteLength} bytes, ` +
        `over the ${MAX_SKILL_BYTES}-byte limit. Install from a local file with --path instead.`,
    );
  }

  if (expectedSha256) {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expectedSha256.toLowerCase()) {
      throw new Error(
        `Refusing skill from ${url}: SHA-256 mismatch ` +
          `(expected ${expectedSha256.toLowerCase()}, got ${actual}). ` +
          'The remote content may have been tampered with or the pinned hash is stale.',
      );
    }
  }

  return new TextDecoder().decode(bytes);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listInstalledSkills(): Promise<void> {
  const locations = [
    { label: 'project', dir: join(process.cwd(), '.claude', 'skills') },
    { label: 'user', dir: join(homedir(), '.claude', 'skills') },
  ];

  const found: string[] = [];

  for (const { label, dir } of locations) {
    for (const variant of SKILL_VARIANTS) {
      const def = SKILL_DEFS[variant];
      const skillFile = join(dir, def.name, 'skill.md');
      if (await fileExists(skillFile)) {
        found.push(`  ${def.name}  (${label})  ${skillFile}`);
      }
    }
  }

  if (found.length === 0) {
    console.log('No Wyreup skills installed.');
  } else {
    console.log('Installed Wyreup skills:');
    for (const line of found) {
      console.log(line);
    }
  }
}

async function runInteractive(opts: {
  variant?: SkillVariant;
  location?: LocationChoice;
  path?: string;
  source?: string;
  update: boolean;
  yes: boolean;
}): Promise<void> {
  p.intro('wyreup install-skill');

  // Resolve variant
  let variant = opts.variant;
  if (!variant) {
    const picked = await p.select<SkillVariant>({
      message: 'Which Wyreup skill do you want to install?',
      options: SKILL_VARIANTS.map((v) => ({
        value: v,
        label: SKILL_DEFS[v].description,
      })),
      initialValue: 'combined',
    });
    if (p.isCancel(picked)) {
      p.cancel('Cancelled.');
      process.exit(0);
    }
    variant = picked;
  }

  // Resolve location / path
  let location = opts.location;
  let customPath = opts.path;

  if (!location && !customPath) {
    const picked = await p.select<LocationChoice>({
      message: 'Where should the skill be installed?',
      options: [
        {
          value: 'project',
          label: 'Claude Code (project)  —  .claude/skills/ in current directory',
        },
        { value: 'user', label: 'Claude Code (user)  —  ~/.claude/skills/' },
        { value: 'custom', label: 'Custom path  —  prompt for a path' },
      ],
      initialValue: 'project',
    });
    if (p.isCancel(picked)) {
      p.cancel('Cancelled.');
      process.exit(0);
    }
    location = picked;

    if (location === 'custom') {
      const userPath = await p.text({
        message: 'Enter the directory path for the skill',
        placeholder: '/path/to/skills',
        validate: (v) => {
          if (!v) return 'Path is required.';
        },
      });
      if (p.isCancel(userPath)) {
        p.cancel('Cancelled.');
        process.exit(0);
      }
      customPath = String(userPath);
    }
  }

  if (!location) {
    location = customPath ? 'custom' : 'project';
  }

  const def = SKILL_DEFS[variant];
  const skillsDir = resolveSkillsDir(location, customPath);
  const skillDir = join(skillsDir, def.name);
  const skillFile = join(skillDir, 'skill.md');

  const exists = await fileExists(skillFile);
  if (exists && !opts.update) {
    console.log(`Skill already installed at ${skillFile}. Use --update to refresh.`);
    return;
  }
  if (exists && opts.update) {
    console.warn(`Warning: existing skill.md at ${skillFile} will be overwritten.`);
  }

  if (!opts.yes) {
    const ok = await p.confirm({
      message: `Install "${def.name}" to ${skillFile}?`,
      initialValue: true,
    });
    if (p.isCancel(ok) || !ok) {
      p.cancel('Cancelled.');
      process.exit(0);
    }
  }

  let content: string;
  try {
    content = opts.source
      ? await readLocalSkill(opts.source)
      : await fetchSkill(def.url, def.sha256);
  } catch (err) {
    // Network / filesystem failure: SYSTEM error (out of CLI-args control).
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(EXIT_CODES.SYSTEM_ERROR);
  }

  try {
    await mkdir(skillDir, { recursive: true });
    await writeFile(skillFile, content, 'utf8');
  } catch (err) {
    // Filesystem write failure: SYSTEM error.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error writing skill file: ${msg}`);
    if (msg.includes('EACCES') || msg.includes('permission')) {
      console.error('Permission denied. Try a different path or check directory permissions.');
    }
    process.exit(EXIT_CODES.SYSTEM_ERROR);
  }

  p.outro(`Installed: ${def.name}  ->  ${skillFile}`);
}

export function makeInstallSkillCommand(): Command {
  const cmd = new Command('install-skill');
  cmd
    .description("Fetch and install a Wyreup skill.md into your agent's skills directory")
    .option('--variant <cli|mcp|combined>', 'Skill variant to install (default: combined)')
    .option('--location <project|user|custom>', 'Install location (default: project)')
    .option('--path <dir>', 'Custom directory path (used with --location custom, or as override)')
    .option(
      '--source <path>',
      "Read skill.md from a local file or directory instead of GitHub. Use for local development of skill content, or in CI tests where you don't want a network fetch.",
    )
    .option('--update', 'Overwrite the skill if already installed', false)
    .option('--list', 'List currently installed Wyreup skills and exit', false)
    .option('-y, --yes', 'Skip confirmation prompt', false)
    .action(
      async (rawOpts: {
        list?: boolean;
        variant?: string;
        location?: string;
        path?: string;
        source?: string;
        update?: boolean;
        yes?: boolean;
      }) => {
        if (rawOpts.list) {
          await listInstalledSkills();
          return;
        }

        if (rawOpts.variant && !SKILL_VARIANTS.includes(rawOpts.variant as SkillVariant)) {
          console.error(
            `Invalid --variant "${rawOpts.variant}". Must be one of: ${SKILL_VARIANTS.join(', ')}.`,
          );
          process.exit(1);
        }

        if (rawOpts.location && !LOCATION_CHOICES.includes(rawOpts.location as LocationChoice)) {
          console.error(
            `Invalid --location "${rawOpts.location}". Must be one of: ${LOCATION_CHOICES.join(', ')}.`,
          );
          process.exit(1);
        }

        const isNonInteractive =
          rawOpts.variant !== undefined ||
          rawOpts.location !== undefined ||
          rawOpts.path !== undefined ||
          rawOpts.source !== undefined;

        let yes = rawOpts.yes ?? false;
        if (isNonInteractive && !yes) {
          // For non-interactive flag usage, default yes to true unless they have a TTY.
          // In CI / piped contexts skip the prompt.
          yes = !process.stdin.isTTY;
        }

        await runInteractive({
          variant: rawOpts.variant as SkillVariant | undefined,
          location: rawOpts.location as LocationChoice | undefined,
          path: rawOpts.path,
          source: rawOpts.source,
          update: rawOpts.update ?? false,
          yes,
        });
      },
    );

  return cmd;
}
