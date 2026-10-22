import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const root = path.resolve(new URL('../../', import.meta.url).pathname);
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, `docs/CATALOG-INTEGRATION-${name}.json`)));
const documents = () => ({
  mapping: read('MAPPING'),
  oracles: read('ORACLES'),
  gates: read('SOURCE-GATES'),
});
const checker = () => import('../check-catalog-evidence.mjs');
const validate = async (data, options = {}) =>
  (await checker()).validateCatalogEvidence({ root, ...data, ...options });

test('supplemental whole JSON accepts exact values and refuses extra/missing keys and YAML errors', async () => {
  const { checkArtifact } = await checker();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-supplemental-json-'));
  try {
    const expected = { valid: true, parsed: { a: 1 }, summary: { type: 'object', topKeys: ['a'] } };
    const oracle = {
      kind: 'json-exact',
      mime: 'application/json',
      expected,
      authority: 'Independent YAML literal.',
    };
    async function check(value) {
      const bytes = Buffer.from(JSON.stringify(value));
      fs.writeFileSync(path.join(dir, 'value.json'), bytes);
      return checkArtifact(
        dir,
        { path: 'value.json', bytes: bytes.length, sha256: sha(bytes), mime: 'application/json' },
        oracle,
      );
    }
    await check(expected);
    for (const value of [
      { ...expected, extra: true },
      { valid: true, parsed: { a: 1 } },
      { ...expected, error: null },
      { ...expected, parsed: { a: '1' } },
      { ...expected, summary: { type: 'object', topKeys: ['a', 'b'] } },
    ])
      await assert.rejects(check(value), /JSON oracle mismatch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('supplemental ordered HTML artifacts refuse omitted/extra/reversed outputs and false MIME', async () => {
  const { checkFixtureArtifacts } = await checker();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-supplemental-order-'));
  try {
    const values = ['<p>Hello</p>', '{"bytesIn":20,"bytesOut":12,"reductionPercent":40}'];
    const artifacts = values.map((value, index) => {
      const bytes = Buffer.from(value),
        relative = `output-${index}`;
      fs.writeFileSync(path.join(dir, relative), bytes);
      return {
        path: relative,
        bytes: bytes.length,
        sha256: sha(bytes),
        mime: index ? 'application/json' : 'text/html',
      };
    });
    const authority = {
      artifactOracles: [
        {
          kind: 'text-exact',
          mime: 'text/html',
          expected: values[0],
          authority: 'Independent literal HTML.',
        },
        {
          kind: 'json-fields',
          mime: 'application/json',
          expected: { bytesIn: 20, bytesOut: 12, reductionPercent: 40 },
          authority: 'Independent report arithmetic.',
        },
      ],
    };
    await checkFixtureArtifacts(dir, artifacts, authority);
    await assert.rejects(
      checkFixtureArtifacts(dir, artifacts.slice(0, 1), authority),
      /artifact list/,
    );
    await assert.rejects(
      checkFixtureArtifacts(dir, [...artifacts, artifacts[0]], authority),
      /artifact list/,
    );
    await assert.rejects(checkFixtureArtifacts(dir, [...artifacts].reverse(), authority));
    await assert.rejects(
      checkFixtureArtifacts(
        dir,
        [{ ...artifacts[0], mime: 'text/plain' }, artifacts[1]],
        authority,
      ),
      /MIME/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('supplemental fixture admission derives all ten actual public run authorities and rejects substitutions', async () => {
  const { protectedSupplementalFixtures, boundFixtureOracle } = await checker();
  assert.equal(
    typeof protectedSupplementalFixtures,
    'function',
    'Actual supplemental source derivation is required.',
  );
  const candidates = await protectedSupplementalFixtures(root);
  assert.equal(candidates.length, 10);
  assert.deepEqual([...new Set(candidates.map((item) => item.engineId))].sort(), [
    'color-harmony',
    'css-minify',
    'html-minify',
    'roman-numeral',
    'yaml-validate',
  ]);
  const data = documents();
  const engine = (id) =>
    data.mapping.rows.flatMap((row) => row.engines).find((item) => item.id === id);
  const authority = candidates.find((item) => item.key === 'supplemental-html-remove-comments');
  const catalog = { ...data.oracles, supplementalFixtureAuthorities: candidates };
  await boundFixtureOracle(root, authority, catalog, engine(authority.engineId));
  for (const mutate of [
    (a) => {
      a.engineId = 'html-formatter';
    },
    (a) => {
      a.inputs[0].text += 'x';
    },
    (a) => {
      a.params.removeComments = false;
    },
    (a) => {
      a.artifactOracles.pop();
    },
    (a) => {
      a.artifactOracles.reverse();
    },
    (a) => {
      a.artifactOracles[0].mime = 'text/plain';
    },
    (a) => {
      a.artifactOracles[1].expected.bytesIn = 21;
    },
    (a) => {
      a.sourceCaseBinding.publicSymbol = 'minify';
    },
    (a) => {
      a.sourceCaseBinding.exactCaseBodySha256 = '0'.repeat(64);
    },
    (a) => {
      a.fixtureIndex = 0;
    },
  ]) {
    const changed = structuredClone(authority);
    mutate(changed);
    await assert.rejects(
      boundFixtureOracle(root, changed, catalog, engine(authority.engineId)),
      /Supplemental/,
    );
  }
  await assert.rejects(
    boundFixtureOracle(
      root,
      authority,
      { ...catalog, supplementalFixtureAuthorities: [...candidates, authority] },
      engine(authority.engineId),
    ),
    /Supplemental/,
  );
  const black = candidates.find((item) => item.key === 'supplemental-harmony-black');
  const red = candidates.find((item) => item.key === 'supplemental-harmony-red-partial');
  assert.equal(black.artifactOracles[0].kind, 'json-exact');
  assert.equal(red.artifactOracles[0].kind, 'json-fields');
  const falselyWholeRed = structuredClone(red);
  falselyWholeRed.artifactOracles[0].kind = 'json-exact';
  await assert.rejects(
    boundFixtureOracle(root, falselyWholeRed, catalog, engine(red.engineId)),
    /Supplemental/,
  );
  for (const field of ['sourceCaseCatalog', 'declaredFixtureCatalog']) {
    const changed = structuredClone(catalog);
    changed[field][0].status = 'substituted';
    await assert.rejects(
      boundFixtureOracle(root, authority, changed, engine(authority.engineId)),
      /historical902\/81/,
    );
  }
  assert.equal(
    sha(JSON.stringify(data.oracles.sourceCaseCatalog)),
    '4b8de77304d87a98fb4e99950d1a26eabaf20c7d5863682cedd643458abccf71',
  );
  assert.equal(
    sha(JSON.stringify(data.oracles.declaredFixtureCatalog)),
    '1341ca083c65d21af34b1189dfc670e67f60a5efa8c29bb3eed78a5be2d2a87e',
  );
});

test('supplemental receipt attribution describes each actual oracle without invented declaration/tolerance', async () => {
  const { protectedSupplementalFixtures, independentArtifactExpectation } = await checker();
  const candidates = await protectedSupplementalFixtures(root);
  const html = candidates.find((item) => item.key === 'supplemental-html-remove-comments');
  const artifacts = html.artifactOracles.map((oracle) => ({ mime: oracle.mime }));
  const receipt = independentArtifactExpectation(html, artifacts);
  assert.deepEqual(
    receipt.artifactChecks.map((item) => [
      item.index,
      item.actualMime,
      item.expectedMime,
      item.oracleKind,
    ]),
    [
      [0, 'text/html', 'text/html', 'text-exact'],
      [1, 'application/json', 'application/json', 'json-exact'],
    ],
  );
  assert(!receipt.check.includes('declared'));
  assert(!receipt.check.includes('tolerance'));
  assert(
    receipt.artifactChecks.every(
      (item) =>
        !Object.hasOwn(item, 'relativeTolerance') && !Object.hasOwn(item, 'absoluteTolerance'),
    ),
  );
  const red = candidates.find((item) => item.key === 'supplemental-harmony-red-partial');
  const partial = independentArtifactExpectation(red, [{ mime: 'application/json' }]);
  assert.match(partial.check, /Partial named JSON fields only/);
  assert.deepEqual(partial.artifactChecks[0].checkedFields, [
    '$.base',
    '$.schemes.complementary[0]',
    '$.schemes.complementary[1]',
  ]);
  assert.throws(
    () => independentArtifactExpectation(html, artifacts.slice(1)),
    /Complete artifact list/,
  );
});

test('supplemental source derivation refuses helper imports/runs and stale literal expectations', async () => {
  const { protectedSupplementalFixtures, boundFixtureOracle } = await checker();
  assert.equal(
    typeof protectedSupplementalFixtures,
    'function',
    'Actual supplemental source derivation is required.',
  );
  const candidates = await protectedSupplementalFixtures(root);
  const authority = candidates.find((item) => item.key === 'supplemental-html-remove-comments');
  const data = documents();
  const engine = data.mapping.rows
    .flatMap((row) => row.engines)
    .find((item) => item.id === authority.engineId);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-supplemental-source-'));
  try {
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    const relative = 'packages/core/test/catalog-fixture-completion.test.ts';
    const original = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const file of [
      'package.json',
      relative,
      'packages/core/src/index.ts',
      ...['roman-numeral', 'html-minify', 'css-minify', 'yaml-validate', 'color-harmony'].map(
        (id) => `packages/core/src/tools/${id}/index.ts`,
      ),
    ]) {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      fs.copyFileSync(path.join(root, file), path.join(dir, file));
    }
    for (const [before, after] of [
      ["from '../src/index.js'", "from '../src/tools/html-minify/index.js'"],
      ['htmlMinify.run(inputs, params, context())', 'htmlMinify.helper(inputs, params, context())'],
      [
        "it('supplemental roman-encode'",
        "htmlMinify.run = () => [];\nit('supplemental roman-encode'",
      ],
    ]) {
      assert(original.includes(before));
      fs.writeFileSync(path.join(dir, relative), original.replace(before, after));
      await assert.rejects(protectedSupplementalFixtures(dir), /Supplemental/);
    }
    for (const [before, after] of [
      ['bytesIn: 20,', 'bytesIn: 21,'],
      ["['<p>Hello</p><!--x-->']", "['<p>Changed</p>']"],
      ['removeComments: true,', 'removeComments: false,'],
    ]) {
      assert(original.includes(before));
      fs.writeFileSync(path.join(dir, relative), original.replace(before, after));
      await assert.rejects(
        boundFixtureOracle(
          dir,
          authority,
          { ...data.oracles, supplementalFixtureAuthorities: candidates },
          engine,
        ),
        /Supplemental/,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('all193 pending rows validate without pretending verification', async () => {
  const result = await validate(documents());
  assert.equal(result.rows, 193);
  assert.equal(result.engineReferences, 196);
  assert.equal(result.verifiedRows, 0);
});
test('planning numeric and record controls bind actual tool calls and the original absolute precision', async () => {
  const { protectedPlanningCaseCandidates, boundFixtureOracle } = await checker();
  const data = documents();
  const find = (id) =>
    data.mapping.rows.flatMap((row) => row.engines).find((item) => item.id === id);
  const engine = find('calorie-calculator');
  const candidates = await protectedPlanningCaseCandidates(root, data.oracles, engine);
  const candidate = candidates.find(
    (item) =>
      item.params.coefficient === 'female' && item.oracle.expected.restingKcalPerDay === 1482.75,
  );
  assert(candidate, 'Independent female resting-energy literal must be bound to its real run.');
  assert.equal(candidate.oracle.absoluteTolerance, 5e-9);
  const fixture = {
    key: 'test-protected-planning',
    engineId: engine.id,
    params: candidate.params,
    inputs: [],
    qualificationKind: 'additional exact protected planning vector',
    sourceCaseBinding: candidate.binding,
    authorityPins: [candidate.binding.sourcePin],
    artifactOracles: [{ ...candidate.oracle, authority: 'Protected planning test literal.' }],
  };
  await boundFixtureOracle(root, fixture, data.oracles, engine);
  fixture.artifactOracles[0].expected.restingKcalPerDay = 1482.76;
  await assert.rejects(
    boundFixtureOracle(root, fixture, data.oracles, engine),
    /planning.*authority/,
  );
  const meat = await protectedPlanningCaseCandidates(
    root,
    data.oracles,
    find('meat-cooking-time-calculator'),
  );
  assert(
    meat.some(
      (item) => item.oracle.expected.internalF === 145 && item.oracle.expected.restMinutes === 3,
    ),
  );
  assert(
    !meat.some((item) => item.oracle.expected.internalF === 165),
    'Helper-only cookingBand call cannot stand in for a module run.',
  );
});
test('absolute planning precision is not changed into relative error', async () => {
  const { checkArtifact } = await checker();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-planning-precision-'));
  try {
    const content = '{"amount":1000000.0000001}';
    fs.writeFileSync(path.join(dir, 'result.json'), content);
    const artifact = {
      path: 'result.json',
      bytes: Buffer.byteLength(content),
      sha256: sha(content),
    };
    await assert.rejects(
      checkArtifact(dir, artifact, {
        kind: 'json-fields',
        expected: { amount: 1000000 },
        absoluteTolerance: 5e-9,
        authority: 'Protected toBeCloseTo(expected, 8) control.',
      }),
      /oracle mismatch/,
    );
    const nearContent = '{"amount":1.0000000001}';
    fs.writeFileSync(path.join(dir, 'near.json'), nearContent);
    await checkArtifact(
      dir,
      { path: 'near.json', bytes: Buffer.byteLength(nearContent), sha256: sha(nearContent) },
      {
        kind: 'json-fields',
        expected: { amount: 1 },
        absoluteTolerance: 5e-9,
        authority: 'Protected toBeCloseTo(expected, 8) control.',
      },
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});
test('all four random-name public controls bind actual exported module IDs rather than helper-only pools', async () => {
  const { protectedNameModuleFixtures, boundFixtureOracle } = await checker();
  const data = documents();
  const fixtures = await protectedNameModuleFixtures(root, data.oracles);
  assert.deepEqual(
    fixtures.map((fixture) => fixture.engineId),
    ['podcast-name-generator', 'band-name-generator', 'clan-name-generator', 'dnd-name-generator'],
  );
  for (const fixture of fixtures) {
    const engine = data.mapping.rows
      .flatMap((row) => row.engines)
      .find((item) => item.id === fixture.engineId);
    const selections = structuredClone(engine.oracle.selectedSourceCaseIndexes);
    await boundFixtureOracle(root, fixture, data.oracles, engine);
    assert.deepEqual(engine.oracle.selectedSourceCaseIndexes, selections);
  }
  const wrongTool = structuredClone(fixtures[0]);
  wrongTool.engineId = 'dice-roller';
  await assert.rejects(
    boundFixtureOracle(
      root,
      wrongTool,
      data.oracles,
      data.mapping.rows.flatMap((row) => row.engines).find((item) => item.id === 'dice-roller'),
    ),
    /names.*authority/,
  );
  const helperOnly = structuredClone(fixtures[2]);
  helperOnly.sourceCaseBinding.sourceCaseIndex = 49;
  await assert.rejects(
    boundFixtureOracle(
      root,
      helperOnly,
      data.oracles,
      data.mapping.rows
        .flatMap((row) => row.engines)
        .find((item) => item.id === 'clan-name-generator'),
    ),
    /names.*authority/,
  );
});
test('release refuses pending rows even when their metadata is valid', async () => {
  await assert.rejects(validate(documents(), { requireVerified: true }), /pending|unresolved/);
});
test('populated unknown IDs are refused even while pending', async () => {
  const data = documents();
  data.mapping.rows[0].engineIds[0] = 'invented-engine';
  await assert.rejects(validate(data), /canonical|engine/);
});
test('immutable193 classification and row identity cannot be substituted', async () => {
  const data = documents();
  data.mapping.rows[0].rowNumber = 2;
  await assert.rejects(validate(data), /row|duplicate/);
});
test('Markdown-only367 cannot be credited to a word counter', async () => {
  const data = documents();
  const engine = data.mapping.rows[0].engines[0];
  engine.oracle.selectedSourceCaseIndexes.push(367);
  engine.oracle.qualification.currentSourceCaseIndexes.push(367);
  await assert.rejects(validate(data), /367|selection/);
});
test('timer cases retain43and44 but refuse seating-only45', async () => {
  const data = documents();
  const engine = data.mapping.rows[164].engines[0];
  assert.deepEqual(engine.oracle.selectedSourceCaseIndexes, [43, 44]);
  engine.oracle.selectedSourceCaseIndexes.push(45);
  engine.oracle.qualification.currentSourceCaseIndexes.push(45);
  await assert.rejects(validate(data), /timer|selection/);
});
test('qualification duplicates must mirror actual selected cases', async () => {
  const data = documents();
  data.mapping.rows[0].engines[0].oracle.qualification.currentSourceCaseIndexes.push(367);
  await assert.rejects(validate(data), /qualification|selection/);
});
test('stale source pins refuse verification rather than silently refreshing', async () => {
  const data = documents();
  data.mapping.rows[0].engines[0].sourceBinding.pins[0].sha256 = '0'.repeat(64);
  await assert.rejects(validate(data), /stale|hash/);
});
test('a verified scalar cannot omit its full artifact or integrated source acceptance', async () => {
  const data = documents();
  data.mapping.rows[0].status = 'verified';
  data.mapping.rows[0].engines[0].status = 'verified';
  data.mapping.rows[0].engines[0].verification = { cases: [] };
  await assert.rejects(validate(data), /artifact|cases|SOURCE|gate/);
});
test('historical gate names cannot replace the actual owner gate resolver', async () => {
  const data = documents();
  data.mapping.rows[0].engines[0].requiredGateIds = ['invented-live-manual-gate'];
  await assert.rejects(validate(data), /gate/);
});
test('self-declared branch coverage cannot omit actual enum, selected case or runtime branches', async () => {
  const { requiredBranchKeys } = await checker();
  const branches = requiredBranchKeys(
    { surfaces: ['cli'], paramSchema: { language: { options: [{ value: 'json' }] } } },
    { oracle: { selectedSourceCaseIndexes: [7], expectedFixtureIndexes: [0] } },
  );
  assert.deepEqual(branches, [
    'adapter:cli:typed-params',
    'canonical-known-answer',
    'declared-fixture:0',
    'packed:cjs:current',
    'packed:cjs:node22.13',
    'packed:esm:current',
    'packed:esm:node22.13',
    'parameter:language="json"',
    'source-case:7',
  ]);
});
test('altered expected JSON cannot replace its protected independent literal fixture', async () => {
  const { boundFixtureOracle } = await checker();
  const data = documents();
  const fixture = data.oracles.executableFixtures[0];
  const engine = data.mapping.rows
    .flatMap((row) => row.engines)
    .find((item) => item.id === fixture.engineId);
  await boundFixtureOracle(root, fixture, data.oracles, engine);
  fixture.artifactOracles[0].expected.scheduledPayment = 999;
  await assert.rejects(
    boundFixtureOracle(root, fixture, data.oracles, engine),
    /protected independent literal/,
  );
});
test('full artifacts use independent expected values, never MIME or size alone', async () => {
  const { checkArtifact } = await checker();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-oracle-'));
  try {
    fs.writeFileSync(path.join(dir, 'result.json'), '{"answer":42,"other":"retained"}');
    const artifact = {
      path: 'result.json',
      bytes: 32,
      sha256: sha(fs.readFileSync(path.join(dir, 'result.json'))),
    };
    artifact.bytes = fs.statSync(path.join(dir, artifact.path)).size;
    await checkArtifact(dir, artifact, {
      kind: 'json-fields',
      expected: { answer: 42 },
      authority: 'independent literal test control',
    });
    await assert.rejects(
      checkArtifact(dir, artifact, {
        kind: 'json-fields',
        expected: { answer: 41 },
        authority: 'independent literal test control',
      }),
      /answer/,
    );
    await assert.rejects(
      checkArtifact(dir, artifact, { kind: 'mime', expected: 'application/json' }),
      /oracle/,
    );
    await assert.rejects(
      checkArtifact(
        dir,
        { ...artifact, path: '../result.json' },
        { kind: 'json-fields', expected: { answer: 42 } },
      ),
      /path/,
    );
    await assert.rejects(
      checkArtifact(
        dir,
        { ...artifact, bytes: 0 },
        { kind: 'json-fields', expected: { answer: 42 } },
      ),
      /empty|bytes/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('a protected expected-empty control still requires the exact full artifact and source assertion', async () => {
  const { checkArtifact } = await checker();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-empty-oracle-'));
  const source = 'packages/core/test/utilities/text-developer.test.ts';
  const sourceBytes = fs.readFileSync(path.join(root, source));
  const assertionExpression =
    "expect(await output('remove-duplicate-lines-online', {}, '')).toBe('')";
  try {
    fs.mkdirSync(path.dirname(path.join(dir, source)), { recursive: true });
    fs.writeFileSync(path.join(dir, source), sourceBytes);
    fs.writeFileSync(path.join(dir, 'empty.txt'), '');
    const artifact = { path: 'empty.txt', bytes: 0, sha256: sha('') };
    const oracle = {
      kind: 'text-exact',
      expected: '',
      authority: 'Actual protected empty duplicate-lines output assertion',
      expectedEmptyControl: {
        engineId: 'remove-duplicate-lines-online',
        inputText: '',
        params: {},
        assertionExpression,
        sourcePin: { path: source, bytes: sourceBytes.length, sha256: sha(sourceBytes) },
      },
    };
    await checkArtifact(dir, artifact, oracle);
    await assert.rejects(
      checkArtifact(dir, artifact, { ...oracle, expectedEmptyControl: undefined }),
      /empty/,
    );
    await assert.rejects(checkArtifact(dir, { ...artifact, path: 'absent.txt' }, oracle), /ENOENT/);
    await assert.rejects(
      checkArtifact(dir, { ...artifact, sha256: '0'.repeat(64) }, oracle),
      /Stale/,
    );
    await assert.rejects(
      checkArtifact(dir, artifact, {
        ...oracle,
        expectedEmptyControl: { ...oracle.expectedEmptyControl, engineId: 'word-counter' },
      }),
      /engine|literal/,
    );
    await assert.rejects(
      checkArtifact(dir, artifact, {
        ...oracle,
        expectedEmptyControl: {
          ...oracle.expectedEmptyControl,
          assertionExpression:
            "expect(await output('remove-duplicate-lines-online', {}, 'not an original control')).toBe('')",
        },
      }),
      /source|assertion/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('empty negative controls cannot replace a meaningful nonempty canonical positive', async () => {
  const { requireNonemptyCanonicalCase } = await checker();
  assert.throws(
    () =>
      requireNonemptyCanonicalCase([
        { coveredBranches: ['canonical-known-answer'], artifacts: [{ bytes: 0 }] },
      ]),
    /nonempty canonical/,
  );
  assert.throws(
    () =>
      requireNonemptyCanonicalCase([
        { coveredBranches: ['empty-input'], artifacts: [{ bytes: 0 }] },
        { coveredBranches: ['other-branch'], artifacts: [{ bytes: 4 }] },
      ]),
    /nonempty canonical/,
  );
  requireNonemptyCanonicalCase([
    { coveredBranches: ['empty-input'], artifacts: [{ bytes: 0 }] },
    { coveredBranches: ['canonical-known-answer'], artifacts: [{ bytes: 4 }] },
  ]);
});

test('the empty control and nonempty canonical companion bind the same actual selected tool-output case', async () => {
  const { boundFixtureOracle } = await checker();
  const data = documents();
  const engine = data.mapping.rows
    .flatMap((row) => row.engines)
    .find((item) => item.id === 'remove-duplicate-lines-online');
  for (const key of ['duplicate-lines-empty', 'duplicate-lines-canonical']) {
    const fixture = data.oracles.executableFixtures.find((item) => item.key === key);
    assert(fixture);
    await boundFixtureOracle(root, fixture, data.oracles, engine);
    const altered = globalThis.structuredClone(fixture);
    altered.params = { trim: true };
    await assert.rejects(boundFixtureOracle(root, altered, data.oracles, engine), /deep-equal/);
    const unselected = globalThis.structuredClone(engine);
    unselected.oracle.selectedSourceCaseIndexes = [];
    await assert.rejects(
      boundFixtureOracle(root, fixture, data.oracles, unselected),
      /selected source case/,
    );
  }
});

test('all nineteen additional text vectors bind their protected actual case inputs and expected values', async () => {
  const { boundFixtureOracle } = await checker();
  const data = documents();
  const fixtures = data.oracles.executableFixtures.filter(
    (item) => item.qualificationKind === 'additional exact protected text vector',
  );
  assert.equal(fixtures.length, 19);
  for (const fixture of fixtures) {
    const engine = data.mapping.rows
      .flatMap((row) => row.engines)
      .find((item) => item.id === fixture.engineId);
    await boundFixtureOracle(root, fixture, data.oracles, engine);
    const altered = globalThis.structuredClone(fixture);
    altered.params.unrelated = true;
    await assert.rejects(
      boundFixtureOracle(root, altered, data.oracles, engine),
      /protected source|case input/,
    );
    const wrongExpected = globalThis.structuredClone(fixture);
    wrongExpected.artifactOracles[0].expected = 'invented';
    await assert.rejects(
      boundFixtureOracle(root, wrongExpected, data.oracles, engine),
      /protected source|expected/,
    );
  }
});

test('all six web-only controls bind their actual original inputs and full source/property authority', async () => {
  const { boundFixtureOracle } = await checker();
  const data = documents();
  const fixtures = data.oracles.executableFixtures.filter((item) => item.surface === 'web');
  assert.equal(fixtures.length, 6);
  for (const fixture of fixtures) {
    const engine = data.mapping.rows
      .flatMap((row) => row.engines)
      .find((item) => item.id === fixture.engineId);
    await boundFixtureOracle(root, fixture, data.oracles, engine);
    const wrong = globalThis.structuredClone(fixture);
    wrong.artifactOracles[0].authority = 'MIME/size substitute';
    await assert.rejects(boundFixtureOracle(root, wrong, data.oracles, engine), /Browser fixture/);
  }
});

test('an independent artifact checker refuses the producer owner before writing receipts', async () => {
  const { checkArtifactRun } = await checker();
  const tempRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-owner-refusal-')),
  );
  const directory = 'docs/catalog-artifacts/unit-owner-refusal';
  const runDirectory = path.join(tempRoot, directory);
  try {
    fs.mkdirSync(path.join(tempRoot, 'docs'));
    for (const name of ['MAPPING', 'ORACLES', 'SOURCE-GATES']) {
      const relative = `docs/CATALOG-INTEGRATION-${name}.json`;
      fs.copyFileSync(
        path.join(root, relative),
        path.join(tempRoot, relative),
        fs.constants.COPYFILE_EXCL,
      );
    }
    fs.mkdirSync(runDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(runDirectory, 'producer-unit-control.json'),
      JSON.stringify({
        owner: 'catalog_gap_inventory',
        qualification: 'UNIT_ONLY incomplete fixture for same-owner refusal; not producer proof',
      }),
      { flag: 'wx' },
    );
    await assert.rejects(
      checkArtifactRun({
        root: tempRoot,
        directory,
        owner: 'catalog_gap_inventory',
      }),
      /ownership must differ/,
    );
    assert.deepEqual(fs.readdirSync(runDirectory), ['producer-unit-control.json']);
    assert.equal(fs.existsSync(path.join(runDirectory, 'checker-catalog_gap_inventory')), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true });
  }
});

const groupA31Ids = [
  'number-to-words-converter', 'chmod-calculator', 'cron-from-text', 'utm-link-builder',
  'px-to-rem-converter', 'ip-subnet-calc', 'unit-converter', 'case-converter', 'slug',
  'markdown-table-generator', 'bulk-meta-description-generator', 'javascript-minifier',
  'url-encoder', 'timestamp-converter', 'jwt-decoder', 'css-formatter', 'xml-formatter',
  'text-escape', 'json-yaml', 'base64', 'csv-json', 'robots-txt-generator',
  'csp-header-generator', 'hreflang-tag-generator', 'nginx-redirect-generator',
  'color-converter', 'css-gradient-generator', 'compound-interest', 'percentage-calculator',
  'date-calculator', 'csv-viewer',
];
const groupA31CSVFields = [
  'testPath', 'caseName', 'importSpecifier', 'importedName', 'localName', 'runReceiver',
  'engineId', 'publicSourceExport', 'defaultRegistryMembership', 'moduleDelegation',
  'platformImport', 'nodeAdapterRecipe', 'nodeWorkerEntry', 'sourcePins',
];
const groupA31CSVPaths = [
  'packages/core/test/catalog-fixture-group-a31.test.ts',
  'tools/test/catalog-packaged-workers.test.mjs',
  'packages/core/src/index.ts', 'packages/core/src/default-registry.ts',
  'packages/core/src/registry.ts', 'packages/core/src/utilities/files.ts',
  'packages/core/src/utilities/csv-data.ts', 'packages/core/src/utilities/common.ts',
  'packages/core/src/utilities/file-job.ts', 'packages/core/src/utilities/file-job-platform.ts',
  'packages/core/src/utilities/file-job-node.ts', 'packages/core/src/utilities/file-worker-node.ts',
  'packages/core/src/utilities/file-worker.ts', 'packages/core/tsup.config.ts',
  'packages/core/package.json',
];

async function withGroupA31SourceCopy(authorities, action) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-a31-source-')));
  try {
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    const paths = new Set(['package.json', ...authorities.flatMap((row) => row.authorityPins.map((pin) => pin.path))]);
    for (const relative of paths) {
      fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
      fs.copyFileSync(path.join(root, relative), path.join(directory, relative), fs.constants.COPYFILE_EXCL);
    }
    await action(directory);
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
}

test('group A31 derives exactly31 public authorities while preserving902/81/191 and the closed CSV tuple', async () => {
  const { protectedGroupA31Fixtures } = await checker();
  const data = documents();
  const candidates = await protectedGroupA31Fixtures(root, data.oracles);
  assert.deepEqual(candidates.map((row) => row.engineId), groupA31Ids);
  assert.deepEqual(candidates, data.oracles.groupA31FixtureAuthorities);
  assert.deepEqual(data.oracles.executableFixtures.slice(191, 222), candidates);
  assert.equal(data.oracles.sourceCaseCatalog.length, 902);
  assert.equal(data.oracles.declaredFixtureCatalog.length, 81);
  assert.equal(sha(JSON.stringify(data.oracles.sourceCaseCatalog)), '4b8de77304d87a98fb4e99950d1a26eabaf20c7d5863682cedd643458abccf71');
  assert.equal(sha(JSON.stringify(data.oracles.declaredFixtureCatalog)), '1341ca083c65d21af34b1189dfc670e67f60a5efa8c29bb3eed78a5be2d2a87e');
  assert.equal(sha(JSON.stringify(data.oracles.executableFixtures.slice(0, 181))), '2486316ec7eaa544fec64ad64c13797b190320d5a7e9c3899a7644e96e43765f');
  assert.deepEqual(data.oracles.executableFixtures.slice(181, 191), data.oracles.supplementalFixtureAuthorities);
  const csv = candidates[30];
  assert.deepEqual(Object.keys(csv.csvNodeImportBinding), groupA31CSVFields);
  assert.deepEqual(csv.csvNodeImportBinding.sourcePins.map((pin) => pin.path), groupA31CSVPaths);
  assert.equal(csv.csvNodeImportBinding.importSpecifier, '../dist/node/index.js');
  assert.equal(csv.csvNodeImportBinding.importedName, 'csvViewer');
  assert.equal(csv.csvNodeImportBinding.localName, 'csvViewer');
  assert.equal(csv.csvNodeImportBinding.runReceiver, 'csvViewer');
  assert(candidates.slice(0, 30).every((row) => !Object.hasOwn(row, 'csvNodeImportBinding')));
  for (const row of candidates) {
    assert.equal(row.qualificationKind, 'group A31 source-bound fixture');
    assert.equal(row.usesPinnedDefaults, false);
    assert.equal(row.artifactOracles.length, 1);
  }
});

test('group A31 complete records reject substituted values, lost history and every CSV tuple field mutation', async () => {
  const { boundFixtureOracle } = await checker();
  const data = documents(), catalog = data.oracles;
  const rows = catalog.groupA31FixtureAuthorities;
  const engine = (row) => data.mapping.rows.flatMap((item) => item.engines).find((item) => item.id === row.engineId);
  for (const row of rows) {
    await boundFixtureOracle(root, row, catalog, engine(row));
    for (const mutate of [
      (value) => { value.key += '-substituted'; },
      (value) => { value.engineId = 'wrong-engine'; },
      (value) => { value.inputs = [{ name: 'unselected.txt', mime: 'text/plain', text: 'unselected' }]; },
      (value) => { value.params.unselected = true; },
      (value) => { value.artifactOracles[0].expected = 'invented'; },
      (value) => { value.artifactOracles[0].mime = 'unselected/mime'; },
      (value) => { value.artifactOracles = []; },
      (value) => { value.authorityPins[0].sha256 = '0'.repeat(64); },
      (value) => { value.sourceCaseBinding.publicSymbol = 'privateHelper'; },
    ]) {
      const wrong = structuredClone(row); mutate(wrong);
      await assert.rejects(boundFixtureOracle(root, wrong, catalog, engine(row)), /Group A31/);
    }
  }
  const csv = rows[30];
  for (const field of groupA31CSVFields) {
    for (const mutate of [
      (value) => { delete value.csvNodeImportBinding[field]; },
      (value) => { value.csvNodeImportBinding[field] = null; },
    ]) {
      const wrong = structuredClone(csv); mutate(wrong);
      await assert.rejects(boundFixtureOracle(root, wrong, catalog, engine(csv)), /Group A31/);
    }
  }
  for (const mutate of [
    (value) => { value.csvNodeImportBinding.extra = 'unreviewed'; },
    (value) => { value.csvNodeImportBinding.sourcePins.pop(); },
    (value) => { value.csvNodeImportBinding.sourcePins.reverse(); },
    (value) => { value.csvNodeImportBinding.sourcePins[0].bytes++; },
    (value) => { value.csvNodeImportBinding.sourcePins[0].sha256 = '0'.repeat(64); },
    (value) => { value.csvNodeImportBinding.sourcePins[0].path = 'packages/core/dist/node/index.js'; },
  ]) {
    const wrong = structuredClone(csv); mutate(wrong);
    await assert.rejects(boundFixtureOracle(root, wrong, catalog, engine(csv)), /Group A31/);
  }
  for (const mutate of [
    (value) => { value.groupA31FixtureAuthorities.pop(); },
    (value) => { value.groupA31FixtureAuthorities.push(value.groupA31FixtureAuthorities[0]); },
    (value) => { value.executableFixtures[0].key += '-changed'; },
    (value) => { value.sourceCaseCatalog[0].status = 'changed'; },
    (value) => { value.declaredFixtureCatalog[0].status = 'changed'; },
    (value) => { value.executableFixtures[191].csvNodeImportBinding = structuredClone(csv.csvNodeImportBinding); },
  ]) {
    const wrong = structuredClone(catalog); mutate(wrong);
    await assert.rejects(boundFixtureOracle(root, rows[0], wrong, engine(rows[0])), /Group A31/);
  }
});

test('group A31 source recognizer rejects import aliases, shadows, helpers and changed literal observations', async () => {
  const { protectedGroupA31Fixtures } = await checker();
  const catalog = documents().oracles, authorities = catalog.groupA31FixtureAuthorities;
  await withGroupA31SourceCopy(authorities, async (directory) => {
    assert.equal((await protectedGroupA31Fixtures(directory, catalog)).length, 31);
    const relative = 'packages/core/test/catalog-fixture-group-a31.test.ts';
    const file = path.join(directory, relative), original = fs.readFileSync(file, 'utf8');
    for (const [before, after] of [
      ["import { expect, it } from 'vitest';", "import {} from 'node:os';\nimport { expect, it } from 'vitest';"],
      ["import { expect, it } from 'vitest';", "import {} from 'vitest';\nimport { expect, it } from 'vitest';"],
      ["import { csvViewer } from '../dist/node/index.js';", "import { csvViewer } from '../src/index.js';"],
      ["import { csvViewer } from '../dist/node/index.js';", "import { csvViewer } from '../dist/index.js';"],
      ['import { csvViewer }', 'import { csvViewer as renamed }'],
      ['import { csvViewer }', 'import * as csvViewer'],
      ['import { csvViewer }', 'import { csvViewer, csvViewer }'],
      ['const context =', 'const csvViewer = {};\nconst context ='],
      ['await csvViewer.run(inputs, params, context())', 'await csvViewer.helper(inputs, params, context())'],
      ['await csvViewer.run(inputs, params, context())', 'await privateCSV.run(inputs, params, context())'],
      ["new File(['Hello World']", "new File(['Changed World']"],
      ["const params = { numberText: '0' };", "const params = { numberText: '1' };"],
      ['expect(outputs).toHaveLength(1);', 'expect(outputs).toHaveLength(2);'],
      ["expect(outputs[0]!.type).toBe('text/csv');", "expect(outputs[0]!.type).toBe('text/plain');"],
      ["toMatchObject({ words: 'zero' })", "toMatchObject({ words: 'one' })"],
      ["return matches[0]!;", "return matches[1]!;"],
      ["onProgress() {},", "onProgress() { throw new Error('side effect'); },"],
    ]) {
      assert(original.includes(before), before);
      fs.writeFileSync(file, original.replace(before, after));
      await assert.rejects(protectedGroupA31Fixtures(directory, catalog), /Group A31/);
      fs.writeFileSync(file, original);
    }
  });
});

test('group A31 type-only runtime imports and public registry edges are refused', async () => {
  const { protectedGroupA31Fixtures } = await checker();
  const catalog = documents().oracles;
  await withGroupA31SourceCopy(catalog.groupA31FixtureAuthorities, async (directory) => {
    assert.equal((await protectedGroupA31Fixtures(directory, catalog)).length, 31);
    const accepted = [];
    for (const [relative, before, after] of [
      ['packages/core/test/catalog-fixture-group-a31.test.ts', "import { csvViewer } from '../dist/node/index.js';", "import type { csvViewer } from '../dist/node/index.js';"],
      ['packages/core/test/catalog-fixture-group-a31.test.ts', "import { csvViewer } from '../dist/node/index.js';", "import { type csvViewer } from '../dist/node/index.js';"],
      ['packages/core/test/catalog-fixture-group-a31.test.ts', "import { expect, it } from 'vitest';", "import type { expect, it } from 'vitest';"],
      ['packages/core/src/index.ts', "export { csvViewer, psdToPng } from './utilities/files.js';", "export type { csvViewer, psdToPng } from './utilities/files.js';"],
      ['packages/core/src/index.ts', "export { csvViewer, psdToPng } from './utilities/files.js';", "export { type csvViewer, psdToPng } from './utilities/files.js';"],
      ['packages/core/src/default-registry.ts', "import { psdToPng, csvViewer } from './utilities/files.js';", "import type { psdToPng, csvViewer } from './utilities/files.js';"],
      ['packages/core/src/default-registry.ts', "import { psdToPng, csvViewer } from './utilities/files.js';", "import { psdToPng, type csvViewer } from './utilities/files.js';"],
    ]) {
      const file = path.join(directory, relative), original = fs.readFileSync(file, 'utf8');
      assert.equal(original.split(before).length, 2, before);
      try {
        fs.writeFileSync(file, original.replace(before, after));
        try {
          await protectedGroupA31Fixtures(directory, catalog);
          accepted.push(after);
        } catch (error) {
          assert.match(error.message, /Group A31/);
        }
      } finally {
        fs.writeFileSync(file, original);
      }
    }
    assert.deepEqual(accepted, []);
  });
});

test('group A31 closed CSV source recipe rejects wrong module ID, registry, worker and mandatory source pins', async () => {
  const { boundFixtureOracle } = await checker();
  const data = documents(), csv = data.oracles.groupA31FixtureAuthorities[30];
  const engine = data.mapping.rows.flatMap((row) => row.engines).find((row) => row.id === 'csv-viewer');
  await withGroupA31SourceCopy(data.oracles.groupA31FixtureAuthorities, async (directory) => {
    for (const [relative, before, after] of [
      ['packages/core/src/utilities/files.ts', "id: 'csv-viewer'", "id: 'different-csv'"],
      ['packages/core/src/default-registry.ts', '\n  csvViewer,', '\n  csvViewer,\n  csvViewer,'],
      ['packages/core/src/index.ts', "export { csvViewer, psdToPng } from './utilities/files.js';", "export { csvViewer as privateCSV, psdToPng } from './utilities/files.js';"],
      ['packages/core/tsup.config.ts', "'file-worker': 'src/utilities/file-worker-node.ts'", "'file-worker': 'src/utilities/file-worker-browser.ts'"],
      ['packages/core/tsup.config.ts', "new URL('./src/utilities/file-job-node.ts', import.meta.url)", "new URL('./src/utilities/file-job-platform.ts', import.meta.url)"],
      ['packages/core/src/utilities/file-job-node.ts', "new URL('./file-worker.js', import.meta.url)", "new URL('./different-worker.js', import.meta.url)"],
      ['packages/core/src/utilities/file-worker-node.ts', "'node:worker_threads'", "'node:events'"],
    ]) {
      const file = path.join(directory, relative), original = fs.readFileSync(file, 'utf8');
      assert(original.includes(before), `${relative}: ${before}`);
      fs.writeFileSync(file, original.replace(before, after));
      await assert.rejects(boundFixtureOracle(directory, csv, data.oracles, engine), /Group A31/);
      fs.writeFileSync(file, original);
    }
    const required = path.join(directory, 'packages/core/src/utilities/file-worker.ts');
    const bytes = fs.readFileSync(required);
    fs.unlinkSync(required);
    await assert.rejects(boundFixtureOracle(directory, csv, data.oracles, engine), /ENOENT/);
    fs.writeFileSync(required, bytes);
  });
});

test('group A31 artifact checks retain strict independent text/JSON predicates, count, MIME and receipt attribution', async () => {
  const { checkFixtureArtifacts, independentArtifactExpectation } = await checker();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-a31-artifact-'));
  try {
    const authority = (kind, mime, expected) => ({ qualificationKind: 'group A31 source-bound fixture', artifactOracles: [{ kind, mime, expected, authority: 'Frozen original A31 literal, not an observed product value.' }] });
    const vectors = [
      [authority('text-exact', 'text/plain', 'HELLO WORLD'), 'HELLO WORLD', 'hello world'],
      [authority('text-exact', 'text/csv', 'name,count\r\n"two, commas",2\r\n"line\ninside",03\r\n'), 'name,count\r\n"two, commas",2\r\n"line\ninside",03\r\n', 'name,count\n"two, commas",2\n"line\ninside",03\n'],
      [authority('json-exact', 'application/json', { octal: '0644', symbolic: 'rw-r--r--', command: "chmod 0644 -- 'data.txt'" }), JSON.stringify({ octal: '0644', symbolic: 'rw-r--r--', command: "chmod 0644 -- 'data.txt'" }), JSON.stringify({ octal: '0644', symbolic: 'rw-r--r--', command: "chmod 0644 -- 'data.txt'", extra: true })],
      [authority('json-fields', 'application/json', { finalBalance: 2354.05 }), '{"finalBalance":2354.05,"unobserved":true}', '{"finalBalance":2354.0500001}'],
      [authority('json-fields', 'application/json', { valid: true, result: 40 }), '{"valid":true,"result":40}', '{"valid":true,"result":40.0000001}'],
      [authority('json-fields', 'application/json', { words: 'zero' }), '{"words":"zero"}', '{"words":"one"}'],
    ];
    for (const [record, good, bad] of vectors) {
      const relative = 'artifact', file = path.join(directory, relative);
      const artifact = (text) => { const bytes = Buffer.from(text); fs.writeFileSync(file, bytes); return { path: relative, bytes: bytes.length, sha256: sha(bytes), mime: record.artifactOracles[0].mime }; };
      const actual = artifact(good);
      await checkFixtureArtifacts(directory, [actual], record);
      await assert.rejects(checkFixtureArtifacts(directory, [], record), /artifact list/);
      await assert.rejects(checkFixtureArtifacts(directory, [actual, actual], record), /artifact list/);
      await assert.rejects(checkFixtureArtifacts(directory, [{ ...actual, mime: 'wrong/mime' }], record), /MIME/);
      await assert.rejects(checkFixtureArtifacts(directory, [artifact(bad)], record));
      const receipt = independentArtifactExpectation(record, [actual]);
      assert.equal(receipt.artifactChecks[0].authorityKind, 'group A31 source-bound fixture');
      assert.equal(receipt.artifactChecks[0].expectedMime, record.artifactOracles[0].mime);
      assert.equal(receipt.artifactChecks[0].oracleKind, record.artifactOracles[0].kind);
      assert(!Object.hasOwn(receipt.artifactChecks[0], 'relativeTolerance'));
      assert(!Object.hasOwn(receipt.artifactChecks[0], 'absoluteTolerance'));
      if (record.artifactOracles[0].kind === 'json-fields') assert.match(receipt.check, /Partial named JSON fields only/);
      const falselyAttributed = structuredClone(receipt); falselyAttributed.artifactChecks[0].oracleKind = 'bytes-exact';
      assert.notDeepEqual(falselyAttributed, receipt);
    }
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('group BC strict230 derives its own eight authorities before actual A31 qualification', async () => {
  const { protectedGroupBCFixtures, boundFixtureOracle } = await checker();
  const data = documents(), catalog = data.oracles;
  const candidates = await protectedGroupBCFixtures(root, catalog);
  assert.deepEqual(candidates.map((row) => row.engineId), [
    'aspect-ratio-calculator', 'tv-viewing-distance-calculator', 'random-number-generator',
    'dice-roller', 'coin-flip', 'lorem-ipsum', 'password-generator', 'uuid-generator',
  ]);
  assert.deepEqual(candidates, catalog.groupBCFixtureAuthorities);
  assert.equal(catalog.sourceCaseCatalog.length, 902);
  assert.equal(catalog.declaredFixtureCatalog.length, 81);
  assert.equal(sha(JSON.stringify(catalog.sourceCaseCatalog)), '4b8de77304d87a98fb4e99950d1a26eabaf20c7d5863682cedd643458abccf71');
  assert.equal(sha(JSON.stringify(catalog.declaredFixtureCatalog)), '1341ca083c65d21af34b1189dfc670e67f60a5efa8c29bb3eed78a5be2d2a87e');
  assert.equal(sha(JSON.stringify(catalog.executableFixtures.slice(0, 181))), '2486316ec7eaa544fec64ad64c13797b190320d5a7e9c3899a7644e96e43765f');
  assert.equal(catalog.supplementalFixtureAuthorities.length, 10);
  assert.equal(catalog.groupA31FixtureAuthorities.length, 31);
  assert.equal(catalog.executableFixtures.length, 230);
  assert.deepEqual(catalog.executableFixtures, [
    ...catalog.executableFixtures.slice(0, 181), ...catalog.supplementalFixtureAuthorities,
    ...catalog.groupA31FixtureAuthorities, ...candidates,
  ]);
  assert.equal(new Set(catalog.executableFixtures.map((row) => row.key)).size, 230);
  for (const row of candidates) {
    assert.equal(row.qualificationKind, 'group B2 C6 source-bound fixture');
    assert.equal(row.usesPinnedDefaults, false);
    assert.deepEqual(row.inputs, []);
    assert.equal(row.artifactOracles.length, 1);
    assert.equal(row.sourceCaseBinding.method, 'run');
    assert(row.sourceCaseBinding.selectedAssertions.length > 0);
  }
  const authority = catalog.groupA31FixtureAuthorities[0];
  const engine = data.mapping.rows.flatMap((row) => row.engines).find((row) => row.id === authority.engineId);
  assert(engine);
  await boundFixtureOracle(root, authority, catalog, engine);
  for (const row of candidates) {
    const bcEngine = data.mapping.rows.flatMap((item) => item.engines).find((item) => item.id === row.engineId);
    assert(bcEngine);
    await boundFixtureOracle(root, row, catalog, bcEngine);
  }
});

test('group BC strict230 layout mutations fail both source-family routes and paired substitutions fail their owner', async () => {
  const { boundFixtureOracle } = await checker();
  const data = documents(), catalog = data.oracles;
  const a31 = catalog.groupA31FixtureAuthorities[0], bc = catalog.groupBCFixtureAuthorities[0];
  const engine = (row) => data.mapping.rows.flatMap((item) => item.engines).find((item) => item.id === row.engineId);
  const mutations = [];
  for (const [field, start, count] of [['groupA31FixtureAuthorities', 191, 31], ['groupBCFixtureAuthorities', 222, 8]]) {
    mutations.push(
      (value) => { value.executableFixtures.splice(start, 1); },
      (value) => { value.executableFixtures.splice(start, 0, structuredClone(value.executableFixtures[start])); },
      (value) => { value.executableFixtures.splice(start + count, 0, { key: 'foreign-extra', qualificationKind: 'foreign' }); },
      (value) => { delete value[field]; },
      (value) => { value[field] = null; },
      (value) => { value[field] = []; },
      (value) => { value[field].pop(); },
      (value) => { value[field].push(structuredClone(value[field][0])); },
      (value) => { value[field].reverse(); },
      (value) => { [value.executableFixtures[start], value.executableFixtures[start + 1]] = [value.executableFixtures[start + 1], value.executableFixtures[start]]; },
      (value) => { value[field][0].key = 'unknown-key'; value.executableFixtures[start].key = 'unknown-key'; },
      (value) => { value[field][0].qualificationKind = 'foreign'; value.executableFixtures[start].qualificationKind = 'foreign'; },
    );
  }
  mutations.push(
    (value) => { delete value.groupBCFixtureAuthorities; value.executableFixtures.splice(222, 8); },
    (value) => { delete value.groupA31FixtureAuthorities; value.executableFixtures.splice(191, 31); },
    (value) => { value.executableFixtures = [...value.executableFixtures.slice(0, 191), ...value.executableFixtures.slice(222), ...value.executableFixtures.slice(191, 222)]; },
    (value) => { value.groupBCFixtureAuthorities[0].key = a31.key; value.executableFixtures[222].key = a31.key; },
    (value) => { value.executableFixtures[0].key += '-changed'; },
    (value) => { value.supplementalFixtureAuthorities[0].key = 'unknown-supplemental'; value.executableFixtures[181].key = 'unknown-supplemental'; },
  );
  for (const mutate of mutations) {
    const wrong = structuredClone(catalog); mutate(wrong);
    await assert.rejects(boundFixtureOracle(root, a31, wrong, engine(a31)), /Group A31/);
    await assert.rejects(boundFixtureOracle(root, bc, wrong, engine(bc)), /Group BC/);
  }
  for (const [field, start, row] of [['groupA31FixtureAuthorities', 191, a31], ['groupBCFixtureAuthorities', 222, bc]]) {
    for (const mutate of [
      (value) => { value.params.invented = true; },
      (value) => { value.artifactOracles[0].kind = 'bytes-exact'; },
      (value) => { value.artifactOracles[0].mime = 'wrong/mime'; },
      (value) => { value.artifactOracles[0].expected = 'producer answer'; },
      (value) => { value.sourceCaseBinding.sourceCaseIndex = 0; },
      (value) => { value.sourceCaseBinding.method = 'privateHelper'; },
      (value) => { value.authorityPins[0].sha256 = '0'.repeat(64); },
    ]) {
      const wrong = structuredClone(catalog); mutate(wrong[field][0]);
      wrong.executableFixtures[start] = structuredClone(wrong[field][0]);
      await assert.rejects(boundFixtureOracle(root, wrong[field][0], wrong, engine(row)), /Group (A31|BC)/);
    }
  }
});

test('group BC own-source isolation refuses runtime imports, helpers, predicates, defaults and provenance substitutions', async () => {
  const { protectedGroupBCFixtures, boundFixtureOracle } = await checker();
  const data = documents(), catalog = data.oracles;
  await withGroupA31SourceCopy(catalog.groupBCFixtureAuthorities, async (directory) => {
    assert(!fs.existsSync(path.join(directory, 'packages/core/test/catalog-fixture-group-a31.test.ts')));
    assert.equal((await protectedGroupBCFixtures(directory, catalog)).length, 8);
    const row = catalog.groupBCFixtureAuthorities[0];
    const engine = data.mapping.rows.flatMap((item) => item.engines).find((item) => item.id === row.engineId);
    await boundFixtureOracle(directory, row, catalog, engine);
    const testPath = 'packages/core/test/catalog-fixture-groups-bc.test.ts';
    for (const [relative, before, after] of [
      [testPath, "import { expect, it } from 'vitest';", "import {} from 'node:os';\nimport { expect, it } from 'vitest';"],
      [testPath, "import { expect, it } from 'vitest';", "import {} from 'vitest';\nimport { expect, it } from 'vitest';"],
      [testPath, "import { expect, it } from 'vitest';", "import type { expect, it } from 'vitest';"],
      [testPath, '  aspectRatioCalculator,', '  type aspectRatioCalculator,'],
      [testPath, '  aspectRatioCalculator,', '  aspectRatioCalculator as privateAspect,'],
      [testPath, 'const context =', 'const aspectRatioCalculator = {};\nconst context ='],
      [testPath, 'await aspectRatioCalculator.run(inputs, params, context())', 'aspectRatioCalculator.run(inputs, params, context())'],
      [testPath, 'await aspectRatioCalculator.run(inputs, params, context())', 'await aspectRatioCalculator.helper(inputs, params, context())'],
      [testPath, "const params = { width: '1920', height: '1080' };", "const params = { width: '1921', height: '1080' };"],
      [testPath, 'expect(outputs).toHaveLength(1);', 'expect(outputs).toHaveLength(2);'],
      [testPath, "expect(outputs[0]!.type).toBe('application/json');", "expect(outputs[0]!.type).toBe('text/plain');"],
      [testPath, "toMatchObject({ ratio: '16:9' })", "toMatchObject({ ratio: '16:10' })"],
      [testPath, 'close(result.geometricFovDistanceIn, 2);', 'close(result.geometricFovDistanceIn, 3);'],
      [testPath, '1e-9 * Math.max', '1e-8 * Math.max'],
      [testPath, 'sort((a, b) => a - b)', 'sort((a, b) => b - a)'],
      [testPath, 'v >= 1 && v <= 6', 'v >= 1 || v <= 6'],
      [testPath, 'Number(result.heads) + Number(result.tails)', 'Number(result.heads) - Number(result.tails)'],
      [testPath, "text.split('\\n\\n')", "text.split('\\n')"],
      [testPath, 'expect(password.length).toBe(24);', 'expect(password.trim().length).toBe(24);'],
      [testPath, '-4[0-9a-f]{3}-', '-5[0-9a-f]{3}-'],
      [testPath, 'return matches[0]!;', 'return matches[1]!;'],
      [testPath, 'onProgress() {},', "onProgress() { throw new Error('side effect'); },"],
      ['packages/core/src/index.ts', "export { aspectRatioCalculator, calculateAspectRatio } from './utilities/aspect-ratio.js';", "export { type aspectRatioCalculator, calculateAspectRatio } from './utilities/aspect-ratio.js';"],
      ['packages/core/src/default-registry.ts', '\n  aspectRatioCalculator,', '\n  aspectRatioCalculator,\n  aspectRatioCalculator,'],
      ['packages/core/src/utilities/planning.ts', '{ sides: 6, count: 2, modifier: 0 }', '{ sides: 7, count: 2, modifier: 0 }'],
      ['packages/core/test/utilities/aspect-ratio.test.ts', "ratio: '16:9'", "ratio: '16:10'"],
    ]) {
      const file = path.join(directory, relative), original = fs.readFileSync(file, 'utf8');
      assert(original.includes(before), relative + ': ' + before);
      try {
        fs.writeFileSync(file, original.replace(before, after));
        await assert.rejects(protectedGroupBCFixtures(directory, catalog), /Group BC/);
      } finally { fs.writeFileSync(file, original); }
    }
    const file = path.join(directory, 'packages/core/src/utilities/common.ts'), original = fs.readFileSync(file, 'utf8');
    const before = 'const params = validateUtilityParams(defaults, definition.paramSchema, provided);';
    assert(original.includes(before));
    try {
      fs.writeFileSync(file, original.replace(before, 'const params = provided;'));
      await assert.rejects(protectedGroupBCFixtures(directory, catalog), /Group BC/);
    } finally { fs.writeFileSync(file, original); }
    const wrong = structuredClone(catalog); wrong.sourceCaseCatalog[358].exactCaseBody += ' ';
    await assert.rejects(protectedGroupBCFixtures(directory, wrong), /Group BC/);
  });
});

test('group BC eight artifact predicates preserve their exact partial scopes and production receipt guard refuses mutations', async () => {
  const { protectedGroupBCFixtures, checkFixtureArtifacts, independentArtifactExpectation, assertIndependentArtifactExpectation } = await checker();
  const rows = await protectedGroupBCFixtures(root, documents().oracles);
  const range = Array.from({ length: 1000 }, (_, i) => i - 500);
  const coin = { heads: 400, tails: 600, values: Array(1000).fill('unqualified'), longestStreak: 1 };
  const uuid = '12345678-1234-4234-8234-123456789abc';
  const vectors = [
    [[{ ratio: '16:9', unqualified: true }], [{ ratio: '16:10' }, {}]],
    [[{ widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5, geometricFovDistanceIn: 2 },
      { widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5, geometricFovDistanceIn: 2 + 1e-9 },
      { widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5, geometricFovDistanceIn: 2 - 1e-9 }],
      ['widthIn', 'heightIn', 'referenceDistanceIn'].map((field) => ({ widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5, geometricFovDistanceIn: 2, [field]: ({ widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5 })[field] + 1e-10 }))
        .concat([{ widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5, geometricFovDistanceIn: 2 + 1e-7 },
          { widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5, geometricFovDistanceIn: 2 - 1e-7 }])],
    [[{ values: range }, { values: [...range].reverse() }],
      [{ values: range.slice(1) }, { values: [range[1], ...range.slice(1)] }, { values: [500, ...range.slice(1)] }, { values: ['-500', ...range.slice(1)] }]],
    [[{ values: [1, 6, 3], total: 9 }, { values: [], total: -1 }, { values: [6], total: 5 }],
      [{ values: [1.5], total: 0.5 }, { values: [0], total: -1 }, { values: [7], total: 6 }, { values: [1, 6], total: 7 }]],
    [[coin, { heads: '1000', tails: null, values: 'x'.repeat(1000), longestStreak: 2 }],
      [{ ...coin, tails: 599 }, { ...coin, values: 'x'.repeat(999) }, { ...coin, longestStreak: 0 }, { ...coin, longestStreak: '1' }]],
    [['one paragraph', '\n\n another single paragraph \n\n'], ['', '   ', 'one\n\ntwo']],
    [['a'.repeat(24), ' '.repeat(24), '\u{1f600}'.repeat(12)], ['a'.repeat(23), 'a'.repeat(25)]],
    [[uuid, ' \n87654321-4321-4321-b321-cba987654321\t'], [uuid.replace('-4234-', '-5234-'), uuid.replace('-8234-', '-7234-'), uuid.toUpperCase(), uuid + 'x']],
  ];
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-bc-artifact-')));
  try {
    for (const [index, row] of rows.entries()) {
      const mime = row.artifactOracles[0].mime, [good, bad] = vectors[index];
      const artifact = (value) => {
        const bytes = Buffer.from(mime === 'application/json' ? JSON.stringify(value) : value);
        fs.writeFileSync(path.join(directory, 'unit-artifact'), bytes);
        return { path: 'unit-artifact', bytes: bytes.length, sha256: sha(bytes), mime };
      };
      for (const value of good) await checkFixtureArtifacts(directory, [artifact(value)], row);
      for (const value of bad) await assert.rejects(checkFixtureArtifacts(directory, [artifact(value)], row));
      const actual = artifact(good[0]);
      await checkFixtureArtifacts(directory, [actual], row);
      await assert.rejects(checkFixtureArtifacts(directory, [], row), /artifact list/);
      await assert.rejects(checkFixtureArtifacts(directory, [actual, actual], row), /artifact list/);
      await assert.rejects(checkFixtureArtifacts(directory, [{ ...actual, mime: 'wrong/mime' }], row), /MIME/);
      await assert.rejects(checkFixtureArtifacts(directory, [{ ...actual, sha256: '0'.repeat(64) }], row), /Stale hash/);
      const expected = independentArtifactExpectation(row, [actual]);
      assertIndependentArtifactExpectation(row, [actual], expected);
      assert.equal(expected.artifactChecks[0].authorityKind, 'group B2 C6 source-bound fixture');
      assert.equal(expected.artifactChecks[0].oracleKind, row.artifactOracles[0].kind);
      assert(expected.artifactChecks[0].checkedFields.length > 0);
      assert(!Object.hasOwn(expected.artifactChecks[0], 'absoluteTolerance'));
      assert(!Object.hasOwn(expected.artifactChecks[0], 'relativeTolerance'));
      if (index === 1) assert.deepEqual(expected.artifactChecks[0].onlyNumericComparison,
        { field: 'geometricFovDistanceIn', expected: 2, relativeTolerance: 1e-9, inclusive: true });
      for (const mutate of [
        (value) => { value.oracleKey = 'wrong-key'; },
        (value) => { value.authorityPins[0].sha256 = '0'.repeat(64); },
        (value) => { value.check = 'Whole output qualified'; },
        (value) => { value.extra = true; },
        (value) => { value.artifactChecks = []; },
        (value) => { value.artifactChecks.push(structuredClone(value.artifactChecks[0])); },
        (value) => { value.artifactChecks[0].index = 1; },
        (value) => { value.artifactChecks[0].actualMime = 'wrong/mime'; },
        (value) => { value.artifactChecks[0].expectedMime = 'wrong/mime'; },
        (value) => { value.artifactChecks[0].oracleKind = 'bytes-exact'; },
        (value) => { value.artifactChecks[0].authorityKind = 'declared-fixture literal'; },
        (value) => { value.artifactChecks[0].scope = 'Whole parsed JSON equality, including absence of extra keys.'; },
        (value) => { delete value.artifactChecks[0].checkedFields; },
        (value) => { value.artifactChecks[0].checkedFields.push('unqualified.field'); },
        (value) => { value.artifactChecks[0].relativeTolerance = 1; },
        (value) => { value.artifactChecks[0].onlyNumericComparison = { field: 'any', relativeTolerance: 1 }; },
        (value) => { value.artifactChecks[0].predicate = 'producer-defined'; },
      ]) {
        const wrong = structuredClone(expected); mutate(wrong);
        assert.throws(() => assertIndependentArtifactExpectation(row, [actual], wrong), /Independent receipt/);
      }
      assert.throws(() => assertIndependentArtifactExpectation(row, [], expected), /Complete artifact list/);
      assert.throws(() => assertIndependentArtifactExpectation(row, [actual, actual], expected), /Complete artifact list/);
      assert.throws(() => assertIndependentArtifactExpectation(row, [{ ...actual, mime: 'wrong/mime' }], expected), /MIME/);
      if (index > 0) {
        for (const mutate of [
          (value) => { value.extra = true; },
          (value) => { value.relativeTolerance = 1e-3; },
          (value) => { value.authority = 'producer override'; },
        ]) {
          const wrong = structuredClone(row); mutate(wrong.artifactOracles[0]);
          await assert.rejects(checkFixtureArtifacts(directory, [actual], wrong), /Group BC/);
        }
      }
    }
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('continued epoch six SOURCE9 bridges preserve whole sealed authorities and aliased current candidates', async () => {
  const { boundFixtureOracle, protectedBrowserFixtures } = await checker();
  const data = documents(), original = JSON.stringify(data.oracles);
  const candidates = await protectedBrowserFixtures(root), before = structuredClone(candidates);
  assert.equal(candidates.length, 6);
  assert.equal(candidates[0].sourceCaseBinding.sourcePin, candidates[5].sourceCaseBinding.sourcePin);
  assert.equal(candidates[0].sourceCaseBinding.sourcePin, candidates[0].authorityPins[0]);
  assert.equal(sha(JSON.stringify(data.oracles.executableFixtures.slice(0, 181))),
    '2486316ec7eaa544fec64ad64c13797b190320d5a7e9c3899a7644e96e43765f');
  for (const [offset, candidate] of candidates.entries()) {
    const authority = data.oracles.executableFixtures[102 + offset];
    assert.equal(authority.key, candidate.key);
    const bridge = await boundFixtureOracle(root, authority, data.oracles, { id: authority.engineId });
    assert.deepEqual(Object.keys(bridge).sort(), ['kind', 'oracleKey', 'engineId', 'currentSource',
      'expectedAuthoritySource', 'sourceCaseBodySha256', 'projectionFields'].sort());
    assert.equal(bridge.kind, 'source9-binding-failure-cleanup-bridge-v1');
    assert.equal(bridge.oracleKey, authority.key);
    assert.equal(bridge.engineId, authority.engineId);
    assert.deepEqual(bridge.currentSource, candidate.sourceCaseBinding.sourcePin);
    assert.deepEqual(bridge.expectedAuthoritySource, authority.sourceCaseBinding.sourcePin);
    assert.equal(bridge.sourceCaseBodySha256, authority.sourceCaseBinding.exactCaseBodySha256);
    assert.deepEqual(bridge.projectionFields, ['sourceCaseBinding.sourcePin', 'authorityPins[0]']);
    for (const change of [
      (value) => { value.key += '-seventh'; },
      (value) => { value.engineId = 'word-counter'; },
      (value) => { value.sourceCaseBinding.sourcePin = structuredClone(bridge.currentSource); },
      (value) => { value.authorityPins[0] = structuredClone(bridge.currentSource); },
      (value) => { value.sourceCaseBinding.exactCaseBody += ' '; },
      (value) => { value.sourceCaseBinding.exactCaseBodySha256 = '0'.repeat(64); },
      (value) => { value.inputs = [{ text: 'unbound', name: 'x', mime: 'text/plain' }]; },
      (value) => { value.artifactOracles[0].extra = true; },
      (value) => { value.artifactOracles[0].authority = 'replacement'; },
      (value) => { value.scope = 'whole engine'; },
      (value) => { value.extra = true; },
      (value) => { value.authorityPins.push(structuredClone(value.authorityPins[0])); },
    ]) {
      const wrong = structuredClone(authority); change(wrong);
      await assert.rejects(boundFixtureOracle(root, wrong, data.oracles, { id: authority.engineId }), /Browser fixture/);
    }
  }
  assert.deepEqual(candidates, before);
  assert.equal(JSON.stringify(data.oracles), original);
  const wrongOriginal = structuredClone(data.oracles);
  wrongOriginal.executableFixtures[0].scope += ' changed';
  await assert.rejects(boundFixtureOracle(root, data.oracles.executableFixtures[102], wrongOriginal,
    { id: 'stopwatch' }), /original181/);
  assert.deepEqual(await protectedBrowserFixtures(root), before);
});

test('continued epoch browser manifest3 and producer4 pins bind actual ordered sources and reject paired mutations', async () => {
  const { boundFixtureOracle, checkBrowserAuthorityCommandPins } = await checker();
  const data = documents(), authority = data.oracles.executableFixtures[102];
  const bridge = await boundFixtureOracle(root, authority, data.oracles, { id: authority.engineId });
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-epoch-pins-')));
  const paths = ['tools/catalog-baseline-producers.mjs', 'packages/web/test/catalog-baseline-browser.test.ts',
    'packages/web/test/productionBrowserHarness.ts', 'packages/web/test/productionBuildBindingObserver.mjs'];
  try {
    const pins = paths.map((relative) => {
      const bytes = fs.readFileSync(path.join(root, relative));
      fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
      fs.writeFileSync(path.join(directory, relative), bytes, { flag: 'wx' });
      return { path: relative, bytes: bytes.length, sha256: sha(bytes) };
    });
    const producer = { commandSourcePins: pins }, manifest = { commandSourcePins: pins.slice(1) };
    await checkBrowserAuthorityCommandPins(directory, producer, manifest, bridge);
    for (const mutate of [
      (p, m) => { m.commandSourcePins[0].sha256 = '0'.repeat(64); },
      (p, m) => { m.commandSourcePins.shift(); },
      (p, m) => { m.commandSourcePins[1] = structuredClone(m.commandSourcePins[0]); p.commandSourcePins = [p.commandSourcePins[0], ...m.commandSourcePins]; },
      (p, m) => { m.commandSourcePins.reverse(); p.commandSourcePins = [p.commandSourcePins[0], ...m.commandSourcePins]; },
      (p) => { p.commandSourcePins.splice(2, 1); },
      (p) => { [p.commandSourcePins[0], p.commandSourcePins[1]] = [p.commandSourcePins[1], p.commandSourcePins[0]]; },
      (p) => { p.commandSourcePins.push(structuredClone(p.commandSourcePins[0])); },
      (p) => { p.commandSourcePins[0].sha256 = '0'.repeat(64); },
      (p, m) => { m.commandSourcePins[1].extra = true; p.commandSourcePins[2].extra = true; },
      (p) => { p.commandSourcePins[0].extra = true; },
      (p, m) => { m.commandSourcePins[0].bytes = 25345; m.commandSourcePins[0].sha256 = 'd5ee9f3d5a0f1550de0d6c2fef5d1490cf56ec81f7dac60e4e562883083c73a5'; p.commandSourcePins[1] = structuredClone(m.commandSourcePins[0]); },
    ]) {
      const p = structuredClone(producer), m = structuredClone(manifest);
      mutate(p, m);
      await assert.rejects(checkBrowserAuthorityCommandPins(directory, p, m, bridge), /Browser fixture|Browser command source pin|Stale hash/);
    }
    await assert.rejects(checkBrowserAuthorityCommandPins(directory, producer, manifest,
      { ...bridge, kind: 'other' }), /Browser fixture/);
    await assert.rejects(checkBrowserAuthorityCommandPins(directory, producer, manifest,
      { ...bridge, currentSource: bridge.expectedAuthoritySource }), /Browser fixture/);
    await checkBrowserAuthorityCommandPins(directory, producer, manifest, bridge);
  } finally { fs.rmSync(directory, { recursive: true }); }
});

test('continued epoch exact823 ledger and historical mapping reverse reject every additional epoch drift', async () => {
  const original = documents(), entry = original.mapping.pendingSourceRecaptures[4];
  assert.equal(entry.changes.length, 823);
  assert.equal(sha(JSON.stringify(entry.changes)), 'd57b94c7326bac555e2aa324ac99c9b90aeb04381c9677fbe2d33fc12765b9c3');
  const historical = structuredClone(original.mapping);
  historical.pendingSourceRecaptures.pop();
  for (const row of [...entry.changes].reverse()) {
    const parts = row.field.split('.'), key = parts.pop();
    const parent = parts.reduce((value, part) => value[part], historical);
    parent[key] = structuredClone(row.prior);
  }
  assert.equal(sha(JSON.stringify(historical)), 'a6d991ebf5aaa3c0f12bda6cca8874e4663dacc1d8a525ef88cb5837ab019bb0');
  await validate(original);
  for (const mutate of [
    (mapping) => { mapping.pendingSourceRecaptures.pop(); },
    (mapping) => { mapping.pendingSourceRecaptures.push(structuredClone(mapping.pendingSourceRecaptures[4])); },
    (mapping) => { mapping.pendingSourceRecaptures[4].changes.pop(); },
    (mapping) => { mapping.pendingSourceRecaptures[4].changes.push(structuredClone(entry.changes[0])); },
    (mapping) => { mapping.pendingSourceRecaptures[4].changes[1] = structuredClone(entry.changes[0]); },
    (mapping) => { mapping.pendingSourceRecaptures[4].changes.reverse(); },
    (mapping) => { mapping.pendingSourceRecaptures[4].changes[0].field = 'rows.0.engines.0.unknown'; },
    (mapping) => { mapping.pendingSourceRecaptures[4].changes[0].prior.bytes++; },
    (mapping) => { mapping.pendingSourceRecaptures[4].changes[0].current.bytes++; },
    (mapping) => { mapping.pendingSourceRecaptures[4].changes[0].extra = true; },
    (mapping) => { mapping.pendingSourceRecaptures[4].originalMapping.historicalEvidenceName = '/private/tmp/' + entry.originalMapping.historicalEvidenceName; },
    (mapping) => { mapping.pendingSourceRecaptures[4].originalMapping.historicalEvidenceName += '-different'; },
    (mapping) => { mapping.pendingSourceRecaptures[4].originalMapping.sha256 = '0'.repeat(64); },
    (mapping) => { mapping.pendingSourceRecaptures[4].acceptance = 'verified'; },
    (mapping) => { mapping.pendingSourceRecaptures[4].extra = true; },
    (mapping) => { mapping.releaseIntegrationEpoch.id = 'bypass-current-epoch'; },
    (mapping) => { mapping.rows[0].engines[0].sourceBinding.tree += ' fifteenth drift'; },
    (mapping) => { mapping.pendingSourceRecaptures[0].acceptance += ' historical edit'; },
    (mapping) => { mapping.unreviewedFifteenthSource = { path: 'unreviewed.ts', bytes: 1, sha256: '0'.repeat(64) }; },
  ]) {
    const data = structuredClone(original); mutate(data.mapping);
    await assert.rejects(validate(data), /Continued epoch exact823/);
  }
});

async function withContinuedEpochUnitRoot(action) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-epoch-unit-')));
  const data = documents();
  try {
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    const paths = new Set(['package.json', 'docs/CATALOG-COVERAGE.json',
      'tools/catalog-baseline-producers.mjs', 'tools/check-catalog-evidence.mjs',
      'packages/web/test/productionBrowserHarness.ts', 'packages/web/test/productionBuildBindingObserver.mjs']);
    for (const row of data.mapping.rows) for (const engine of row.engines)
      for (const pin of engine.sourceBinding.pins) paths.add(pin.path);
    function publicPins(value) {
      if (!value || typeof value !== 'object') return;
      if (typeof value.path === 'string' && Number.isSafeInteger(value.bytes) &&
          typeof value.sha256 === 'string' && /^(packages|functions|tools)\//.test(value.path))
        paths.add(value.path);
      for (const child of Object.values(value)) publicPins(child);
    }
    publicPins(data.oracles);
    for (const relative of paths) {
      assert(!path.isAbsolute(relative) && !relative.includes('\\') &&
        relative.split('/').every((part) => part && part !== '.' && part !== '..'));
      const source = path.join(root, relative);
      assert(fs.lstatSync(source).isFile() && !fs.lstatSync(source).isSymbolicLink(), relative);
      assert.equal(fs.realpathSync(source), source);
      fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
      fs.copyFileSync(source, path.join(directory, relative), fs.constants.COPYFILE_EXCL);
    }
    for (const [name, value] of Object.entries(data))
      fs.writeFileSync(path.join(directory, `docs/CATALOG-INTEGRATION-${({ mapping: 'MAPPING', oracles: 'ORACLES', gates: 'SOURCE-GATES' })[name]}.json`), JSON.stringify(value), { flag: 'wx' });
    await action(directory, data);
  } finally { fs.rmSync(directory, { recursive: true }); }
}

test('continued epoch actual receipt consumers reject manifest and bridge defects before later independent refusals UNIT ONLY', async () => {
  const api = await checker();
  const { pathToFileURL } = await import('node:url');
  const { createDefaultRegistry } = await import(pathToFileURL(path.join(root, 'packages/core/dist/node/index.js')).href);
  const registry = createDefaultRegistry();
  await withContinuedEpochUnitRoot(async (directory, data) => {
    const label = 'UNIT_ONLY_SYNTHETIC_NOT_SOURCE_OR_NATIVE_ACCEPTANCE';
    const run = 'docs/catalog-artifacts/UNIT-ONLY-SYNTHETIC-NOT-SOURCE-OR-NATIVE-ACCEPTANCE', runPath = path.join(directory, run);
    fs.mkdirSync(runPath, { recursive: true });
    const pin = (relative) => {
      const bytes = fs.readFileSync(path.join(directory, relative));
      return { path: relative, bytes: bytes.length, sha256: sha(bytes) };
    };
    const write = (name, value) => {
      const relative = `${run}/${name}`;
      fs.writeFileSync(path.join(directory, relative), typeof value === 'string' ? value : JSON.stringify(value));
      return pin(relative);
    };
    const commandPins = ['tools/catalog-baseline-producers.mjs',
      'packages/web/test/catalog-baseline-browser.test.ts', 'packages/web/test/productionBrowserHarness.ts',
      'packages/web/test/productionBuildBindingObserver.mjs'].map(pin);
    const authority = data.oracles.executableFixtures[102];
    const originalEngine = data.mapping.rows.flatMap((row) => row.engines).find((engine) => engine.id === authority.engineId);
    const bridge = await api.boundFixtureOracle(directory, authority, data.oracles, originalEngine);
    const log = write('UNIT_ONLY.log', label + '\nHypothetical input shape only; no producer or SOURCE execution.\n');
    const build = write('UNIT_ONLY-build.json', { qualification: label });
    const artifact = { ...write('UNIT_ONLY-wrong-independent-artifact.json',
      { ...authority.artifactOracles[0].expected, elapsedMs: 1201 }), mime: 'application/json' };
    const manifest = { qualification: label, commandSourcePins: commandPins.slice(1), oracleKey: authority.key };
    const producer = {
      qualification: label, role: 'producer', owner: 'UNIT_ONLY_PRODUCER', engineId: authority.engineId,
      command: [process.execPath, label], exitCode: 0, caseCount: 1,
      startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:00.001Z',
      sourceBindingDigest: api.sourceBindingDigest(originalEngine.sourceBinding), log,
      commandSourcePins: commandPins, manifest: write('UNIT_ONLY-manifest.json', manifest),
      productionBuildManifest: build, artifactPins: [artifact], browserAuthorityBridge: bridge,
      caseKey: 'UNIT_ONLY-wrong-independent-artifact', oracleKey: authority.key,
    };
    const independent = { ...producer, role: 'checker', owner: 'UNIT_ONLY_CHECKER',
      producerOwner: producer.owner, commandSourcePins: [pin('tools/check-catalog-evidence.mjs')] };
    const producerName = 'producer-UNIT_ONLY.json';
    const save = (p = producer, m = manifest, c = independent) => {
      p.manifest = write('UNIT_ONLY-manifest.json', m);
      return { producerReceipt: write(producerName, p), checkerReceipt: write('UNIT_ONLY-checker.json', c) };
    };
    const checked = () => api.checkArtifactRun({ root: directory, directory: run, owner: 'UNIT_ONLY_CHECKER' });
    const verified = (p, m, c, fixture = authority, sourceEngine = originalEngine) => {
      const current = structuredClone(data), engine = current.mapping.rows.flatMap((row) => row.engines).find((value) => value.id === sourceEngine.id);
      const branches = api.requiredBranchKeys(registry.toolsById.get(engine.id), engine);
      const receipts = save(p, m, c);
      engine.status = 'verified';
      engine.verification = { requiredBranches: branches, coveredBranches: branches, cases: [{
        ...receipts, caseKey: p.caseKey, oracleKey: fixture.key, surface: fixture.surface ?? 'cli',
        artifacts: p.artifactPins,
      }] };
      current.gates.currentIntegratedSourceGate = { status: 'accepted', qualification: label,
        acceptance: { qualification: label, engineIds: [engine.id], sourcePins: engine.sourceBinding.pins, receipt: log } };
      return api.validateCatalogEvidence({ root: directory, ...current, registry });
    };
    // These paired negatives model input shape only. Neither path may qualify an engine.
    save();
    await assert.rejects(checked(), /^Error: Browser binding missing observation mode$/);
    await assert.rejects(verified(structuredClone(producer), structuredClone(manifest), structuredClone(independent)),
      /^Error: Independent oracle mismatch at \$\.elapsedMs$/);
    for (const mutate of [
      (p, m) => { m.commandSourcePins[0].sha256 = '0'.repeat(64); },
      (p, m) => { m.commandSourcePins.shift(); },
      (p, m) => { m.commandSourcePins[1] = structuredClone(m.commandSourcePins[0]); },
      (p, m) => { m.commandSourcePins.reverse(); },
      (p) => { p.commandSourcePins.splice(2, 1); },
      (p) => { [p.commandSourcePins[0], p.commandSourcePins[1]] = [p.commandSourcePins[1], p.commandSourcePins[0]]; },
      (p, m) => { m.commandSourcePins[1].extra = true; p.commandSourcePins[2].extra = true; },
    ]) {
      const p = structuredClone(producer), m = structuredClone(manifest), c = structuredClone(independent);
      mutate(p, m); save(p, m, c);
      await assert.rejects(checked(), /Browser fixture|Browser command source pin/);
      await assert.rejects(verified(p, m, c), /Browser fixture|Browser command source pin/);
    }
    for (const mutate of [
      (p) => { delete p.browserAuthorityBridge; },
      (p) => { p.browserAuthorityBridge = { ...bridge, kind: 'forged' }; },
    ]) {
      const p = structuredClone(producer); mutate(p); save(p);
      await assert.rejects(checked(), /^Error: Browser fixture producer bridge differs\.$/);
      await assert.rejects(verified(p, structuredClone(manifest), structuredClone(independent)),
        /^Error: Browser fixture producer\/checker bridge differs\.$/);
    }
    for (const value of [undefined, null, { ...bridge, engineId: 'other' }]) {
      const c = structuredClone(independent); c.browserAuthorityBridge = value;
      await assert.rejects(verified(structuredClone(producer), structuredClone(manifest), c),
        /^Error: Browser fixture producer\/checker bridge differs\.$/);
    }
    const scalar = data.oracles.executableFixtures.find((value) => value.key === 'duplicate-lines-canonical');
    const scalarEngine = data.mapping.rows.flatMap((row) => row.engines).find((value) => value.id === scalar.engineId);
    assert.equal(await api.boundFixtureOracle(directory, scalar, data.oracles, scalarEngine), undefined);
    const scalarProducer = { ...structuredClone(producer), engineId: scalar.engineId, oracleKey: scalar.key,
      sourceBindingDigest: api.sourceBindingDigest(scalarEngine.sourceBinding) };
    const scalarChecker = { ...structuredClone(independent), engineId: scalar.engineId,
      sourceBindingDigest: api.sourceBindingDigest(scalarEngine.sourceBinding) };
    delete scalarProducer.browserAuthorityBridge; delete scalarChecker.browserAuthorityBridge;
    assert(!Object.hasOwn(scalarProducer, 'browserAuthorityBridge'));
    assert(!Object.hasOwn(scalarChecker, 'browserAuthorityBridge'));
    const scalarManifest = { qualification: label, oracleKey: scalar.key, caseKey: scalarProducer.caseKey,
      engineId: scalar.engineId, params: scalar.params, inputs: scalar.inputs,
      artifacts: scalarProducer.artifactPins, builtEntry: pin('tools/catalog-baseline-producers.mjs') };
    save(scalarProducer, scalarManifest, scalarChecker);
    await assert.rejects(checked(), /Independent full text oracle mismatch/);
    await assert.rejects(verified(scalarProducer, scalarManifest, scalarChecker, scalar, scalarEngine),
      /Independent full text oracle mismatch/);
    for (const target of ['producer', 'checker']) for (const value of [null, false, {}]) {
      const p = { ...structuredClone(producer), engineId: scalar.engineId, oracleKey: scalar.key,
        sourceBindingDigest: api.sourceBindingDigest(scalarEngine.sourceBinding) };
      const c = { ...structuredClone(independent), engineId: scalar.engineId,
        sourceBindingDigest: api.sourceBindingDigest(scalarEngine.sourceBinding) };
      delete p.browserAuthorityBridge; delete c.browserAuthorityBridge;
      (target === 'producer' ? p : c).browserAuthorityBridge = value;
      const m = { qualification: label, oracleKey: scalar.key };
      save(p, m, c);
      if (target === 'producer') await assert.rejects(checked(), /^Error: Non-browser producer receipt must omit browserAuthorityBridge\.$/);
      await assert.rejects(verified(p, m, c, scalar, scalarEngine), /^Error: Non-browser receipts must omit browserAuthorityBridge\.$/);
    }
    assert.equal(fs.existsSync(path.join(runPath, 'checker-UNIT_ONLY_CHECKER')), false);
    assert.equal(sha(JSON.stringify(data.oracles.executableFixtures.slice(0, 181))),
      '2486316ec7eaa544fec64ad64c13797b190320d5a7e9c3899a7644e96e43765f');
  });
});
