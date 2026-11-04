import { it } from 'vitest';
import assert from 'node:assert/strict';
import config from '../../packages/web/astro.config.mjs';

const configUrl = new URL('../../packages/web/astro.config.mjs', import.meta.url);
const browserDirectory = new URL('../core/dist/browser/', configUrl);
const plugins = config.vite.plugins.filter(plugin => plugin.name === 'wyreup-client-utility-chunks');
assert.equal(plugins.length, 1);
const plugin = plugins[0];
const families = [
  ['planningTools', 'utility-planning'],
  ['buildingTools', 'utility-building'],
  ['hardwareTools', 'utility-hardware'],
  ['financeTools', 'utility-finance'],
  ['textDeveloperTools', 'utility-text-developer'],
];

function group() {
  const environment = {};
  plugin.configEnvironment('client', environment);
  return environment.build.rolldownOptions.output.codeSplitting.groups[0];
}

function context(moduleId, exports) {
  return { getModuleInfo(id) { return id === moduleId ? { exports } : undefined; } };
}

it('excludes only the public root index barrel from provider classification', () => {
  const selected = group();
  assert.equal(selected.test(new URL('index.js', browserDirectory).pathname), false);
  assert.equal(selected.test(new URL('nested/index.js', browserDirectory).pathname), true);
});

it('retains the exact public-barrel six-binding name rejection independently of selection', () => {
  const moduleId = new URL('index.js', browserDirectory).pathname;
  const exports = families.map(([binding]) => binding).concat('createDefaultRegistry');
  assert.throws(() => group().name(moduleId, context(moduleId, exports)), {
    message: 'Core utility providers must have separate module boundaries.',
  });
});

it('rejects multiple family implementations in a selected nonbarrel module', () => {
  const moduleId = new URL('chunk-mixed-providers.js', browserDirectory).pathname;
  const selected = group();
  assert.equal(selected.test(moduleId), true);
  assert.throws(() => selected.name(moduleId, context(moduleId, ['planningTools', 'hardwareTools'])), {
    message: 'Core utility providers must have separate module boundaries.',
  });
});

it('rejects a registry implementation combined with one provider', () => {
  const moduleId = new URL('chunk-registry-provider.js', browserDirectory).pathname;
  assert.throws(() => group().name(moduleId, context(moduleId, ['createDefaultRegistry', 'financeTools'])), {
    message: 'Core registry must be separate from utility providers.',
  });
});

it.each(families)('keeps %s in its own named provider group', (binding, expected) => {
  const moduleId = new URL(`${expected}.js`, browserDirectory).pathname;
  const selected = group();
  assert.equal(selected.test(moduleId), true);
  assert.equal(selected.name(moduleId, context(moduleId, [binding])), expected);
});

it('keeps the registry implementation in core-registry', () => {
  const moduleId = new URL('chunk-registry.js', browserDirectory).pathname;
  const selected = group();
  assert.equal(selected.test(moduleId), true);
  assert.equal(selected.name(moduleId, context(moduleId, ['createDefaultRegistry'])), 'core-registry');
});

it('leaves unrelated eligible modules to ordinary chunk selection', () => {
  const moduleId = new URL('chunk-unrelated.js', browserDirectory).pathname;
  const selected = group();
  assert.equal(selected.test(moduleId), true);
  assert.equal(selected.name(moduleId, context(moduleId, ['unrelatedFunction'])), null);
});

it('refuses missing module metadata with the exact message', () => {
  const moduleId = new URL('chunk-missing.js', browserDirectory).pathname;
  assert.throws(() => group().name(moduleId, context(`${moduleId}-different`, ['planningTools'])), {
    message: 'Core provider module information is unavailable.',
  });
});

it.each([[undefined], ['planningTools'], [['planningTools', 1]]])('refuses malformed export metadata %j', exports => {
  const moduleId = new URL('chunk-bad-metadata.js', browserDirectory).pathname;
  assert.throws(() => group().name(moduleId, context(moduleId, exports)), {
    message: 'Core provider module information is unavailable.',
  });
});

it.each([
  'file-worker.js',
  'bank-pdf-worker.js',
  'index.js?query',
  'chunk-query.js?query',
  'chunk-fragment.js#fragment',
])('retains the existing worker/query exclusion for %s', relative => {
  const moduleId = browserDirectory.pathname + relative;
  assert.equal(group().test(moduleId), false);
});

it('excludes Node outputs and foreign browser directories', () => {
  assert.equal(group().test(new URL('../node/index.js', browserDirectory).pathname), false);
  assert.equal(group().test(new URL('../../foreign/browser/chunk.js', browserDirectory).pathname), false);
});

it('does not change non-client environment configuration', () => {
  const environment = {};
  plugin.configEnvironment('prerender', environment);
  assert.deepEqual(environment, {});
});
