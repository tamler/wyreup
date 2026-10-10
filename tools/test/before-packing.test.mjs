import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { beforePacking } = require('../../.pnpmfile.cjs').hooks;
const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

describe('native beforePacking manifest canonicalization', () => {
  it.each(fields)('uses codepoint key order and preserves exact %s values', (field) => {
    const dependencies = {
      zed: 'npm:debug@^4.0.0',
      alpha: '~1.2.3',
      Zed: '>=2 <4',
      '@example/peer': '^6.0.0',
    };
    const pkg = { name: '@example/package', version: '1.2.3', [field]: dependencies };
    expect(beforePacking(pkg)).toBe(pkg);
    expect(Object.keys(pkg[field])).toEqual(['@example/peer', 'Zed', 'alpha', 'zed']);
    expect(pkg[field]).toEqual(dependencies);
    expect(Object.keys(dependencies)).toEqual(['zed', 'alpha', 'Zed', '@example/peer']);
  });

  it('does not create absent maps or replace null and undefined fields', () => {
    const absent = { name: 'absent', version: '1.0.0' };
    expect(beforePacking(absent)).toEqual({ name: 'absent', version: '1.0.0' });
    expect(Object.keys(absent)).toEqual(['name', 'version']);
    const optional = { dependencies: null, devDependencies: undefined };
    const keys = Object.keys(optional);
    beforePacking(optional);
    expect(optional.dependencies).toBeNull();
    expect(optional.devDependencies).toBeUndefined();
    expect(Object.keys(optional)).toEqual(keys);
  });

  it('preserves empty maps and all unrelated field data and root key order', () => {
    const pkg = {
      name: '@example/package',
      scripts: { test: 'node test.mjs' },
      dependencies: {},
      files: ['dist', 'README.md'],
      peerDependenciesMeta: { zed: { optional: true } },
      engines: { node: '>=22.13' },
      publishConfig: { access: 'public' },
    };
    const original = structuredClone(pkg);
    const keys = Object.keys(pkg);
    beforePacking(pkg);
    expect(pkg).toEqual(original);
    expect(Object.keys(pkg)).toEqual(keys);
    expect(Object.keys(pkg.dependencies)).toEqual([]);
  });

  it('canonicalizes all four converted maps together without changing resolved values', () => {
    const pkg = { name: '@example/package', version: '1.0.0' };
    for (const field of fields) {
      pkg[field] = { '@example/z': '1.2.3', '@example/a': '^2.3.4' };
    }
    const original = structuredClone(pkg);
    const keys = Object.keys(pkg);
    beforePacking(pkg);
    for (const field of fields) {
      expect(Object.keys(pkg[field])).toEqual(['@example/a', '@example/z']);
      expect(pkg[field]).toEqual(original[field]);
    }
    expect(Object.keys(pkg)).toEqual(keys);
  });

  it('is idempotent for an already converted packed manifest', () => {
    const pkg = { dependencies: { zed: '1.2.3', alpha: '2.3.4' } };
    beforePacking(pkg);
    const first = JSON.stringify(pkg);
    beforePacking(pkg);
    expect(JSON.stringify(pkg)).toBe(first);
  });
});
