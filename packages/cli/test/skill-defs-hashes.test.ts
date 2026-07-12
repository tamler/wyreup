import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { SKILL_DEFS } from '../src/commands/install-skill.js';

// Drift gate: SKILL_DEFS pins the SHA-256 of each published skill.md.
// Editing a skill file without updating its pin (or vice versa) must fail
// here, because install-skill verifies the pin against the fetched bytes —
// a stale pin bricks `wyreup install-skill` for every user.
describe('SKILL_DEFS sha256 pins', () => {
  const repoRoot = join(__dirname, '..', '..', '..');

  for (const [variant, def] of Object.entries(SKILL_DEFS)) {
    it(`${variant}: pin matches the committed skill.md`, async () => {
      const variantToRepoPath: Record<string, string> = {
        cli: 'packages/cli-skill/skill.md',
        mcp: 'packages/mcp-skill/skill.md',
        combined: 'packages/skill/skill.md',
      };
      const repoPath = variantToRepoPath[variant]!;
      const bytes = await readFile(join(repoRoot, repoPath));
      const actual = createHash('sha256').update(bytes).digest('hex');
      expect(def.sha256, `update the ${variant} pin in SKILL_DEFS`).toBe(actual);
    });
  }
});
