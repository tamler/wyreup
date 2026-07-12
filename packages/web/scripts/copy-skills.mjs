// Copy the published agent skills into the static build so
// `wyreup install-skill` fetches them from wyreup.com — the CLI's egress
// lock allows only first-party origins, and self-hosting matches the
// models.wyreup.com precedent. Source of truth: packages/*-skill/skill.md.
import { mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const out = join(here, '..', 'public', 'skills');
mkdirSync(out, { recursive: true });
for (const [src, dst] of [
  ['packages/skill/skill.md', 'wyreup.md'],
  ['packages/cli-skill/skill.md', 'wyreup-cli.md'],
  ['packages/mcp-skill/skill.md', 'wyreup-mcp.md'],
]) {
  copyFileSync(join(repo, src), join(out, dst));
}
console.log('skills copied to public/skills/');
