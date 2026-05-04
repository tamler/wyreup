import * as p from '@clack/prompts';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Command } from 'commander';
import { EXIT_CODES } from '../lib/exit-codes.js';

const SKILL_VARIANTS = ['cli', 'mcp', 'combined'] as const;
type SkillVariant = (typeof SKILL_VARIANTS)[number];

const LOCATION_CHOICES = ['project', 'user', 'custom'] as const;
type LocationChoice = (typeof LOCATION_CHOICES)[number];

export const SKILL_DEFS: Record<SkillVariant, { name: string; url: string; description: string }> = {
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

export function resolveSkillsDir(
  location: LocationChoice,
  customPath?: string,
): string {
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

export async function fetchSkill(url: string): Promise<string> {
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
  return res.text();
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
  update: boolean;
  yes: boolean;
}): Promise<void> {
  p.intro('wyreup install-skill');

  // Resolve variant
  let variant = opts.variant;
  if (!variant) {
    const picked = await p.select({
      message: 'Which Wyreup skill do you want to install?',
      options: SKILL_VARIANTS.map((v) => ({
        value: v,
        label: SKILL_DEFS[v].description,
      })),
      initialValue: 'combined' as SkillVariant,
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
    const picked = await p.select({
      message: 'Where should the skill be installed?',
      options: [
        { value: 'project', label: 'Claude Code (project)  —  .claude/skills/ in current directory' },
        { value: 'user', label: 'Claude Code (user)  —  ~/.claude/skills/' },
        { value: 'custom', label: 'Custom path  —  prompt for a path' },
      ],
      initialValue: 'project' as LocationChoice,
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
    content = await fetchSkill(def.url);
  } catch (err) {
    // Network or HTTP failure: SYSTEM error (out of CLI-args control).
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
    .description('Fetch and install a Wyreup skill.md into your agent\'s skills directory')
    .option('--variant <cli|mcp|combined>', 'Skill variant to install (default: combined)')
    .option('--location <project|user|custom>', 'Install location (default: project)')
    .option('--path <dir>', 'Custom directory path (used with --location custom, or as override)')
    .option('--update', 'Overwrite the skill if already installed', false)
    .option('--list', 'List currently installed Wyreup skills and exit', false)
    .option('-y, --yes', 'Skip confirmation prompt', false)
    .action(async (rawOpts: {
      list?: boolean;
      variant?: string;
      location?: string;
      path?: string;
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
        rawOpts.path !== undefined;

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
        update: rawOpts.update ?? false,
        yes,
      });
    });

  return cmd;
}
