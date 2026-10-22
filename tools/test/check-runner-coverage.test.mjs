import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRunnerCoverage } from '../check-runner-coverage.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultSource = `
import { legacy } from './tools/legacy/index.js';
import { utilityTools, nodeOnly } from './utilities/group.js';
export const defaultTools = [legacy, ...utilityTools, nodeOnly];
`;
const variantSource = `
export type RunnerVariant = 'ImageRunner' | 'UtilityRunner';
export const VARIANT_MAP = { legacy: 'ImageRunner', utility: 'UtilityRunner' };
`;
const loaderSource = `
<script lang="ts">
  const comparison = 10 > 3;
  const variantLoaders: Record<string, () => Promise<{default: unknown}>> = {
    ImageRunner: () => import('./runners/ImageRunner.svelte'),
    UtilityRunner: () => import('./runners/UtilityRunner.svelte'),
  };
</script>
<div title="literal > marker">{comparison}</div>
`;
const legacy = { id: 'legacy' };
const utility = { id: 'utility', surfaces: ['web'] };
const nodeOnly = { id: 'node-only', surfaces: ['cli', 'mcp'] };
const core = {
  legacy,
  utilityTools: [utility],
  nodeOnly,
  defaultTools: [legacy, utility, nodeOnly],
  createDefaultRegistry: () => ({ tools: [legacy, utility, nodeOnly] }),
};

describe('runner coverage AST and registry boundary', () => {
  let root;
  async function put(path, body) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  }
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wyreup-runner-coverage-'));
    await put('packages/core/src/default-registry.ts', defaultSource);
    await mkdir(join(root, 'packages/core/src/tools/legacy'), { recursive: true });
    await put('packages/web/package.json', '{"type":"module"}');
    await symlink(
      join(repository, 'packages/web/node_modules'),
      join(root, 'packages/web/node_modules'),
    );
    await put('packages/web/src/components/runners/variantMap.ts', variantSource);
    await put('packages/web/src/components/ToolRunner.svelte', loaderSource);
    await put('packages/web/src/components/runners/ImageRunner.svelte', '<div>image</div>');
    await put('packages/web/src/components/runners/UtilityRunner.svelte', '<div>utility</div>');
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('uses source group membership and excludes an actual non-web tool', async () => {
    expect(await checkRunnerCoverage({ root, core })).toEqual({
      tools: 2,
      registeredTools: 3,
      variants: 2,
    });
  });

  it.each([
    [
      'stale ID',
      `${variantSource.replace("utility: 'UtilityRunner'", "utility: 'UtilityRunner', stale: 'ImageRunner'")}`,
      /stale \[stale\]/,
    ],
    [
      'missing ID',
      `${variantSource.replace(", utility: 'UtilityRunner'", '')}`,
      /missing \[utility\]/,
    ],
    [
      'duplicate ID',
      `${variantSource.replace("legacy: 'ImageRunner'", "legacy: 'ImageRunner', legacy: 'UtilityRunner'")}`,
      /duplicate key legacy/,
    ],
    [
      'spread',
      `${variantSource.replace("legacy: 'ImageRunner'", "...extra, legacy: 'ImageRunner'")}`,
      /no spread/,
    ],
    [
      'computed key',
      `${variantSource.replace("legacy: 'ImageRunner'", "[dynamic]: 'ImageRunner'")}`,
      /no computed keys/,
    ],
    [
      'dynamic value',
      `${variantSource.replace("legacy: 'ImageRunner'", 'legacy: chosenRunner')}`,
      /literal strings/,
    ],
  ])('refuses %s in the actual TypeScript map syntax', async (_name, source, error) => {
    await put('packages/web/src/components/runners/variantMap.ts', source);
    await expect(checkRunnerCoverage({ root, core })).rejects.toThrow(error);
  });

  it.each([
    [
      'noncallable loader',
      loaderSource.replace(
        "() => import('./runners/ImageRunner.svelte')",
        "import('./runners/ImageRunner.svelte')",
      ),
      /must be callable/,
    ],
    [
      'dynamic import',
      loaderSource.replace("import('./runners/ImageRunner.svelte')", 'import(chosenPath)'),
      /literal import/,
    ],
    [
      'missing target',
      loaderSource.replace('./runners/ImageRunner.svelte', './runners/MissingRunner.svelte'),
      /missing import target/,
    ],
    [
      'duplicate loader',
      loaderSource.replace(
        "ImageRunner: () => import('./runners/ImageRunner.svelte'),",
        "ImageRunner: () => import('./runners/ImageRunner.svelte'), ImageRunner: () => import('./runners/ImageRunner.svelte'),",
      ),
      /duplicate key/,
    ],
  ])('refuses %s in the Svelte instance script', async (_name, source, error) => {
    await put('packages/web/src/components/ToolRunner.svelte', source);
    await expect(checkRunnerCoverage({ root, core })).rejects.toThrow(error);
  });

  it('does not confuse an earlier module script, comments, or greater-than characters with instance offsets', async () => {
    const shifted = `<script context="module" lang="ts">const earlier = 'marker >';</script>\n<!-- > -->\n${loaderSource}`;
    await put('packages/web/src/components/ToolRunner.svelte', shifted);
    expect((await checkRunnerCoverage({ root, core })).tools).toBe(2);
  });

  it('rejects a source omission of a utility group even if the compiled registry is old', async () => {
    await put(
      'packages/core/src/default-registry.ts',
      defaultSource.replace('...utilityTools, ', ''),
    );
    await expect(checkRunnerCoverage({ root, core })).rejects.toThrow(
      'Source registration/built registry',
    );
  });

  it('rejects a non-default runtime registry that omitted a group', async () => {
    await expect(
      checkRunnerCoverage({
        root,
        core: {
          ...core,
          createDefaultRegistry: () => ({ tools: [legacy, nodeOnly] }),
        },
      }),
    ).rejects.toThrow('Built default registry/defaultTools');
  });

  it('retains the missing legacy directory registration oracle', async () => {
    await mkdir(join(root, 'packages/core/src/tools/unregistered'), { recursive: true });
    await expect(checkRunnerCoverage({ root, core })).rejects.toThrow(
      'Legacy tool directory missing registration',
    );
  });

  it('rejects dynamic default registration instead of guessing its contents', async () => {
    await put(
      'packages/core/src/default-registry.ts',
      defaultSource.replace('[legacy, ...utilityTools, nodeOnly]', 'chooseTools()'),
    );
    await expect(checkRunnerCoverage({ root, core })).rejects.toThrow(
      'defaultTools must be a literal array',
    );
  });
});
