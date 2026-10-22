import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const CATALOG_FILES = Object.freeze({
  mapping: 'docs/CATALOG-INTEGRATION-MAPPING.json',
  oracles: 'docs/CATALOG-INTEGRATION-ORACLES.json',
  gates: 'docs/CATALOG-INTEGRATION-SOURCE-GATES.json',
});
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function fail(message) {
  throw new Error(message);
}
export function confinedPath(root, relative) {
  if (
    typeof relative !== 'string' ||
    !relative ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    path.isAbsolute(relative) ||
    relative.split('/').some((part) => part === '..' || part === '.' || part === '')
  )
    fail(`Invalid evidence path: ${String(relative)}`);
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) fail('Evidence path escapes root.');
  return absolute;
}
async function readOwned(root, relative) {
  const absolute = confinedPath(root, relative);
  const realRoot = await fs.realpath(root);
  const real = await fs.realpath(absolute);
  if (!real.startsWith(realRoot + path.sep))
    fail(`Evidence path resolves outside root: ${relative}`);
  const stat = await fs.stat(real);
  if (!stat.isFile()) fail(`Evidence path is not a file: ${relative}`);
  return fs.readFile(real);
}
export async function verifyPin(root, pin, { nonempty = false } = {}) {
  if (
    !pin ||
    !Number.isSafeInteger(pin.bytes) ||
    pin.bytes < 0 ||
    !/^[a-f0-9]{64}$/.test(pin.sha256)
  )
    fail('Malformed evidence pin.');
  if (nonempty && pin.bytes === 0) fail('Full artifact cannot be empty.');
  const bytes = await readOwned(root, pin.path);
  if (bytes.length !== pin.bytes || sha(bytes) !== pin.sha256)
    fail(`Stale hash/bytes: ${pin.path}`);
  return bytes;
}
function matchFields(actual, expected, tolerance, prefix = '$', absoluteTolerance) {
  if (
    typeof expected === 'number' &&
    (tolerance !== undefined || absoluteTolerance !== undefined)
  ) {
    if (
      typeof actual !== 'number' ||
      !Number.isFinite(actual) ||
      (absoluteTolerance !== undefined
        ? Math.abs(actual - expected) >= absoluteTolerance
        : Math.abs(actual - expected) > tolerance * Math.max(1, Math.abs(expected)))
    )
      fail(`Independent numeric oracle mismatch at ${prefix}`);
    return;
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual) !== Array.isArray(expected))
      fail(`Independent oracle shape mismatch at ${prefix}`);
    if (Array.isArray(expected) && actual.length !== expected.length)
      fail(`Independent array length mismatch at ${prefix}`);
    for (const [key, value] of Object.entries(expected))
      matchFields(actual[key], value, tolerance, `${prefix}.${key}`, absoluteTolerance);
    return;
  }
  if (!Object.is(actual, expected)) fail(`Independent oracle mismatch at ${prefix}`);
}
export async function checkArtifact(root, artifact, oracle) {
  const expectedEmpty = await qualifiesExpectedEmptyArtifact(root, oracle);
  const bytes = await verifyPin(root, artifact, { nonempty: !expectedEmpty });
  if (!oracle || typeof oracle.authority !== 'string' || !oracle.authority.trim())
    fail('Independent oracle authority is required.');
  if (oracle.mime !== undefined && artifact.mime !== oracle.mime)
    fail('Artifact MIME differs from its ordered independent authority.');
  if (typeof oracle.kind === 'string' && oracle.kind.startsWith('bc-')) {
    const descriptor = groupBCArtifactDescriptor(oracle);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (descriptor.mime === 'application/json') {
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        fail('Group BC original JSON object required.');
      if (oracle.kind === 'bc-tv-original-geometry') {
        matchFields(value, { widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5 });
        if (typeof value.geometricFovDistanceIn !== 'number'
          || !(Math.abs(value.geometricFovDistanceIn - 2) <= 1e-9 * Math.max(1, Math.abs(2))))
          fail('Group BC original TV numeric comparison failed.');
      } else if (oracle.kind === 'bc-random-original-complete-range') {
        if (!Array.isArray(value.values)) fail('Group BC original values array required.');
        assert.deepEqual([...value.values].sort((a, b) => a - b), Array.from({ length: 1000 }, (_, i) => i - 500),
          'Group BC original complete-range oracle mismatch.');
      } else if (oracle.kind === 'bc-dice-original-faces-total') {
        if (!Array.isArray(value.values) || !value.values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6))
          fail('Group BC original dice faces mismatch.');
        assert.equal(value.total, value.values.reduce((a, b) => a + b, 0) - 1, 'Group BC original dice total mismatch.');
      } else if (oracle.kind === 'bc-coin-original-count-streak') {
        assert.equal(Number(value.heads) + Number(value.tails), 1000, 'Group BC original coin sum mismatch.');
        if (value.values === null || value.values === undefined || value.values.length !== 1000)
          fail('Group BC original coin length mismatch.');
        if (typeof value.longestStreak !== 'number' || !(value.longestStreak > 0))
          fail('Group BC original positive numeric streak required.');
      }
    } else if (oracle.kind === 'bc-lorem-original-paragraph') {
      assert.equal(text.split('\n\n').filter((paragraph) => paragraph.trim().length > 0).length, 1,
        'Group BC original paragraph count mismatch.');
    } else if (oracle.kind === 'bc-password-original-length') {
      assert.equal(text.length, 24, 'Group BC original untrimmed password length mismatch.');
    } else if (oracle.kind === 'bc-uuid-original-v4') {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text.trim()))
        fail('Group BC original lowercase UUID v4/variant regex mismatch.');
    }
  } else if (oracle.kind === 'names-original-public-properties') {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      oracle.count !== 12 ||
      oracle.distinctNames !== 12 ||
      oracle.noticeIncludes !== 'not been checked'
    )
      fail('Unrecognized protected public-name property control.');
    if (
      !Array.isArray(value.ideas) ||
      value.ideas.length !== oracle.count ||
      value.ideas.some((idea) => !idea || typeof idea.name !== 'string') ||
      new Set(value.ideas.map((idea) => idea.name)).size !== oracle.distinctNames ||
      typeof value.notice !== 'string' ||
      !value.notice.includes(oracle.noticeIncludes)
    )
      fail('Independent public-name count/uniqueness/notice oracle mismatch.');
  } else if (oracle.kind === 'pitch-original-melody') {
    const report = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    assert.deepEqual(
      report.notes.map((note) => [note.id, note.note]),
      [
        ['n0', 57],
        ['n1', 69],
      ],
    );
    for (const [index, hz] of [220, 440].entries()) {
      const note = report.notes[index];
      if (
        ![note.frequency, note.start, note.end].every(Number.isFinite) ||
        Math.abs(note.frequency / hz - 1) >= 0.01 ||
        Math.abs(note.start - index) > 0.15 ||
        Math.abs(note.end - index - 1) > 0.15
      )
        fail('Original melody pitch/timing oracle mismatch.');
    }
  } else if (oracle.kind === 'midi-original-melody') {
    checkOriginalMelodyMidi(bytes);
  } else if (oracle.kind === 'json-exact') {
    if (!oracle.expected || typeof oracle.expected !== 'object')
      fail('Independent whole JSON object is required.');
    if (oracle.relativeTolerance !== undefined || oracle.absoluteTolerance !== undefined)
      fail('Whole JSON equality does not admit a numeric tolerance.');
    assert.deepEqual(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      oracle.expected,
      'Independent whole JSON oracle mismatch.',
    );
  } else if (oracle.kind === 'json-fields') {
    if (
      !oracle.expected ||
      typeof oracle.expected !== 'object' ||
      !Object.keys(oracle.expected).length
    )
      fail('Nonempty independent JSON fields are required.');
    if (
      oracle.relativeTolerance !== undefined &&
      (!Number.isFinite(oracle.relativeTolerance) ||
        oracle.relativeTolerance < 0 ||
        oracle.relativeTolerance > 1e-9)
    )
      fail('Invalid independently specified tolerance.');
    if (
      oracle.absoluteTolerance !== undefined &&
      (oracle.absoluteTolerance !== 5e-9 || oracle.relativeTolerance !== undefined)
    )
      fail('Invalid protected planning precision.');
    matchFields(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      oracle.expected,
      oracle.relativeTolerance,
      '$',
      oracle.absoluteTolerance,
    );
  } else if (oracle.kind === 'text-exact') {
    if (typeof oracle.expected !== 'string' || (!oracle.expected.length && !expectedEmpty))
      fail('Nonempty independent text is required.');
    assert.equal(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      oracle.expected,
      'Independent full text oracle mismatch.',
    );
  } else if (oracle.kind === 'bytes-exact') {
    if (typeof oracle.expectedHex !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(oracle.expectedHex))
      fail('Nonempty independent byte oracle required.');
    assert.equal(
      bytes.toString('hex'),
      oracle.expectedHex,
      'Independent full byte oracle mismatch.',
    );
  } else
    fail(
      `Unsupported independent oracle: ${String(oracle.kind)}; MIME/size is not semantic acceptance.`,
    );
}
function checkOriginalMelodyMidi(bytes) {
  if (bytes.length < 26 || bytes.length > 1024 * 1024) fail('Bounded original SMF size required.');
  assert.equal(bytes.subarray(0, 4).toString(), 'MThd');
  assert.equal(bytes.readUInt32BE(4), 6);
  assert.deepEqual(
    [bytes.readUInt16BE(8), bytes.readUInt16BE(10), bytes.readUInt16BE(12)],
    [0, 1, 480],
  );
  assert.equal(bytes.subarray(14, 18).toString(), 'MTrk');
  assert.equal(bytes.readUInt32BE(18), bytes.length - 22);
  let offset = 22,
    tick = 0,
    tempo = 0,
    signature = 0,
    ended = false;
  const notes = [],
    ticks = [];
  while (offset < bytes.length) {
    let delta = 0,
      length = 0,
      byte;
    do {
      if (offset >= bytes.length || ++length > 4) fail('Malformed SMF delta.');
      byte = bytes[offset++];
      delta = delta * 128 + (byte & 127);
    } while (byte & 128);
    tick += delta;
    const status = bytes[offset++];
    if (status === 255) {
      const type = bytes[offset++],
        count = bytes[offset++];
      if (offset + count > bytes.length) fail('Truncated SMF metadata.');
      if (type === 81) {
        assert.equal(count, 3);
        assert.equal(bytes.readUIntBE(offset, 3), 500000);
        tempo++;
      } else if (type === 88) {
        assert.equal(count, 4);
        assert.deepEqual([...bytes.subarray(offset, offset + count)], [4, 2, 24, 8]);
        signature++;
      } else {
        assert.equal(type, 47);
        assert.equal(count, 0);
        ended = true;
      }
      offset += count;
    } else {
      if (![128, 144].includes(status) || offset + 2 > bytes.length)
        fail('Unsupported/truncated original melody note event.');
      const note = bytes[offset++],
        velocity = bytes[offset++];
      if (note > 127 || velocity > 127 || (status === 144 ? velocity === 0 : velocity !== 0))
        fail('Invalid original melody note/velocity.');
      notes.push([status === 144, note]);
      ticks.push(tick);
    }
    if (ended && offset !== bytes.length) fail('SMF has data after final EOT.');
  }
  assert.equal(ended, true);
  assert.equal(tempo, 1);
  assert.equal(signature, 1);
  assert.deepEqual(notes, [
    [true, 57],
    [false, 57],
    [true, 69],
    [false, 69],
  ]);
  for (const [index, seconds] of [0, 1, 1, 2].entries())
    if (Math.abs(ticks[index] - seconds * 960) > 144)
      fail('Original SMF note timing oracle mismatch.');
}
export async function qualifiesExpectedEmptyArtifact(root, oracle) {
  if (!oracle?.expectedEmptyControl) return false;
  if (oracle.kind !== 'text-exact' || oracle.expected !== '')
    fail('Expected-empty control must declare its exact empty text output.');
  await validateProtectedToolOutputControl(root, oracle.expectedEmptyControl, oracle.expected);
  return true;
}
async function validateProtectedToolOutputControl(root, control, expected) {
  if (
    control.engineId !== 'remove-duplicate-lines-online' ||
    typeof control.inputText !== 'string' ||
    typeof expected !== 'string' ||
    (expected === '' && control.inputText !== '') ||
    !control.params ||
    Object.keys(control.params).length ||
    control.sourcePin?.path !== 'packages/core/test/utilities/text-developer.test.ts' ||
    typeof control.assertionExpression !== 'string'
  )
    fail('Expected-empty engine/input literal is outside the protected control.');
  const bytes = await verifyPin(root, control.sourcePin, { nonempty: true });
  if (!bytes.toString('utf8').includes(control.assertionExpression))
    fail('Expected-empty assertion is absent from its pinned source.');
  const ts = createRequire(import.meta.url)('typescript');
  const ast = ts.createSourceFile(
    'empty-control.ts',
    `${control.assertionExpression};`,
    ts.ScriptTarget.Latest,
    true,
  );
  const statement = ast.statements[0];
  const assertion = statement && ts.isExpressionStatement(statement) ? statement.expression : null;
  const call =
    assertion &&
    ts.isCallExpression(assertion) &&
    ts.isPropertyAccessExpression(assertion.expression)
      ? assertion.expression
      : null;
  const expectCall = call && ts.isCallExpression(call.expression) ? call.expression : null;
  const awaited = expectCall?.arguments[0];
  const outputCall =
    awaited && ts.isAwaitExpression(awaited) && ts.isCallExpression(awaited.expression)
      ? awaited.expression
      : null;
  if (
    ast.parseDiagnostics.length ||
    ast.statements.length !== 1 ||
    !assertion ||
    !call ||
    call.name.text !== 'toBe' ||
    assertion.arguments.length !== 1 ||
    !ts.isStringLiteralLike(assertion.arguments[0]) ||
    assertion.arguments[0].text !== expected ||
    !expectCall ||
    !ts.isIdentifier(expectCall.expression) ||
    expectCall.expression.text !== 'expect' ||
    expectCall.arguments.length !== 1 ||
    !outputCall ||
    !ts.isIdentifier(outputCall.expression) ||
    outputCall.expression.text !== 'output' ||
    outputCall.arguments.length !== 3 ||
    !ts.isStringLiteralLike(outputCall.arguments[0]) ||
    outputCall.arguments[0].text !== control.engineId ||
    !ts.isObjectLiteralExpression(outputCall.arguments[1]) ||
    outputCall.arguments[1].properties.length !== 0 ||
    !ts.isStringLiteralLike(outputCall.arguments[2]) ||
    outputCall.arguments[2].text !== control.inputText
  )
    fail('Expected-empty assertion must be the exact protected literal tool-output control.');
}
export function requireNonemptyCanonicalCase(cases) {
  if (
    !cases.some(
      (item) =>
        item.coveredBranches?.includes('canonical-known-answer') &&
        item.artifacts?.some(
          (artifact) => Number.isSafeInteger(artifact.bytes) && artifact.bytes > 0,
        ),
    )
  )
    fail('Each verified engine requires a meaningful nonempty canonical positive artifact.');
}
async function validateCommandReceipt(root, pin, role, engineId, bindingDigest) {
  const receipt = JSON.parse(await verifyPin(root, pin, { nonempty: true }));
  if (
    receipt.role !== role ||
    receipt.engineId !== engineId ||
    receipt.exitCode !== 0 ||
    receipt.sourceBindingDigest !== bindingDigest
  )
    fail(`Missing/nonzero/stale ${role} receipt for ${engineId}`);
  if (
    !Array.isArray(receipt.command) ||
    receipt.command.length < 2 ||
    receipt.command.some((item) => typeof item !== 'string' || !item)
  )
    fail('Literal executable/argument command is required.');
  if (!Number.isSafeInteger(receipt.caseCount) || receipt.caseCount < 1)
    fail('Zero-case command cannot verify a row.');
  if (
    typeof receipt.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(receipt.startedAt)) ||
    typeof receipt.finishedAt !== 'string' ||
    Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)
  )
    fail('Actual command timing is required.');
  if (role === 'checker' && receipt.owner === receipt.producerOwner)
    fail('Producer and independent checker ownership must differ.');
  if (typeof receipt.owner !== 'string' || !receipt.owner) fail('Command owner is required.');
  await verifyPin(root, receipt.log, { nonempty: true });
  for (const item of receipt.commandSourcePins ?? [])
    await verifyPin(root, item, { nonempty: true });
  if (!receipt.commandSourcePins?.length)
    fail('Actual executable/check script source pins required.');
  return receipt;
}
export function sourceBindingDigest(binding) {
  return sha(JSON.stringify(binding));
}
export function requiredBranchKeys(tool, engine) {
  const branches = ['canonical-known-answer'];
  for (const [key, field] of Object.entries(tool.paramSchema ?? {})) {
    for (const option of field.options ?? [])
      branches.push(`parameter:${key}=${JSON.stringify(option.value)}`);
  }
  for (const index of engine.oracle.selectedSourceCaseIndexes)
    branches.push(`source-case:${index}`);
  for (const index of engine.oracle.expectedFixtureIndexes)
    branches.push(`declared-fixture:${index}`);
  const surfaces = tool.surfaces ?? ['web', 'cli', 'mcp'];
  if (surfaces.includes('cli') || surfaces.includes('mcp')) {
    for (const format of ['esm', 'cjs'])
      for (const runtime of ['current', 'node22.13']) branches.push(`packed:${format}:${runtime}`);
    for (const surface of ['cli', 'mcp'])
      if (surfaces.includes(surface)) branches.push(`adapter:${surface}:typed-params`);
  }
  if (surfaces.includes('web'))
    branches.push('browser:genuine-production:desktop', 'browser:genuine-production:mobile');
  return [...new Set(branches)].sort();
}
const source9BrowserPath = 'packages/web/test/catalog-baseline-browser.test.ts';
const source9BrowserCurrent = Object.freeze({ path: source9BrowserPath, bytes: 25469,
  sha256: '18b2025417b61078527450f5966313332e059b01afb1d3a55e43fd40113bbf60' });
const source9BrowserHistorical = Object.freeze({ path: source9BrowserPath, bytes: 25345,
  sha256: 'd5ee9f3d5a0f1550de0d6c2fef5d1490cf56ec81f7dac60e4e562883083c73a5' });
const source9BrowserCases = Object.freeze([
  ['stopwatch', '5b89ae0daf353d18cd209e484df256a73a62e83f48b2451cba3a283d75c356ae'],
  ['countdown-timer', '35c01c88472dafa3aa6ea0d4135299682f6a365e1a4b638660948c330cd60274'],
  ['wedding-seating-chart-builder', '1856c720ffbbe97997cbe7510dda962f837120c5deb0112f0e8fcc1d59cdf801'],
  ['gamepad-tester', '2508c3844359a13a2fff2e85acf81ed9795db6968746b6969170d9dd44954a75'],
  ['touchscreen-dead-zone-tester', 'c5e7149b92640f34ab67af17873da9d03462d9b37bcfb52b562b98f9d0a2136e'],
  ['mp3-to-midi', '1c41158b2fbdf0b6df54323659f1765665a98f18c41ede85ee582a149b498ac0'],
]);
async function source9BrowserAuthorityBridge(root, authority, oracles, engine) {
  if (sha(JSON.stringify(oracles.executableFixtures?.slice(0, 181))) !==
      '2486316ec7eaa544fec64ad64c13797b190320d5a7e9c3899a7644e96e43765f')
    fail('Browser fixture original181 authority changed.');
  await verifyPin(root, source9BrowserCurrent, { nonempty: true });
  const candidates = await protectedBrowserFixtures(root);
  if (candidates.length !== 6 || !isDeepStrictEqual(candidates.map((item) => [item.key, item.engineId]),
      source9BrowserCases.map(([id]) => [`browser-fixed-${id}`, id])))
    fail('Browser fixture fixed six-source roster differs.');
  let selected;
  for (const [offset, [id, bodySha]] of source9BrowserCases.entries()) {
    const sealed = oracles.executableFixtures[102 + offset], candidate = candidates[offset];
    if (sealed?.key !== `browser-fixed-${id}` || sealed.engineId !== id ||
        sealed.qualificationKind !== 'genuine browser fixed independent control' ||
        candidate.qualificationKind !== sealed.qualificationKind ||
        !isDeepStrictEqual(sealed.sourceCaseBinding?.sourcePin, source9BrowserHistorical) ||
        !isDeepStrictEqual(sealed.authorityPins?.[0], source9BrowserHistorical) ||
        !isDeepStrictEqual(candidate.sourceCaseBinding?.sourcePin, source9BrowserCurrent) ||
        !isDeepStrictEqual(candidate.authorityPins?.[0], source9BrowserCurrent) ||
        sealed.sourceCaseBinding.exactCaseBodySha256 !== bodySha ||
        candidate.sourceCaseBinding.exactCaseBodySha256 !== bodySha ||
        sha(sealed.sourceCaseBinding.exactCaseBody) !== bodySha ||
        sha(candidate.sourceCaseBinding.exactCaseBody) !== bodySha)
      fail('Browser fixture fixed source/case authority differs.');
    const projectedCandidate = structuredClone(candidate);
    projectedCandidate.sourceCaseBinding.sourcePin = { ...source9BrowserHistorical };
    projectedCandidate.authorityPins[0] = { ...source9BrowserHistorical };
    if (!isDeepStrictEqual(projectedCandidate, sealed))
      fail('Browser fixture differs from its complete original input/source/property authority.');
    if (authority.key === sealed.key) {
      if (engine.id !== id || !isDeepStrictEqual(authority, sealed))
        fail('Browser fixture must equal its complete sealed authority at the fixed index.');
      selected = { kind: 'source9-binding-failure-cleanup-bridge-v1', oracleKey: sealed.key, engineId: id,
        currentSource: { ...source9BrowserCurrent }, expectedAuthoritySource: { ...source9BrowserHistorical },
        sourceCaseBodySha256: bodySha, projectionFields: ['sourceCaseBinding.sourcePin', 'authorityPins[0]'] };
    }
  }
  if (!selected) fail('Browser fixture key is outside the fixed six SOURCE9 records.');
  return selected;
}
export async function checkBrowserAuthorityCommandPins(root, producer, manifest, descriptor) {
  if (descriptor?.kind !== 'source9-binding-failure-cleanup-bridge-v1')
    fail('Browser fixture bridge descriptor is required.');
  const paths = [source9BrowserPath, 'packages/web/test/productionBrowserHarness.ts',
    'packages/web/test/productionBuildBindingObserver.mjs'];
  if (!Array.isArray(manifest.commandSourcePins) || manifest.commandSourcePins.length !== 3 ||
      !isDeepStrictEqual(manifest.commandSourcePins.map((item) => item.path), paths) ||
      !Array.isArray(producer.commandSourcePins) || producer.commandSourcePins.length !== 4 ||
      !isDeepStrictEqual(producer.commandSourcePins.map((item) => item.path), ['tools/catalog-baseline-producers.mjs', ...paths]) ||
      !isDeepStrictEqual(producer.commandSourcePins.slice(1), manifest.commandSourcePins) ||
      !isDeepStrictEqual(manifest.commandSourcePins[0], source9BrowserCurrent) ||
      !isDeepStrictEqual(producer.commandSourcePins[1], source9BrowserCurrent) ||
      !isDeepStrictEqual(descriptor.currentSource, source9BrowserCurrent))
    fail('Browser fixture verified manifest3/producer4 command source pins differ.');
  for (const item of [...manifest.commandSourcePins, ...producer.commandSourcePins]) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.getPrototypeOf(item) !== Object.prototype ||
        !isDeepStrictEqual(Object.keys(item).sort(), ['bytes', 'path', 'sha256']))
      fail('Browser command source pin must be a closed portable path/bytes/sha256 record.');
  }
  for (const item of manifest.commandSourcePins) await verifyPin(root, item, { nonempty: true });
  await verifyPin(root, producer.commandSourcePins[0], { nonempty: true });
}
export async function boundFixtureOracle(root, authority, oracles, engine) {
  if (authority.qualificationKind === 'group A31 source-bound fixture') {
    const candidates = await validateGroupA31Catalog(root, oracles);
    if (authority.engineId !== engine.id || !candidates.some((candidate) => isDeepStrictEqual(candidate, authority)))
      fail('Group A31 fixture differs from its complete original/public/source authority.');
    return;
  }
  if (authority.qualificationKind === 'group B2 C6 source-bound fixture') {
    const candidates = await validateGroupBCCatalog(root, oracles);
    if (authority.engineId !== engine.id || !candidates.some((candidate) => isDeepStrictEqual(candidate, authority)))
      fail('Group BC fixture differs from its complete original/public/source authority.');
    return;
  }
  if (authority.qualificationKind === 'supplemental source-bound fixture') {
    const candidates = await validateSupplementalCatalog(root, oracles);
    if (
      authority.engineId !== engine.id ||
      !candidates.some((candidate) => isDeepStrictEqual(candidate, authority))
    )
      fail('Supplemental fixture differs from its actual public run/source/literal authority.');
    return;
  }
  if (authority.qualificationKind === 'supplemental original public names property control') {
    const fixtures = await protectedNameModuleFixtures(root, oracles);
    if (
      authority.engineId !== engine.id ||
      !fixtures.some((fixture) => isDeepStrictEqual(fixture, authority))
    )
      fail('Protected public names fixture differs from actual module/source/property authority.');
    return;
  }
  if (authority.qualificationKind === 'additional exact protected planning vector') {
    const candidates = await protectedPlanningCaseCandidates(root, oracles, engine);
    if (
      !candidates.some(
        (candidate) =>
          isDeepStrictEqual(candidate.binding, authority.sourceCaseBinding) &&
          isDeepStrictEqual(candidate.params, authority.params) &&
          isDeepStrictEqual(candidate.oracle, {
            kind: authority.artifactOracles?.[0]?.kind,
            expected: authority.artifactOracles?.[0]?.expected,
            ...(authority.artifactOracles?.[0]?.absoluteTolerance === undefined
              ? {}
              : { absoluteTolerance: authority.artifactOracles[0].absoluteTolerance }),
          }) &&
          authority.artifactOracles.length === 1 &&
          authority.inputs.length === 0 &&
          isDeepStrictEqual(authority.authorityPins, [candidate.binding.sourcePin]),
      )
    )
      fail('Protected planning fixture differs from actual input/expected authority.');
    return;
  }
  if (authority.qualificationKind === 'genuine browser fixed independent control') {
    return source9BrowserAuthorityBridge(root, authority, oracles, engine);
  }
  if (authority.qualificationKind === 'additional exact protected text vector') {
    const candidates = await protectedTextCaseCandidates(root, oracles, engine);
    if (
      !authority.sourceCaseBinding ||
      !candidates.some(
        (candidate) =>
          isDeepStrictEqual(candidate.binding, authority.sourceCaseBinding) &&
          isDeepStrictEqual(candidate.params, authority.params) &&
          candidate.text === authority.inputs?.[0]?.text &&
          authority.inputs.length === 1 &&
          isDeepStrictEqual(candidate.oracle, {
            kind: authority.artifactOracles?.[0]?.kind,
            expected: authority.artifactOracles?.[0]?.expected,
          }) &&
          authority.artifactOracles.length === 1 &&
          isDeepStrictEqual(authority.authorityPins, [candidate.binding.sourcePin]),
      )
    )
      fail(
        'Additional text fixture differs from its protected source case input/expected authority.',
      );
    return;
  }
  if (
    authority.toolOutputControl ||
    authority.artifactOracles?.some((oracle) => oracle.expectedEmptyControl)
  ) {
    if (
      authority.artifactOracles.length !== 1 ||
      !engine.oracle.selectedSourceCaseIndexes.includes(authority.sourceCaseIndex)
    )
      fail('Expected-empty fixture must bind its actual selected source case.');
    const oracle = authority.artifactOracles[0];
    if (oracle.kind !== 'text-exact')
      fail('Protected literal tool output needs its exact text oracle.');
    const control = authority.toolOutputControl ?? oracle.expectedEmptyControl;
    await validateProtectedToolOutputControl(root, control, oracle.expected);
    if (oracle.expected === '') {
      assert.deepEqual(oracle.expectedEmptyControl, control);
      await qualifiesExpectedEmptyArtifact(root, oracle);
    }
    const sourceCase = oracles.sourceCaseCatalog[authority.sourceCaseIndex];
    if (
      !sourceCase ||
      sourceCase.source !== control.sourcePin.path ||
      sourceCase.sourceSha256 !== control.sourcePin.sha256 ||
      !sourceCase.exactCaseBody.includes(control.assertionExpression) ||
      engine.id !== control.engineId
    )
      fail('Expected-empty source case/engine authority differs from the protected catalog.');
    assert.deepEqual(authority.params, control.params);
    assert.deepEqual(authority.inputs, [
      { name: 'fixed.txt', mime: 'text/plain', text: control.inputText },
    ]);
    assert.deepEqual(authority.authorityPins, [control.sourcePin]);
    return;
  }
  if (
    !Number.isSafeInteger(authority.fixtureIndex) ||
    !engine.oracle.expectedFixtureIndexes.includes(authority.fixtureIndex)
  )
    fail('Executable fixture must belong to this actual row/engine authority.');
  const fixture = oracles.declaredFixtureCatalog[authority.fixtureIndex];
  if (
    !fixture ||
    fixture.engineId !== engine.id ||
    authority.key !== `declared-fixture-${authority.fixtureIndex}`
  )
    fail('Executable oracle fixture identity mismatch.');
  const sourceBytes = await readOwned(root, fixture.source);
  if (
    sha(sourceBytes) !== fixture.sourceSha256 ||
    !sourceBytes.toString('utf8').includes(fixture.exactFixtureBody)
  )
    fail('Independent literal fixture body/source is stale or substituted.');
  const ts = createRequire(path.join(root, 'package.json'))('typescript');
  const ast = ts.createSourceFile(
    'expected.ts',
    `(${fixture.expectedExpression});`,
    ts.ScriptTarget.Latest,
    true,
  );
  if (ast.parseDiagnostics.length || !ts.isExpressionStatement(ast.statements[0]))
    fail('Malformed independent literal fixture.');
  function literal(node) {
    if (ts.isParenthesizedExpression(node)) return literal(node.expression);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand)
    )
      return -Number(node.operand.text);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isObjectLiteralExpression(node)) {
      const value = {};
      for (const item of node.properties) {
        if (
          !ts.isPropertyAssignment(item) ||
          !(ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name))
        )
          fail('Independent expected record must be literal data.');
        if (['__proto__', 'prototype', 'constructor'].includes(item.name.text))
          fail('Unsafe independent literal key.');
        value[item.name.text] = literal(item.initializer);
      }
      return value;
    }
    fail('Independent fixture expects literal data; no eval/producer-derived expected fallback.');
  }
  if (authority.artifactOracles.length !== 1 || authority.artifactOracles[0].kind !== 'json-fields')
    fail('Declared scalar fixture requires its independent JSON field oracle.');
  assert.deepEqual(
    authority.artifactOracles[0].expected,
    literal(ast.statements[0].expression),
    'Executable expected values must match the protected independent literal fixture.',
  );
  const tolerance =
    fixture.source.endsWith('/building.test.ts') || fixture.source.endsWith('/hardware.test.ts')
      ? 1e-9
      : undefined;
  assert.equal(
    authority.artifactOracles[0].relativeTolerance,
    tolerance,
    'Tolerance must match the original independent source authority.',
  );
}
export async function protectedBrowserFixtures(root) {
  const source = 'packages/web/test/catalog-baseline-browser.test.ts';
  const bytes = await readOwned(root, source);
  const sourcePin = { path: source, bytes: bytes.length, sha256: sha(bytes) };
  const ts = createRequire(import.meta.url)('typescript');
  const ast = ts.createSourceFile(
    'browser-controls.ts',
    bytes.toString('utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  if (ast.parseDiagnostics.length) fail('Actual browser control source is invalid.');
  const cases = new Map();
  function walk(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'it' &&
      ts.isArrowFunction(node.arguments[1])
    ) {
      const body = node.arguments[1].body;
      let id;
      function findPage(child) {
        if (
          ts.isCallExpression(child) &&
          ts.isIdentifier(child.expression) &&
          child.expression.text === 'pageFor' &&
          ts.isStringLiteralLike(child.arguments[0])
        )
          id = child.arguments[0].text;
        ts.forEachChild(child, findPage);
      }
      findPage(body);
      if (id) cases.set(id, { node, body });
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  function literal(node) {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken)
      return -literal(node.operand);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isObjectLiteralExpression(node))
      return Object.fromEntries(
        node.properties.map((property) => {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name))
            throw new Error('Nonliteral browser property.');
          return [property.name.text, literal(property.initializer)];
        }),
      );
    throw new Error('Browser expected value is not literal data.');
  }
  async function pin(relative) {
    const data = await readOwned(root, relative);
    return { path: relative, bytes: data.length, sha256: sha(data) };
  }
  const fixtures = [];
  for (const [engineId, inputPath] of [
    ['stopwatch', 'packages/core/test/fixtures/planning-stopwatch-session.json'],
    ['countdown-timer', 'packages/core/test/fixtures/planning-countdown-session.json'],
    ['wedding-seating-chart-builder', 'packages/core/test/fixtures/planning-seating-plan.json'],
    ['gamepad-tester', null],
    ['touchscreen-dead-zone-tester', null],
    ['mp3-to-midi', 'packages/core/test/fixtures/catalog-files/melody-220-440.mp3'],
  ]) {
    const sourceCase = cases.get(engineId);
    if (!sourceCase) fail(`Actual genuine browser control absent: ${engineId}`);
    const expectations = [];
    const declarations = new Map();
    function collect(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
        declarations.set(node.name.text, node.initializer);
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ['toEqual', 'toMatchObject'].includes(node.expression.name.text) &&
        node.arguments.length === 1
      ) {
        try {
          const expected = node.arguments[0];
          const value = literal(
            ts.isIdentifier(expected) ? declarations.get(expected.text) : expected,
          );
          if (value && !Array.isArray(value) && typeof value === 'object') expectations.push(value);
        } catch {
          /* Nonliteral assertions remain in the original genuine browser test. */
        }
      }
      ts.forEachChild(node, collect);
    }
    collect(sourceCase.body);
    let artifactOracles;
    const authority = `${source}: ${engineId} actual fixed independent browser assertions and original input`;
    if (engineId === 'stopwatch')
      artifactOracles = [{ kind: 'json-fields', expected: expectations[0], authority }];
    if (engineId === 'countdown-timer')
      artifactOracles = expectations
        .slice(0, 2)
        .map((expected) => ({ kind: 'json-fields', expected, authority }));
    if (engineId === 'wedding-seating-chart-builder')
      artifactOracles = [
        { kind: 'json-fields', expected: expectations[0], authority },
        {
          kind: 'text-exact',
          expected:
            '"guestId","guest","tableId","table"\r\n"guest1","Alex","table1","Friends"\r\n"guest2","Alex","","Unassigned"',
          authority: `${authority}; independent fixed guest/reference records and reviewed RFC4180 quoted CSV header/order/unassigned contract`,
        },
      ];
    if (engineId === 'gamepad-tester')
      artifactOracles = [
        { kind: 'json-fields', expected: { devices: [expectations[0]] }, authority },
      ];
    if (engineId === 'touchscreen-dead-zone-tester')
      artifactOracles = [
        { kind: 'json-fields', expected: expectations[0], authority },
        { kind: 'json-fields', expected: expectations[0], authority, equivalentArtifactIndex: 0 },
      ];
    if (engineId === 'mp3-to-midi')
      artifactOracles = [
        { kind: 'pitch-original-melody', authority },
        { kind: 'midi-original-melody', authority },
      ];
    const inputPins = inputPath ? [await pin(inputPath)] : [];
    if (engineId === 'mp3-to-midi')
      inputPins.push(await pin('packages/core/test/fixtures/catalog-files/mp3-provenance.md'));
    fixtures.push({
      key: `browser-fixed-${engineId}`,
      engineId,
      surface: 'web',
      qualificationKind: 'genuine browser fixed independent control',
      sourceCaseBinding: {
        sourcePin,
        exactCaseBody: sourceCase.node.getText(ast),
        exactCaseBodySha256: sha(sourceCase.node.getText(ast)),
      },
      authorityPins: [sourcePin, ...inputPins],
      originalInputPins: inputPins,
      artifactOracles,
      scope:
        'Fixed genuine browser workflow only; hardware controls are exposed-API software tests. Other states/mobile/package/current integrated SOURCE and physical devices remain pending.',
    });
  }
  return fixtures;
}
export async function checkFixtureArtifacts(root, artifacts, authority) {
  if (!Array.isArray(artifacts) || artifacts.length !== authority.artifactOracles.length)
    fail('Complete emitted artifact list differs from independent fixture authority.');
  for (const [index, artifact] of artifacts.entries()) {
    const oracle = authority.artifactOracles[index];
    if (oracle.mime !== undefined && artifact.mime !== oracle.mime)
      fail('Artifact MIME differs from its ordered independent authority.');
    await checkArtifact(root, artifact, oracle);
    if (oracle.equivalentArtifactIndex !== undefined) {
      if (
        !Number.isSafeInteger(oracle.equivalentArtifactIndex) ||
        oracle.equivalentArtifactIndex < 0 ||
        oracle.equivalentArtifactIndex >= index
      )
        fail('Invalid artifact equivalence control.');
      assert.deepEqual(
        await verifyPin(root, artifact),
        await verifyPin(root, artifacts[oracle.equivalentArtifactIndex]),
        'Full sealed-session bytes changed.',
      );
    }
  }
}

export async function protectedSupplementalFixtures(root) {
  const source = 'packages/core/test/catalog-fixture-completion.test.ts';
  const bytes = await readOwned(root, source);
  const sourcePin = { path: source, bytes: bytes.length, sha256: sha(bytes) };
  const ts = createRequire(path.join(root, 'package.json'))('typescript');
  const parse = (name, content) => {
    const ast = ts.createSourceFile(name, content, ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) fail('Supplemental source parse refused.');
    return ast;
  };
  const whole = parse(source, bytes.toString('utf8'));
  const symbols = {
    romanNumeral: 'roman-numeral',
    htmlMinify: 'html-minify',
    cssMinify: 'css-minify',
    yamlValidate: 'yaml-validate',
    colorHarmony: 'color-harmony',
  };
  const names = [
    'roman-encode',
    'roman-decode',
    'html-remove-comments',
    'html-preserve-comments',
    'css-level-one',
    'yaml-core',
    'yaml-json',
    'yaml-failsafe',
    'harmony-black',
    'harmony-red-partial',
  ];
  const indexPath = 'packages/core/src/index.ts';
  const indexBytes = await readOwned(root, indexPath);
  const indexPin = { path: indexPath, bytes: indexBytes.length, sha256: sha(indexBytes) };
  const indexAst = parse(indexPath, indexBytes.toString('utf8'));
  const owners = new Map();
  function unwrap(node) {
    while (
      node &&
      (ts.isAsExpression(node) ||
        ts.isParenthesizedExpression(node) ||
        ts.isNonNullExpression(node))
    )
      node = node.expression;
    return node;
  }
  function literal(node) {
    node = unwrap(node);
    if (!node) fail('Supplemental literal missing.');
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node) && Number.isFinite(Number(node.text))) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isObjectLiteralExpression(node)) {
      const value = {};
      for (const property of node.properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          !(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
        )
          fail('Supplemental object must contain literal properties.');
        const key = property.name.text;
        if (['__proto__', 'prototype', 'constructor'].includes(key) || Object.hasOwn(value, key))
          fail('Supplemental literal key refused.');
        value[key] = literal(property.initializer);
      }
      return value;
    }
    fail('Supplemental expectation/input must be literal data.');
  }
  for (const [symbol, id] of Object.entries(symbols)) {
    const imports = whole.statements.filter(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        statement.moduleSpecifier.text === '../src/index.js' &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (item) => !item.propertyName && item.name.text === symbol,
        ),
    );
    const exports = indexAst.statements.filter(
      (statement) =>
        ts.isExportDeclaration(statement) &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause) &&
        statement.moduleSpecifier?.text === `./tools/${id}/index.js` &&
        statement.exportClause.elements.some(
          (item) => !item.propertyName && item.name.text === symbol,
        ),
    );
    if (imports.length !== 1 || exports.length !== 1)
      fail('Supplemental named public import/export edge refused.');
    const toolPath = `packages/core/src/tools/${id}/index.ts`;
    const toolBytes = await readOwned(root, toolPath);
    const toolAst = parse(toolPath, toolBytes.toString('utf8'));
    const declarations = toolAst.statements
      .flatMap((statement) =>
        ts.isVariableStatement(statement) &&
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
          ? [...statement.declarationList.declarations]
          : [],
      )
      .filter((item) => ts.isIdentifier(item.name) && item.name.text === symbol);
    const object = unwrap(declarations[0]?.initializer);
    if (declarations.length !== 1 || !object || !ts.isObjectLiteralExpression(object))
      fail('Supplemental public ToolModule declaration refused.');
    const ids = object.properties.filter(
      (property) => ts.isPropertyAssignment(property) && property.name.getText(toolAst) === 'id',
    );
    if (
      ids.length !== 1 ||
      literal(ids[0].initializer) !== id ||
      !object.properties.some(
        (property) => ts.isMethodDeclaration(property) && property.name.getText(toolAst) === 'run',
      )
    )
      fail('Supplemental ToolModule id/run edge refused.');
    owners.set(symbol, {
      id,
      pin: { path: toolPath, bytes: toolBytes.length, sha256: sha(toolBytes) },
    });
  }
  function identifier(node, name) {
    return node && ts.isIdentifier(node) && node.text === name;
  }
  function call(node, owner, method) {
    return (
      node &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      identifier(node.expression.expression, owner) &&
      node.expression.name.text === method
    );
  }
  function outputIndex(node) {
    node = unwrap(node);
    if (!node || !ts.isElementAccessExpression(node) || !identifier(node.expression, 'outputs'))
      fail('Supplemental output assertion must read the actual run output.');
    const index = literal(node.argumentExpression);
    if (!Number.isSafeInteger(index) || index < 0 || index > 1)
      fail('Supplemental output index refused.');
    return index;
  }
  for (const statement of whole.statements) {
    if (ts.isImportDeclaration(statement)) {
      const module = statement.moduleSpecifier.text;
      const names = statement.importClause?.namedBindings;
      const allowed =
        module === 'vitest'
          ? ['it', 'expect']
          : module === '../src/index.js'
            ? [...Object.keys(symbols), 'ToolRunContext']
            : [];
      if (
        !names ||
        !ts.isNamedImports(names) ||
        statement.importClause.name ||
        names.elements.some((item) => item.propertyName || !allowed.includes(item.name.text))
      )
        fail('Supplemental source imports must be the named public tools and assertions.');
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations[0];
      const context = declaration?.initializer;
      const object = context && ts.isArrowFunction(context) ? unwrap(context.body) : null;
      if (
        !(statement.declarationList.flags & ts.NodeFlags.Const) ||
        statement.declarationList.declarations.length !== 1 ||
        !identifier(declaration.name, 'context') ||
        !object ||
        !ts.isObjectLiteralExpression(object) ||
        context.parameters.length ||
        context.modifiers?.length ||
        object.properties.length !== 4
      )
        fail('Supplemental source permits only its standard context outside cases.');
      const props = new Map(object.properties.map((item) => [item.name?.getText(whole), item]));
      const signal = props.get('signal')?.initializer;
      const cache = props.get('cache')?.initializer;
      const progress = props.get('onProgress');
      if (
        props.size !== 4 ||
        !signal ||
        !ts.isPropertyAccessExpression(signal) ||
        signal.name.text !== 'signal' ||
        !ts.isNewExpression(signal.expression) ||
        !identifier(signal.expression.expression, 'AbortController') ||
        signal.expression.arguments?.length ||
        !cache ||
        !ts.isNewExpression(cache) ||
        !identifier(cache.expression, 'Map') ||
        cache.arguments?.length ||
        literal(props.get('executionId')?.initializer) !== 'supplemental-independent-literals' ||
        !progress ||
        !ts.isMethodDeclaration(progress) ||
        progress.parameters.length ||
        !progress.body ||
        progress.body.statements.length
      )
        fail('Supplemental standard signal/progress context refused.');
      continue;
    }
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isCallExpression(statement.expression) ||
      !identifier(statement.expression.expression, 'it')
    )
      fail('Supplemental source refuses extra executable statements/helpers.');
  }
  const candidates = [];
  for (const statement of whole.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression))
      continue;
    const test = statement.expression;
    if (
      !identifier(test.expression, 'it') ||
      test.arguments.length !== 2 ||
      !ts.isStringLiteral(test.arguments[0])
    )
      fail('Supplemental case registration refused.');
    const label = test.arguments[0].text;
    const key = label.startsWith('supplemental ') ? label.slice(13) : '';
    const body = test.arguments[1];
    if (
      !names.includes(key) ||
      candidates.some((item) => item.key === `supplemental-${key}`) ||
      !ts.isArrowFunction(body) ||
      !body.modifiers?.some((item) => item.kind === ts.SyntaxKind.AsyncKeyword) ||
      !ts.isBlock(body.body)
    )
      fail('Supplemental named async case refused.');
    const statements = [...body.body.statements];
    const declarations = statements.slice(0, 3).map((item, index) => {
      if (
        !ts.isVariableStatement(item) ||
        !(item.declarationList.flags & ts.NodeFlags.Const) ||
        item.declarationList.declarations.length !== 1
      )
        fail('Supplemental immutable run inputs refused.');
      const declaration = item.declarationList.declarations[0];
      if (!identifier(declaration.name, ['inputs', 'params', 'outputs'][index]))
        fail('Supplemental run declaration refused.');
      return declaration.initializer;
    });
    const inputArray = declarations[0];
    if (!inputArray || !ts.isArrayLiteralExpression(inputArray))
      fail('Supplemental literal input array required.');
    const inputs = inputArray.elements.map((node) => {
      if (
        !ts.isNewExpression(node) ||
        !identifier(node.expression, 'File') ||
        node.arguments?.length !== 3
      )
        fail('Supplemental input must be a literal File.');
      const [parts, name, options] = node.arguments;
      if (!ts.isArrayLiteralExpression(parts) || parts.elements.length !== 1)
        fail('Supplemental File payload refused.');
      const text = literal(parts.elements[0]),
        filename = literal(name),
        opts = literal(options);
      if (
        typeof text !== 'string' ||
        typeof filename !== 'string' ||
        !filename ||
        Object.keys(opts).join(',') !== 'type' ||
        typeof opts.type !== 'string'
      )
        fail('Supplemental File identity refused.');
      return { name: filename, mime: opts.type, text };
    });
    const params = literal(declarations[1]);
    const awaited = declarations[2];
    const run = awaited && ts.isAwaitExpression(awaited) ? awaited.expression : null;
    const symbol =
      run &&
      ts.isCallExpression(run) &&
      ts.isPropertyAccessExpression(run.expression) &&
      ts.isIdentifier(run.expression.expression)
        ? run.expression.expression.text
        : '';
    const expectedSymbol = key.startsWith('roman-')
      ? 'romanNumeral'
      : key.startsWith('html-')
        ? 'htmlMinify'
        : key.startsWith('css-')
          ? 'cssMinify'
          : key.startsWith('yaml-')
            ? 'yamlValidate'
            : 'colorHarmony';
    if (
      symbol !== expectedSymbol ||
      !owners.has(symbol) ||
      !call(run, symbol, 'run') ||
      run.arguments.length !== 3 ||
      !identifier(run.arguments[0], 'inputs') ||
      !identifier(run.arguments[1], 'params') ||
      !ts.isCallExpression(run.arguments[2]) ||
      !identifier(run.arguments[2].expression, 'context') ||
      run.arguments[2].arguments.length
    )
      fail('Supplemental actual public run provenance refused.');
    const guard = statements[3];
    if (
      !guard ||
      !ts.isIfStatement(guard) ||
      guard.elseStatement ||
      !ts.isPrefixUnaryExpression(guard.expression) ||
      guard.expression.operator !== ts.SyntaxKind.ExclamationToken ||
      !call(guard.expression.operand, 'Array', 'isArray') ||
      guard.expression.operand.arguments.length !== 1 ||
      !identifier(guard.expression.operand.arguments[0], 'outputs') ||
      !ts.isThrowStatement(guard.thenStatement) ||
      !ts.isNewExpression(guard.thenStatement.expression) ||
      !identifier(guard.thenStatement.expression.expression, 'Error') ||
      guard.thenStatement.expression.arguments?.length !== 1 ||
      literal(guard.thenStatement.expression.arguments[0]) !== 'Expected ordered outputs.'
    )
      fail('Supplemental output array guard refused.');
    let count;
    const mimes = new Map(),
      values = new Map();
    for (const assertion of statements.slice(4)) {
      const outer = ts.isExpressionStatement(assertion) ? assertion.expression : null;
      if (
        !outer ||
        !ts.isCallExpression(outer) ||
        outer.arguments.length !== 1 ||
        !ts.isPropertyAccessExpression(outer.expression)
      )
        fail('Supplemental literal assertion refused.');
      const expect = outer.expression.expression;
      if (
        !ts.isCallExpression(expect) ||
        !identifier(expect.expression, 'expect') ||
        expect.arguments.length !== 1
      )
        fail('Supplemental assertion must inspect the actual output.');
      const actual = expect.arguments[0],
        matcher = outer.expression.name.text;
      if (identifier(actual, 'outputs') && matcher === 'toHaveLength' && count === undefined) {
        count = literal(outer.arguments[0]);
      } else if (
        ts.isPropertyAccessExpression(actual) &&
        actual.name.text === 'type' &&
        matcher === 'toBe'
      ) {
        const index = outputIndex(actual.expression);
        if (mimes.has(index)) fail('Supplemental duplicate MIME assertion.');
        mimes.set(index, literal(outer.arguments[0]));
      } else {
        const json = call(actual, 'JSON', 'parse');
        const text = json && actual.arguments.length === 1 ? actual.arguments[0] : actual;
        if (
          !ts.isAwaitExpression(text) ||
          !ts.isCallExpression(text.expression) ||
          text.expression.arguments.length ||
          !ts.isPropertyAccessExpression(text.expression.expression) ||
          text.expression.expression.name.text !== 'text'
        )
          fail('Supplemental assertion must read complete actual output text.');
        const index = outputIndex(text.expression.expression.expression);
        if (
          values.has(index) ||
          (json
            ? !['toEqual', 'toStrictEqual', 'toMatchObject'].includes(matcher)
            : matcher !== 'toBe')
        )
          fail('Supplemental output equality assertion refused.');
        const partial = matcher === 'toMatchObject';
        if (
          partial &&
          (key !== 'harmony-red-partial' || symbol !== 'colorHarmony' || params.color !== '#ff0000')
        )
          fail('Supplemental partial predicate is restricted to the named red control.');
        values.set(index, {
          kind: json ? (partial ? 'json-fields' : 'json-exact') : 'text-exact',
          expected: literal(outer.arguments[0]),
          authority: `Supplemental public run independent literal: ${label}`,
        });
      }
    }
    const owner = owners.get(symbol);
    const expectedCount = ['html-minify', 'css-minify'].includes(owner.id) ? 2 : 1;
    if (
      count !== expectedCount ||
      values.size !== count ||
      mimes.size !== count ||
      statements.length !== 5 + count * 2
    )
      fail('Supplemental complete ordered output assertions required.');
    const artifactOracles = Array.from({ length: count }, (_, index) => {
      if (!values.has(index) || typeof mimes.get(index) !== 'string')
        fail('Supplemental output order/MIME refused.');
      return { ...values.get(index), mime: mimes.get(index) };
    });
    candidates.push({
      key: `supplemental-${key}`,
      engineId: owner.id,
      inputs,
      params,
      usesPinnedDefaults: false,
      qualificationKind: 'supplemental source-bound fixture',
      artifactOracles,
      authorityPins: [sourcePin, indexPin, owner.pin],
      sourceCaseBinding: {
        sourcePin,
        caseName: label,
        exactCaseBodySha256: sha(statement.getText(whole)),
        publicSymbol: symbol,
        method: 'run',
        publicExportPin: indexPin,
        toolPin: owner.pin,
      },
      branch:
        key === 'harmony-red-partial'
          ? 'Partial base/complementary field control only; not a complete palette.'
          : 'Complete fixed literal outputs for this input/parameter branch only.',
      pendingBranches:
        'Other modes, refusals, package/browser/current integrated SOURCE remain required; no row promotion.',
    });
  }
  if (
    candidates.length !== names.length ||
    names.some((key) => !candidates.some((item) => item.key === `supplemental-${key}`))
  )
    fail('Supplemental ten-control source set differs.');
  return candidates;
}

async function validateSupplementalCatalog(root, oracles) {
  if (
    sha(JSON.stringify(oracles.sourceCaseCatalog)) !==
      '4b8de77304d87a98fb4e99950d1a26eabaf20c7d5863682cedd643458abccf71' ||
    sha(JSON.stringify(oracles.declaredFixtureCatalog)) !==
      '1341ca083c65d21af34b1189dfc670e67f60a5efa8c29bb3eed78a5be2d2a87e'
  )
    fail('Supplemental authority cannot alter historical902/81 arrays.');
  const candidates = await protectedSupplementalFixtures(root);
  if (!isDeepStrictEqual(oracles.supplementalFixtureAuthorities, candidates))
    fail('Supplemental authority catalog differs from its exact unique source records.');
  return candidates;
}

export async function protectedGroupA31Fixtures(root, oracles) {
  const definitions = [
    ['number-to-words-converter', null, 52, 'json-fields', ['words']],
    ['chmod-calculator', null, 60, 'json-exact'],
    ['cron-from-text', 'cronFromText', 616, 'json-fields', ['nextRuns']],
    ['utm-link-builder', null, 61, 'json-fields', ['url']],
    ['px-to-rem-converter', null, 66, 'json-exact'],
    ['ip-subnet-calc', 'ipSubnetCalc', 105, 'json-fields', ['network', 'inputIsNetworkAddress']],
    ['unit-converter', 'unitConverter', 868, 'json-fields', ['valid', 'result']],
    ['case-converter', 'caseConverter', 394, 'text-exact'],
    ['slug', 'slug', 440, 'text-exact'],
    ['markdown-table-generator', null, 55, 'text-exact'],
    ['bulk-meta-description-generator', null, 57, 'text-exact'],
    ['javascript-minifier', null, 58, 'text-exact'],
    ['url-encoder', 'urlEncoder', 555, 'text-exact'],
    ['timestamp-converter', 'timestampConverter', 563, 'json-fields', ['valid', 'epochSeconds', 'epochMilliseconds']],
    ['jwt-decoder', 'jwtDecoder', 573, 'json-fields', ['valid', 'header.alg', 'header.typ', 'payload.sub', 'payload.name']],
    ['css-formatter', 'cssFormatter', 672, 'text-exact'],
    ['xml-formatter', 'xmlFormatter', 583, 'text-exact'],
    ['text-escape', 'textEscape', 666, 'text-exact'],
    ['json-yaml', 'jsonYaml', 714, 'json-exact'],
    ['base64', 'base64', 493, 'text-exact'],
    ['csv-json', 'csvJson', 703, 'text-exact'],
    ['robots-txt-generator', null, 59, 'text-exact'],
    ['csp-header-generator', null, 62, 'text-exact'],
    ['hreflang-tag-generator', null, 63, 'text-exact'],
    ['nginx-redirect-generator', null, 64, 'text-exact'],
    ['color-converter', 'colorConverter', 753, 'json-fields', ['valid', 'hex', 'rgb.r', 'rgb.g', 'rgb.b']],
    ['css-gradient-generator', null, 65, 'json-fields', ['css']],
    ['compound-interest', 'compoundInterest', 86, 'json-fields', ['finalBalance']],
    ['percentage-calculator', 'percentageCalculator', 850, 'json-fields', ['valid', 'result']],
    ['date-calculator', 'dateCalculator', 356, 'json-fields', ['valid', 'dayName']],
    ['csv-viewer', 'csvViewer', null, 'text-exact'],
  ];
  if (sha(JSON.stringify(oracles.sourceCaseCatalog)) !== '4b8de77304d87a98fb4e99950d1a26eabaf20c7d5863682cedd643458abccf71'
    || sha(JSON.stringify(oracles.declaredFixtureCatalog)) !== '1341ca083c65d21af34b1189dfc670e67f60a5efa8c29bb3eed78a5be2d2a87e')
    fail('Group A31 cannot alter historical902/81 authorities.');
  const ts = createRequire(path.join(root, 'package.json'))('typescript');
  const cache = new Map();
  const parse = (name, text) => {
    const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) fail('Group A31 source parse refused.');
    return ast;
  };
  async function source(relative) {
    if (!cache.has(relative)) {
      const bytes = await readOwned(root, relative);
      cache.set(relative, { bytes, ast: parse(relative, bytes.toString('utf8')),
        pin: { path: relative, bytes: bytes.length, sha256: sha(bytes) } });
    }
    return cache.get(relative);
  }
  function unwrap(node) {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
      || ts.isNonNullExpression(node) || ts.isAwaitExpression(node))) node = node.expression;
    return node;
  }
  const id = (node, name) => node && ts.isIdentifier(node) && node.text === name;
  const call = (node, owner, member) => node && ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression) && id(node.expression.expression, owner)
    && node.expression.name.text === member;
  function nodes(node, predicate, skipLoops = false) {
    const result = [];
    function visit(value) {
      if (skipLoops && (ts.isForOfStatement(value) || ts.isForStatement(value) || ts.isForInStatement(value)
        || ts.isWhileStatement(value) || ts.isDoStatement(value))) return;
      if (predicate(value)) result.push(value);
      ts.forEachChild(value, visit);
    }
    visit(node); return result;
  }
  function declarations(ast) {
    return ast.statements.flatMap((statement) => ts.isVariableStatement(statement)
      ? [...statement.declarationList.declarations] : []);
  }
  function named(ast, name) {
    const found = [...declarations(ast).filter((node) => id(node.name, name)),
      ...ast.statements.filter((node) => ts.isFunctionDeclaration(node) && id(node.name, name))];
    if (found.length !== 1) fail(`Group A31 unique declaration refused: ${name}`);
    return found[0];
  }
  function span(node, ast) {
    const text = node.getText(ast);
    return { bytes: Buffer.byteLength(text), sha256: sha(text), expression: text };
  }
  function environment(ast, body) {
    const result = new Map();
    const add = (declaration) => {
      if (!id(declaration.name, declaration.name?.text) || !declaration.initializer) return;
      if (result.has(declaration.name.text)) fail('Group A31 original literal shadow refused.');
      result.set(declaration.name.text, declaration.initializer);
    };
    for (const declaration of declarations(ast)) add(declaration);
    if (body) for (const statement of body.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) fail('Group A31 mutable original literal refused.');
      for (const declaration of statement.declarationList.declarations) add(declaration);
    }
    return result;
  }
  function literal(node, env = new Map(), special = '', seen = new Set()) {
    node = unwrap(node);
    if (!node) fail('Group A31 literal missing.');
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node) && Number.isFinite(Number(node.text))) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand))
      return -Number(node.operand.text);
    if (ts.isIdentifier(node) && env.has(node.text) && !seen.has(node.text))
      return literal(env.get(node.text), env, special, new Set([...seen, node.text]));
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => literal(item, env, special, seen));
    if (ts.isObjectLiteralExpression(node)) {
      const value = {};
      for (const property of node.properties) {
        if (!(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
          || !(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)))
          fail('Group A31 nonliteral object refused.');
        const key = property.name.text;
        if (['__proto__', 'prototype', 'constructor'].includes(key) || Object.hasOwn(value, key))
          fail('Group A31 duplicate/prototype literal refused.');
        if (ts.isShorthandPropertyAssignment(property) && !env.has(key))
          fail('Group A31 unbound shorthand literal refused.');
        value[key] = literal(ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer,
          env, special, seen);
      }
      return value;
    }
    if (ts.isShorthandPropertyAssignment(node) && env.has(node.name.text)) return literal(node.name, env, special, seen);
    if (['robots-txt-generator', 'hreflang-tag-generator', 'nginx-redirect-generator'].includes(special)
      && ts.isCallExpression(node) && id(node.expression, 'rows') && node.arguments.length === 1)
      return JSON.stringify(literal(node.arguments[0], env, '', seen));
    if (special === 'timestamp-converter' && ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken
      && literal(node.left) === 1776000000 && literal(node.right) === 1000) return 1776000000000;
    if (special === 'css-formatter' && ts.isTemplateExpression(node) && node.head.text === ''
      && node.templateSpans.length === 1 && node.templateSpans[0].literal.text === 'a') {
      const repeat = node.templateSpans[0].expression;
      if (ts.isCallExpression(repeat) && ts.isPropertyAccessExpression(repeat.expression)
        && literal(repeat.expression.expression) === ' ' && repeat.expression.name.text === 'repeat'
        && repeat.arguments.length === 1 && literal(repeat.arguments[0]) === 100000) return ' '.repeat(100000) + 'a';
    }
    fail('Group A31 only frozen literal/rows/repeat/product forms are admitted.');
  }
  function file(node, env, special) {
    node = unwrap(node);
    if (ts.isIdentifier(node) && env.has(node.text)) node = unwrap(env.get(node.text));
    if (!node || !ts.isNewExpression(node) || !id(node.expression, 'File') || node.arguments?.length !== 3)
      fail('Group A31 literal File refused.');
    const [parts, name, options] = node.arguments;
    const payload = literal(parts, env, special), filename = literal(name, env), opts = literal(options, env);
    if (payload.length !== 1 || typeof payload[0] !== 'string' || typeof filename !== 'string'
      || !filename || Object.keys(opts).join(',') !== 'type' || typeof opts.type !== 'string')
      fail('Group A31 literal File fields refused.');
    return { name: filename, mime: opts.type, text: payload[0] };
  }
  function member(node, name) {
    if (!node || !ts.isObjectLiteralExpression(node)) fail('Group A31 literal module object required.');
    const found = node.properties.filter((property) => property.name && property.name.getText() === name);
    if (found.length !== 1) fail(`Group A31 module member refused: ${name}`);
    return found[0];
  }
  const testPath = 'packages/core/test/catalog-fixture-group-a31.test.ts';
  const testSource = await source(testPath), ast = testSource.ast;
  const publicSymbols = [...definitions.filter((item) => item[1] && item[0] !== 'csv-viewer').map((item) => item[1]), 'textDeveloperTools'];
  const importCounts = new Map();
  for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    const allowed = specifier === 'vitest' ? ['expect', 'it']
      : specifier === '../src/index.js' ? [...publicSymbols, 'ToolRunContext']
        : specifier === '../dist/node/index.js' ? ['csvViewer'] : [];
    if (allowed.length === 0 || !bindings || !ts.isNamedImports(bindings) || bindings.elements.length === 0 || statement.importClause.name
      || bindings.elements.some((item) => item.propertyName || !allowed.includes(item.name.text)
        || (item.name.text !== 'ToolRunContext' && (statement.importClause.isTypeOnly || item.isTypeOnly))))
      fail('Group A31 named source/dist import refused.');
    for (const item of bindings.elements) {
      const key = item.name.text;
      if (importCounts.has(key)) fail('Group A31 duplicate/shadow import refused.');
      importCounts.set(key, specifier);
    }
  }
  if (importCounts.size !== publicSymbols.length + 4 || [...publicSymbols, 'ToolRunContext', 'expect', 'it', 'csvViewer'].some((key) => !importCounts.has(key)))
    fail('Group A31 complete import roster required.');
  const printer = ts.createPrinter({ removeComments: true });
  const printed = (node, whole) => printer.printNode(ts.EmitHint.Unspecified, node, whole);
  function sameTemplate(node, text) {
    const expected = parse('a31-fixed-template.ts', text);
    if (expected.statements.length !== 1 || printed(node, ast) !== printed(expected.statements[0], expected))
      fail('Group A31 context/member helper changed.');
  }
  const topVariables = ast.statements.filter(ts.isVariableStatement);
  const topFunctions = ast.statements.filter(ts.isFunctionDeclaration);
  if (topVariables.length !== 1 || topFunctions.length !== 1) fail('Group A31 fixed top-level declarations required.');
  sameTemplate(topVariables[0], `const context = (): ToolRunContext => ({
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'group-a31-independent-authorities',
    onProgress() {},
  });`);
  sameTemplate(topFunctions[0], `function textDeveloperTool(id: string) {
    const matches = textDeveloperTools.filter((tool) => tool.id === id);
    if (matches.length !== 1) throw new Error('Expected exactly one public textDeveloper tool.');
    return matches[0]!;
  }`);
  const tests = ast.statements.filter(ts.isExpressionStatement);
  if (tests.length !== definitions.length || ast.statements.length !== importCounts.size * 0 + ast.statements.filter(ts.isImportDeclaration).length + 2 + tests.length)
    fail('Group A31 refuses extra top-level statements.');
  const index = await source('packages/core/src/index.ts');
  const registry = await source('packages/core/src/default-registry.ts');
  const support = await Promise.all(['packages/core/src/registry.ts', 'packages/core/src/lib/input-validation.ts', 'packages/core/src/types.ts'].map(source));
  function namedEdge(whole, symbol, specifier, exporting) {
    const matches = whole.statements.filter((statement) => {
      const clause = exporting ? statement.exportClause : statement.importClause?.namedBindings;
      return (exporting ? ts.isExportDeclaration(statement) : ts.isImportDeclaration(statement))
        && !(exporting ? statement.isTypeOnly : statement.importClause?.isTypeOnly)
        && statement.moduleSpecifier?.text === specifier && clause
        && (exporting ? ts.isNamedExports(clause) : ts.isNamedImports(clause))
        && clause.elements.some((item) => !item.isTypeOnly && !item.propertyName && item.name.text === symbol);
    });
    if (matches.length !== 1) fail('Group A31 public/default registry named edge refused.');
    return span(matches[0], whole);
  }
  const defaults = unwrap(named(registry.ast, 'defaultTools').initializer);
  if (!defaults || !ts.isArrayLiteralExpression(defaults)) fail('Group A31 default registry literal array required.');
  function membership(symbol, spread) {
    const matches = defaults.elements.filter((item) => spread ? ts.isSpreadElement(item) && id(item.expression, symbol) : id(item, symbol));
    if (matches.length !== 1) fail('Group A31 unique default registry membership refused.');
    return span(matches[0], registry.ast);
  }
  const candidates = [];
  for (const [position, definition] of definitions.entries()) {
    const [engineId, directSymbol, originalIndex, kind, fields] = definition;
    const statement = tests[position], test = statement.expression;
    if (!ts.isCallExpression(test) || !id(test.expression, 'it') || test.arguments.length !== 2
      || literal(test.arguments[0]) !== `group-a31 ${engineId}` || !ts.isArrowFunction(test.arguments[1])
      || test.arguments[1].parameters.length || !test.arguments[1].modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      || !ts.isBlock(test.arguments[1].body)) fail('Group A31 fixed31 named async cases required.');
    const body = test.arguments[1].body, statements = [...body.statements];
    if (statements.length !== 7) fail('Group A31 literal one-output case shape refused.');
    const declared = statements.slice(0, 3).map((item, i) => {
      if (!ts.isVariableStatement(item) || !(item.declarationList.flags & ts.NodeFlags.Const)
        || item.declarationList.declarations.length !== 1) fail('Group A31 immutable inputs/params/output required.');
      const declaration = item.declarationList.declarations[0];
      if (!id(declaration.name, ['inputs', 'params', 'outputs'][i])) fail('Group A31 exact run declarations required.');
      return declaration.initializer;
    });
    const inputArray = unwrap(declared[0]);
    if (!ts.isArrayLiteralExpression(inputArray)) fail('Group A31 literal inputs required.');
    const inputs = inputArray.elements.map((node) => file(node, new Map(), engineId));
    const params = literal(declared[1]);
    const run = declared[2] && ts.isAwaitExpression(declared[2]) ? declared[2].expression : null;
    const receiver = run && ts.isCallExpression(run) && ts.isPropertyAccessExpression(run.expression) ? run.expression.expression : null;
    const selected = !directSymbol && receiver && ts.isCallExpression(receiver) && id(receiver.expression, 'textDeveloperTool')
      && receiver.arguments.length === 1 && literal(receiver.arguments[0]) === engineId;
    if (!run || !ts.isCallExpression(run) || !ts.isPropertyAccessExpression(run.expression) || run.expression.name.text !== 'run'
      || (directSymbol ? !id(receiver, directSymbol) : !selected) || run.arguments.length !== 3
      || !id(run.arguments[0], 'inputs') || !id(run.arguments[1], 'params')
      || !ts.isCallExpression(run.arguments[2]) || !id(run.arguments[2].expression, 'context') || run.arguments[2].arguments.length)
      fail('Group A31 actual public run binding refused.');
    const guard = statements[3];
    if (guard.getText(ast) !== "if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');")
      fail('Group A31 actual array guard refused.');
    function assertion(node) {
      const outer = ts.isExpressionStatement(node) ? node.expression : null;
      const inner = outer && ts.isCallExpression(outer) && ts.isPropertyAccessExpression(outer.expression) ? outer.expression.expression : null;
      if (!inner || !ts.isCallExpression(inner) || !id(inner.expression, 'expect') || inner.arguments.length !== 1 || outer.arguments.length !== 1)
        fail('Group A31 literal output assertion refused.');
      return { actual: inner.arguments[0], matcher: outer.expression.name.text, expected: outer.arguments[0], node: outer };
    }
    const count = assertion(statements[4]), mime = assertion(statements[5]), equality = assertion(statements[6]);
    if (!id(count.actual, 'outputs') || count.matcher !== 'toHaveLength' || literal(count.expected) !== 1)
      fail('Group A31 complete artifact count refused.');
    const isOutputZero = (node) => {
      node = unwrap(node);
      return node && ts.isElementAccessExpression(node) && id(node.expression, 'outputs') && literal(node.argumentExpression) === 0;
    };
    if (!ts.isPropertyAccessExpression(mime.actual) || mime.actual.name.text !== 'type' || !isOutputZero(mime.actual.expression) || mime.matcher !== 'toBe')
      fail('Group A31 ordered MIME refused.');
    const outputMime = literal(mime.expected), expected = literal(equality.expected);
    let text = equality.actual;
    if (kind !== 'text-exact') {
      if (!call(text, 'JSON', 'parse') || text.arguments.length !== 1) fail('Group A31 complete parsed JSON required.');
      text = text.arguments[0];
    }
    if (!ts.isAwaitExpression(text) || !ts.isCallExpression(text.expression) || text.expression.arguments.length
      || !ts.isPropertyAccessExpression(text.expression.expression) || text.expression.expression.name.text !== 'text'
      || !isOutputZero(text.expression.expression.expression)
      || equality.matcher !== (kind === 'text-exact' ? 'toBe' : kind === 'json-exact' ? 'toEqual' : 'toMatchObject'))
      fail('Group A31 complete actual text/equality required.');

    const originalCase = originalIndex === null ? null : oracles.sourceCaseCatalog[originalIndex];
    const originalPath = originalCase?.source ?? 'tools/test/catalog-packaged-workers.test.mjs';
    const original = await source(originalPath);
    let originalCall, originalBody;
    if (originalCase) {
      if (originalCase.index !== originalIndex || original.pin.sha256 !== originalCase.sourceSha256)
        fail('Group A31 original whole source pin changed.');
      const cases = nodes(original.ast, (node) => ts.isCallExpression(node) && id(node.expression, 'it')
        && node.getText(original.ast) === originalCase.exactCaseBody);
      if (cases.length !== 1) fail('Group A31 original exact case binding refused.');
      originalCall = cases[0]; originalBody = originalCall.arguments[1].body;
    } else {
      const cases = nodes(original.ast, (node) => ts.isCallExpression(node) && id(node.expression, 'test')
        && node.getText(original.ast).startsWith('test(`actual ${format} owned CSV worker returns the complete CSV artifact`'));
      const lineStarts = original.ast.getLineStarts();
      const originalSpan = original.ast.text.slice(lineStarts[12], lineStarts[21]);
      if (cases.length !== 1 || cases[0].getStart(original.ast) !== lineStarts[12] + 2
        || originalSpan !== `  ${cases[0].getText(original.ast)};\n\n`
        || Buffer.byteLength(originalSpan) !== 540
        || sha(originalSpan) !== '012a4c5a0bc49e931ddff548c34aa8c9a18ca71cf64fa47410c191151f05bc27')
        fail('Group A31 original packaged CSV body changed.');
      originalCall = cases[0]; originalBody = originalCall.arguments[1].body;
    }
    const env = environment(original.ast, originalBody);
    const assertions = nodes(originalBody, (node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ['toBe', 'toEqual', 'toMatchObject', 'toBeCloseTo'].includes(node.expression.name.text)
      && ts.isCallExpression(node.expression.expression) && id(node.expression.expression.expression, 'expect'), true);
    const selectedAssertions = [];
    function oldValue(assertionNode) {
      selectedAssertions.push(span(assertionNode, original.ast));
      return literal(assertionNode.arguments[0], env, engineId);
    }
    let originalExpected;
    if (engineId === 'number-to-words-converter') {
      const loop = originalBody.statements[0];
      if (!ts.isForOfStatement(loop) || !ts.isArrayLiteralExpression(loop.expression)) fail('Group A31 original number table refused.');
      const first = literal(loop.expression.elements[0]);
      if (!isDeepStrictEqual(first, ['0', 'zero'])) fail('Group A31 original first number pair changed.');
      originalExpected = { words: first[1] };
      selectedAssertions.push(span(loop, original.ast));
    } else if (fields) {
      originalExpected = {};
      for (const field of fields) {
        const matches = assertions.filter((node) => {
          const actual = unwrap(node.expression.expression.arguments[0]);
          const segments = [];
          let cursor = actual;
          while (cursor && (ts.isPropertyAccessExpression(cursor) || ts.isElementAccessExpression(cursor))) {
            segments.unshift(ts.isPropertyAccessExpression(cursor) ? cursor.name.text : literal(cursor.argumentExpression));
            cursor = unwrap(cursor.expression);
          }
          return segments.join('.') === field;
        });
        if (!matches.length) fail('Group A31 original exact field assertion missing.');
        const chosen = matches[0];
        if (chosen.expression.name.text === 'toBeCloseTo'
          && !(engineId === 'percentage-calculator' && field === 'result' && literal(chosen.arguments[0]) === 40 && literal(chosen.arguments[1]) === 5))
          fail('Group A31 only independently reviewed exact percentage refinement admitted.');
        const value = oldValue(chosen), keys = field.split('.');
        let object = originalExpected;
        for (const key of keys.slice(0, -1)) object = object[key] ??= {};
        object[keys.at(-1)] = value;
      }
    } else if (engineId === 'csv-viewer') {
      originalExpected = literal(env.get('source'), env);
      selectedAssertions.push(span(originalCall, original.ast));
    } else {
      const matches = assertions.filter((node) => node.expression.name.text === (kind === 'json-exact' ? 'toEqual' : 'toBe'));
      const choice = ['base64', 'javascript-minifier'].includes(engineId) ? 1 : 0;
      if (!matches[choice]) fail('Group A31 original equality missing.');
      originalExpected = oldValue(matches[choice]);
    }
    if (!isDeepStrictEqual(expected, originalExpected)) fail('Group A31 expected value differs from frozen original assertion.');

    // Source-case helpers are immutable under their whole original source pin. Only fixed literal input adapters follow them.
    const originalHelpers = original.ast.statements.filter((node) => ts.isFunctionDeclaration(node)
      || ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => d.initializer && ts.isArrowFunction(unwrap(d.initializer))))
      .map((node) => span(node, original.ast));
    const helperCalls = nodes(originalBody, (node) => ts.isCallExpression(node)
      && ts.isIdentifier(node.expression) && ['run', 'convert', 'json', 'output'].includes(node.expression.text), true);
    let expectedInputs = [], expectedParams = {};
    let oldCalls = helperCalls.filter((node) => directSymbol ? true : node.arguments[0] && literal(node.arguments[0], env) === engineId);
    if (engineId === 'javascript-minifier') {
      oldCalls = oldCalls.filter((node) => node.arguments[1] && literal(node.arguments[1], env).module === true);
      if (oldCalls.length !== 1) fail('Group A31 unique original explicit JavaScript module run required.');
    }
    const oldCall = oldCalls[0];
    if (!directSymbol) {
      if (engineId === 'number-to-words-converter') expectedParams = { numberText: '0' };
      else {
        if (!oldCall) fail('Group A31 original public T run missing.');
        expectedParams = oldCall.arguments[1] ? literal(oldCall.arguments[1], env, engineId) : {};
        if (oldCall.arguments[2]) expectedInputs = [{ name: 'fixture.txt', mime: 'text/plain', text: literal(oldCall.arguments[2], env, engineId) }];
      }
    } else if (['url-encoder', 'text-escape', 'base64'].includes(engineId)) {
      const oldRun = nodes(originalBody, (node) => call(node, directSymbol, 'run'), true);
      if (oldRun.length !== 1) fail('Group A31 original direct File run refused.');
      const array = unwrap(oldRun[0].arguments[0]);
      expectedInputs = array.elements.map((node) => file(node, env, engineId));
      expectedParams = literal(oldRun[0].arguments[1], env);
    } else if (engineId === 'csv-viewer') {
      expectedInputs = [{ name: 'fixture.csv', mime: 'text/csv', text: originalExpected }];
      const oldRun = nodes(originalBody, (node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'run');
      if (oldRun.length !== 1) fail('Group A31 original packaged CSV public run refused.');
      expectedParams = literal(oldRun[0].arguments[1], env);
    } else if (['case-converter', 'slug', 'timestamp-converter', 'jwt-decoder', 'css-formatter', 'xml-formatter', 'json-yaml', 'csv-json', 'color-converter'].includes(engineId)) {
      if (!oldCall) fail('Group A31 original input helper refused.');
      const names = { 'case-converter': ['input.txt', 'text/plain'], slug: ['input.txt', 'text/plain'],
        'timestamp-converter': ['ts.txt', 'text/plain'], 'jwt-decoder': ['token.txt', 'text/plain'],
        'css-formatter': ['styles.css', 'text/css'], 'xml-formatter': ['input.xml', 'text/xml'],
        'json-yaml': ['input.txt', 'text/plain'], 'csv-json': ['mixed.csv', 'text/csv'], 'color-converter': ['color.txt', 'text/plain'] };
      const [name, mimeValue] = names[engineId];
      expectedInputs = [{ name, mime: mimeValue, text: literal(oldCall.arguments[0], env, engineId) }];
      expectedParams = engineId === 'case-converter' ? { case: literal(oldCall.arguments[1], env) }
        : engineId === 'csv-json' ? literal(nodes(named(original.ast, 'convert'), (node) => call(node, 'csvJson', 'run'))[0].arguments[1])
          : oldCall.arguments[1] ? literal(oldCall.arguments[1], env) : {};
    } else {
      if (!oldCall) fail('Group A31 original parameter helper refused.');
      expectedParams = literal(oldCall.arguments[0], env);
    }
    if (!isDeepStrictEqual(inputs, expectedInputs) || !isDeepStrictEqual(params, expectedParams))
      fail('Group A31 original input/parameter association refused.');

    const symbol = directSymbol ?? 'textDeveloperTools';
    const modulePath = directSymbol === 'csvViewer' ? 'packages/core/src/utilities/files.ts'
      : directSymbol ? `packages/core/src/tools/${engineId}/index.ts` : 'packages/core/src/utilities/text-developer.ts';
    const specifier = directSymbol === 'csvViewer' ? './utilities/files.js'
      : directSymbol ? `./tools/${engineId}/index.js` : './utilities/text-developer.js';
    const module = await source(modulePath);
    const publicExport = namedEdge(index.ast, symbol, specifier, true);
    const registryImport = namedEdge(registry.ast, symbol, specifier, false);
    const registryMember = membership(symbol, !directSymbol);
    let declaration, sourceOutputMime, factoryBindings = [], extraSources = [];
    if (directSymbol) {
      declaration = named(module.ast, directSymbol);
      const object = unwrap(declaration.initializer);
      if (!ts.isObjectLiteralExpression(object) || literal(member(object, 'id').initializer) !== engineId
        || !ts.isMethodDeclaration(member(object, 'run'))) fail('Group A31 literal public ToolModule id/run refused.');
      sourceOutputMime = literal(member(unwrap(member(object, 'output').initializer), 'mime').initializer);
      factoryBindings = ['defaults', 'run'].map((key) => ({ member: key, ...span(member(object, key), module.ast) }));
      const defaultTypes = module.ast.statements.filter((node) => ts.isExportDeclaration(node)
        && node.moduleSpecifier?.text === './types.js');
      if (defaultTypes.length) extraSources.push(await source(modulePath.replace(/index\.ts$/, 'types.ts')));
    } else {
      const array = unwrap(named(module.ast, 'textDeveloperTools').initializer);
      if (!ts.isArrayLiteralExpression(array) || array.elements.length !== 13) fail('Group A31 original13 textDeveloper members required.');
      const members = array.elements.map((node) => ts.isIdentifier(node) ? named(module.ast, node.text).initializer : node);
      const literalId = (node) => {
        node = unwrap(node);
        if (!ts.isCallExpression(node)) return null;
        if (id(node.expression, 'createUtility')) node = unwrap(node.arguments[0]);
        return ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : null;
      };
      if (new Set(members.map(literalId)).size !== 13) fail('Group A31 duplicate textDeveloper id refused.');
      const chosen = members.filter((node) => literalId(node) === engineId);
      if (chosen.length !== 1) fail('Group A31 public textDeveloper literal membership refused.');
      declaration = chosen[0];
      const common = await source('packages/core/src/utilities/common.ts');
      extraSources.push(common);
      if (ts.isCallExpression(declaration) && id(declaration.expression, 'createUtility')) {
        const factory = named(common.ast, 'createUtility');
        const returns = factory.body.statements.filter((node) => ts.isReturnStatement(node));
        if (returns.length !== 1) fail('Group A31 unique utility factory result required.');
        sourceOutputMime = literal(member(unwrap(member(unwrap(returns[0].expression), 'output').initializer), 'mime').initializer);
      } else {
        const factoryName = declaration.expression.text;
        if (!['fileTool', 'generator'].includes(factoryName)) fail('Group A31 original output factory refused.');
        const mimeIndex = factoryName === 'fileTool' ? 4 : 3;
        if (!id(named(module.ast, factoryName).parameters[mimeIndex]?.name, 'mime'))
          fail('Group A31 original output factory MIME parameter refused.');
        sourceOutputMime = literal(declaration.arguments[mimeIndex]);
      }
      factoryBindings = ['definition', 'fileTool', 'generator'].map((name) => ({ name, ...span(named(module.ast, name), module.ast) }));
      for (const name of ['createUtility', 'validateUtilityParams']) factoryBindings.push({ name, ...span(named(common.ast, name), common.ast) });
    }
    if (typeof sourceOutputMime !== 'string' || outputMime !== sourceOutputMime)
      fail('Group A31 output MIME differs from original public module/factory.');
    const authorityPins = [testSource.pin, original.pin, index.pin, registry.pin, ...support.map((row) => row.pin), module.pin, ...extraSources.map((row) => row.pin)];
    const record = {
      key: `group-a31-${engineId}`, engineId, inputs, params, usesPinnedDefaults: false,
      qualificationKind: 'group A31 source-bound fixture',
      artifactOracles: [{ kind, expected, mime: outputMime,
        authority: engineId === 'percentage-calculator' ? 'NEW_REVIEWED_EXACT_ARITHMETIC:20*200/100=40; original case850 same input/40, strict fields instead of its approximate matcher.'
          : `Frozen original public authority ${originalIndex ?? 'packaged CSV'}; exact selected ${kind} assertion only.` }],
      authorityPins,
      sourceCaseBinding: { sourcePin: testSource.pin, caseName: `group-a31 ${engineId}`,
        exactCaseBodySha256: sha(statement.getText(ast)), publicSymbol: symbol, method: 'run',
        sourceCaseIndex: originalIndex, originalSourcePin: original.pin,
        originalCaseBodySha256: sha(originalCall.getText(original.ast)), selectedAssertions,
        originalHelpers, publicExportPin: index.pin, toolPin: module.pin,
        publicExport, registryImport, registryMember, declaration: span(declaration, module.ast), factoryBindings,
        defaultsPolicy: 'Exact raw provided params; pinned original public factory/default merge, not a complete defaults object.' },
      branch: kind === 'json-fields' ? 'Only the listed original fields; no other JSON fields qualified.' : 'Complete original literal output for this fixed positive branch only.',
      pendingBranches: 'Other modes/refusals, canonical owned build, ESM/CJS/floor/packed/browser/native/current integrated SOURCE and release remain required; no row promotion.',
    };
    if (engineId === 'csv-viewer') {
      const csvPaths = [testPath, originalPath, 'packages/core/src/index.ts', 'packages/core/src/default-registry.ts',
        'packages/core/src/registry.ts', modulePath, 'packages/core/src/utilities/csv-data.ts',
        'packages/core/src/utilities/common.ts', 'packages/core/src/utilities/file-job.ts',
        'packages/core/src/utilities/file-job-platform.ts', 'packages/core/src/utilities/file-job-node.ts',
        'packages/core/src/utilities/file-worker-node.ts', 'packages/core/src/utilities/file-worker.ts',
        'packages/core/tsup.config.ts', 'packages/core/package.json'];
      const csv = await Promise.all(csvPaths.map(source));
      const imports = (from, name, spec) => namedEdge(from.ast, name, spec, false);
      const nodeConfigs = nodes(csv[13].ast, (node) => ts.isObjectLiteralExpression(node)
        && node.properties.some((item) => ts.isPropertyAssignment(item) && item.name.getText() === 'platform'
          && ts.isStringLiteralLike(item.initializer) && item.initializer.text === 'node'));
      if (nodeConfigs.length !== 1) fail('Group A31 unique Node build recipe required.');
      const nodeConfig = nodeConfigs[0];
      if (literal(member(nodeConfig, 'outDir').initializer) !== 'dist/node'
        || !isDeepStrictEqual(literal(member(nodeConfig, 'format').initializer), ['esm', 'cjs'])
        || literal(member(unwrap(member(nodeConfig, 'entry').initializer), "'file-worker'").initializer) !== 'src/utilities/file-worker-node.ts')
        fail('Group A31 exact Node entry/worker recipe refused.');
      const recipeText = nodeConfig.getText(csv[13].ast);
      if (!recipeText.includes("name: 'node-file-worker-adapter'")
        || !recipeText.includes("build.onResolve({ filter: /^\\.\\/file-job-platform\\.js$/ }, () => ({")
        || !recipeText.includes("new URL('./src/utilities/file-job-node.ts', import.meta.url)"))
        fail('Group A31 exact Node platform onResolve recipe refused.');
      const workerText = csv[10].bytes.toString('utf8');
      if (!workerText.includes("new URL('./file-worker.js', import.meta.url)")) fail('Group A31 exact Node worker target refused.');
      record.csvNodeImportBinding = {
        testPath, caseName: `group-a31 ${engineId}`, importSpecifier: '../dist/node/index.js',
        importedName: 'csvViewer', localName: 'csvViewer', runReceiver: 'csvViewer', engineId,
        publicSourceExport: { pin: index.pin, specifier, importedName: 'csvViewer', declaration: span(declaration, module.ast) },
        defaultRegistryMembership: { pin: registry.pin, import: registryImport, member: registryMember, registryPin: support[0].pin },
        moduleDelegation: { pins: [csv[5].pin, csv[6].pin, csv[7].pin, csv[8].pin], run: span(member(unwrap(declaration.initializer), 'run'), module.ast),
          import: imports(module, 'runCsvFileJob', './file-job.js') },
        platformImport: { pin: csv[8].pin, import: imports(csv[8], 'createFileWorker', './file-job-platform.js'), platformSourcePin: csv[9].pin },
        nodeAdapterRecipe: { pin: csv[13].pin, nodeConfiguration: span(nodeConfig, csv[13].ast) },
        nodeWorkerEntry: { pins: [csv[10].pin, csv[11].pin, csv[12].pin], workerImport: imports(csv[10], 'Worker', 'node:worker_threads'),
          parentPortImport: imports(csv[11], 'parentPort', 'node:worker_threads'), dispatcherImport: imports(csv[11], 'handleFileJob', './file-worker.js') },
        sourcePins: csv.map((row) => row.pin),
      };
      record.authorityPins = csv.map((row) => row.pin);
    }
    candidates.push(record);
  }
  return candidates;
}

function assertGroupFixtureLayout(oracles) {
  const a31 = [
    'number-to-words-converter', 'chmod-calculator', 'cron-from-text', 'utm-link-builder', 'px-to-rem-converter',
    'ip-subnet-calc', 'unit-converter', 'case-converter', 'slug', 'markdown-table-generator',
    'bulk-meta-description-generator', 'javascript-minifier', 'url-encoder', 'timestamp-converter', 'jwt-decoder',
    'css-formatter', 'xml-formatter', 'text-escape', 'json-yaml', 'base64', 'csv-json', 'robots-txt-generator',
    'csp-header-generator', 'hreflang-tag-generator', 'nginx-redirect-generator', 'color-converter',
    'css-gradient-generator', 'compound-interest', 'percentage-calculator', 'date-calculator', 'csv-viewer',
  ];
  const bc = ['aspect-ratio-calculator', 'tv-viewing-distance-calculator', 'random-number-generator',
    'dice-roller', 'coin-flip', 'lorem-ipsum', 'password-generator', 'uuid-generator'];
  const supplemental = ['roman-encode', 'roman-decode', 'html-remove-comments', 'html-preserve-comments',
    'css-level-one', 'yaml-core', 'yaml-json', 'yaml-failsafe', 'harmony-black', 'harmony-red-partial'];
  const rows = oracles.executableFixtures;
  if (!Array.isArray(rows) || rows.length !== 230 || new Set(rows.map((row) => row?.key)).size !== 230
    || sha(JSON.stringify(rows.slice(0, 181))) !== '2486316ec7eaa544fec64ad64c13797b190320d5a7e9c3899a7644e96e43765f')
    fail('Group A31 / Group BC strict230 historical block/unique roster refused.');
  for (const [field, start, ids, prefix, kind] of [
    ['supplementalFixtureAuthorities', 181, supplemental, 'supplemental-', 'supplemental source-bound fixture'],
    ['groupA31FixtureAuthorities', 191, a31, 'group-a31-', 'group A31 source-bound fixture'],
    ['groupBCFixtureAuthorities', 222, bc, 'group-bc-', 'group B2 C6 source-bound fixture'],
  ]) {
    const authorities = oracles[field];
    if (!Array.isArray(authorities) || authorities.length !== ids.length
      || authorities.some((row, index) => row?.key !== prefix + ids[index] || row.qualificationKind !== kind
        || (start !== 181 && row.engineId !== ids[index]))
      || !isDeepStrictEqual(rows.slice(start, start + ids.length), authorities))
      fail('Group A31 / Group BC strict230 complete ordered family refused: ' + field);
  }
}

async function validateGroupA31Catalog(root, oracles) {
  assertGroupFixtureLayout(oracles);
  const candidates = await protectedGroupA31Fixtures(root, oracles);
  if (!isDeepStrictEqual(oracles.groupA31FixtureAuthorities, candidates))
    fail('Group A31 authority catalog differs from all31 complete derived records.');
  if (!isDeepStrictEqual(oracles.executableFixtures.filter((row) => row.qualificationKind === 'group A31 source-bound fixture'), candidates))
    fail('Group A31 executable records differ from the exact31 sibling authorities.');
  return candidates;
}

async function validateGroupBCCatalog(root, oracles) {
  assertGroupFixtureLayout(oracles);
  const candidates = await protectedGroupBCFixtures(root, oracles);
  if (!isDeepStrictEqual(oracles.groupBCFixtureAuthorities, candidates)
    || !isDeepStrictEqual(oracles.executableFixtures.filter((row) => row.qualificationKind === 'group B2 C6 source-bound fixture'), candidates))
    fail('Group BC authority/executable catalog differs from all8 complete derived records.');
  return candidates;
}

export async function protectedGroupBCFixtures(root, oracles) {
  if (sha(JSON.stringify(oracles.sourceCaseCatalog)) !== '4b8de77304d87a98fb4e99950d1a26eabaf20c7d5863682cedd643458abccf71'
    || sha(JSON.stringify(oracles.declaredFixtureCatalog)) !== '1341ca083c65d21af34b1189dfc670e67f60a5efa8c29bb3eed78a5be2d2a87e')
    fail('Group BC cannot alter historical902/81 authorities.');
  // Fixed accepted INITIAL source inputs; these are not runtime output goldens.
  const publicPins = {"packages/core/src/utilities/aspect-ratio.ts":{"bytes":4545,"sha256":"ac88805fbdfb13d2904a83f0b597bdc406039235ce49995316c536fcbb72c228"},"packages/core/src/utilities/common.ts":{"bytes":19061,"sha256":"fda910defff6b56dc22e7be8f18f9a91ea62971f3bedc1300e730c874c0257b7"},"packages/core/src/tools/lorem-ipsum/index.ts":{"bytes":4653,"sha256":"444251966259167217a006a3682152024871d4a70b0a07e48a9ccd03eafa003d"},"packages/core/src/tools/lorem-ipsum/types.ts":{"bytes":529,"sha256":"cb6bb02f0e9ee6c1f0227aeab67473a501ff242409a8693dd487f464456df56c"},"packages/core/src/tools/password-generator/index.ts":{"bytes":4928,"sha256":"da5e3df44383ac9ef71f58db11bac989a33bfc10c99663e7b32308e083308749"},"packages/core/src/tools/password-generator/types.ts":{"bytes":743,"sha256":"924d00cec12d83e30b01580ce9f41b63689ddda1efc39b1556ea334a0a849555"},"packages/core/src/tools/uuid-generator/index.ts":{"bytes":2136,"sha256":"1bc3d3abd4a67c80d070fd7d0d7ec9911e7e9caa91f511c0257296798ead88f4"},"packages/core/src/tools/uuid-generator/types.ts":{"bytes":284,"sha256":"9edeed016aa41e903fe9f160559c5abcc15471426fa198138715b498e54ab9a4"},"packages/core/src/default-registry.ts":{"bytes":24261,"sha256":"2af3a59fdaba1d5d2f77efae6c489a354e5fa9fc15c988669411e1ef518e699b"},"packages/core/src/registry.ts":{"bytes":4762,"sha256":"23252910de7ab95b1c398186167bdee17b0b227289d86c440f3134a4b3569b0a"},"packages/core/src/types.ts":{"bytes":14110,"sha256":"639295da62e0cd209aa86e46a501aec87aa97069ffa0944b45ef367f33f59b54"},"packages/core/src/utilities/planning.ts":{"bytes":59974,"sha256":"5037a7a0788445f04cbb2d21a7bd9974404acedaa2a1ed7a0c4ef70cc8fae48c"},"packages/core/src/utilities/hardware.ts":{"bytes":47492,"sha256":"9b87e59cdc6613478ab520f02ac4a1e856797220161b6069e2b8b9ed2a4c7f1b"},"packages/core/src/utilities/building.ts":{"bytes":52180,"sha256":"a2075ed96ef17e397215d5514bec1a33c4b48bddc637ab8b1e99c8df1c7726d6"},"packages/core/src/index.ts":{"bytes":40470,"sha256":"1e375d672360591ddba3eb3aa3ff63fd74a2eee3e29ff7ab02f60c76080b5727"}};
  const definitions = [
    ['aspect-ratio-calculator', 'aspectRatioCalculator', null, 358, 'json-fields', { width: '1920', height: '1080' }, { expected: { ratio: '16:9' } }, '037a70843f08c4065407b3e3ba9fd818264a60030ef63b61d22d32b75a36d139'],
    ['tv-viewing-distance-calculator', 'hardwareTools', 'tv', 77, 'bc-tv-original-geometry', { diagonalIn: 5, aspectWidth: 4, aspectHeight: 3, horizontalFovDeg: 90 }, { exactFields: { widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5 }, onlyNumericComparison: { field: 'geometricFovDistanceIn', expected: 2, relativeTolerance: 1e-9, inclusive: true } }, '002b0a8f028db45b93ee955aa325517b2b2874f4ee9fa9b9653057e2df1b68a0'],
    ['random-number-generator', 'planningTools', 'random', 42, 'bc-random-original-complete-range', { min: -500, max: 499, count: 1000, unique: true }, {}, '79655e9acaec32fc777fb72cc5a03c520ef16ea33f6633f51558dd8253647e9c'],
    ['dice-roller', 'planningTools', 'dice', 41, 'bc-dice-original-faces-total', { count: 100, modifier: -1 }, {}, '37d61d6ea0f31eb622e399e3fae029a75385fb8d19d797855be8d3fe0356c87f'],
    ['coin-flip', 'planningTools', 'coin', 41, 'bc-coin-original-count-streak', { count: 1000 }, {}, '37d61d6ea0f31eb622e399e3fae029a75385fb8d19d797855be8d3fe0356c87f'],
    ['lorem-ipsum', 'loremIpsum', null, 433, 'bc-lorem-original-paragraph', { paragraphs: 1 }, {}, '5446e5df9884adbf9e96d85fbe49e52bd66dfef585627f0eb583fabb7da26b70'],
    ['password-generator', 'passwordGenerator', null, 469, 'bc-password-original-length', { length: 24 }, {}, '0625ed1cb178eb1d9128932daccfb2caeb54e4689ad7bc5838e6cde11e2b28ef'],
    ['uuid-generator', 'uuidGenerator', null, 482, 'bc-uuid-original-v4', { version: 4, count: 1 }, {}, '3beb630224423d232e836652b1ae6d7f191addf05995ffe86e019cebb94defbc'],
  ];
  const ts = createRequire(path.join(root, 'package.json'))('typescript'), cache = new Map();
  function parse(name, text) {
    const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) fail('Group BC source parse refused.');
    return ast;
  }
  async function source(relative) {
    if (!cache.has(relative)) {
      const bytes = await readOwned(root, relative);
      const pin = { path: relative, bytes: bytes.length, sha256: sha(bytes) }, expected = publicPins[relative];
      if (expected && (pin.bytes !== expected.bytes || pin.sha256 !== expected.sha256))
        fail('Group BC accepted public/default/factory source changed: ' + relative);
      cache.set(relative, { bytes, pin, ast: parse(relative, bytes.toString('utf8')) });
    }
    return cache.get(relative);
  }
  const id = (node, name) => node && ts.isIdentifier(node) && node.text === name;
  function unwrap(node) {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
      || ts.isNonNullExpression(node) || ts.isAwaitExpression(node))) node = node.expression;
    return node;
  }
  function nodes(node, predicate) {
    const result = [];
    function visit(value) { if (predicate(value)) result.push(value); ts.forEachChild(value, visit); }
    visit(node); return result;
  }
  function named(ast, name) {
    const found = ast.statements.flatMap((statement) => ts.isVariableStatement(statement)
      ? [...statement.declarationList.declarations].filter((node) => id(node.name, name))
      : ts.isFunctionDeclaration(statement) && id(statement.name, name) ? [statement] : []);
    if (found.length !== 1) fail('Group BC unique declaration required: ' + name);
    return found[0];
  }
  function span(node, ast) {
    const expression = node.getText(ast);
    return { bytes: Buffer.byteLength(expression), sha256: sha(expression), expression };
  }
  function member(object, name) {
    if (!object || !ts.isObjectLiteralExpression(object)) fail('Group BC literal module object required.');
    const found = object.properties.filter((node) => node.name && node.name.getText() === name);
    if (found.length !== 1) fail('Group BC unique module member required: ' + name);
    return found[0];
  }
  function literal(node) {
    node = unwrap(node);
    if (!node) fail('Group BC missing literal.');
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand))
      return -Number(node.operand.text);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isObjectLiteralExpression(node)) {
      const result = {};
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)))
          fail('Group BC only plain fixed literal properties are admitted.');
        const key = property.name.text;
        if (['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(result, key)) fail('Group BC duplicate/prototype literal refused.');
        result[key] = literal(property.initializer);
      }
      return result;
    }
    fail('Group BC nonliteral input/parameter refused.');
  }
  function tokens(text) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text), result = [];
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) result.push([kind, scanner.getTokenText()]);
    return result;
  }
  function sameTemplate(actual, expected) {
    if (!isDeepStrictEqual(tokens(actual), tokens(expected))) fail('Group BC fixed public witness/predicate changed.');
  }
  function namedEdge(whole, symbol, specifier, exporting) {
    const matches = whole.statements.filter((statement) => {
      const clause = exporting ? statement.exportClause : statement.importClause?.namedBindings;
      return (exporting ? ts.isExportDeclaration(statement) : ts.isImportDeclaration(statement))
        && !(exporting ? statement.isTypeOnly : statement.importClause?.isTypeOnly)
        && statement.moduleSpecifier?.text === specifier && clause
        && (exporting ? ts.isNamedExports(clause) : ts.isNamedImports(clause))
        && clause.elements.filter((item) => !item.isTypeOnly && !item.propertyName && item.name.text === symbol).length === 1;
    });
    if (matches.length !== 1) fail('Group BC unique runtime public/default/factory named edge required.');
    return span(matches[0], whole);
  }
  const testPath = 'packages/core/test/catalog-fixture-groups-bc.test.ts', testSource = await source(testPath), ast = testSource.ast;
  const publicSymbols = ['aspectRatioCalculator', 'hardwareTools', 'loremIpsum', 'passwordGenerator', 'planningTools', 'uuidGenerator'];
  const imports = ast.statements.filter(ts.isImportDeclaration), imported = new Set();
  if (imports.length !== 2) fail('Group BC exactly two imports required.');
  for (const statement of imports) {
    const specifier = statement.moduleSpecifier.text, clause = statement.importClause;
    const allowed = specifier === 'vitest' ? ['expect', 'it'] : specifier === '../src/index.js' ? [...publicSymbols, 'ToolRunContext'] : [];
    const bindings = clause?.namedBindings;
    if (!allowed.length || !bindings || !ts.isNamedImports(bindings) || !bindings.elements.length || clause.name
      || bindings.elements.some((item) => item.propertyName || !allowed.includes(item.name.text)
        || (item.name.text !== 'ToolRunContext' && (clause.isTypeOnly || item.isTypeOnly))))
      fail('Group BC runtime named import roster refused.');
    for (const item of bindings.elements) {
      if (imported.has(item.name.text)) fail('Group BC duplicate/shadow import refused.');
      imported.add(item.name.text);
    }
  }
  if (imported.size !== 9 || [...publicSymbols, 'ToolRunContext', 'expect', 'it'].some((name) => !imported.has(name))) fail('Group BC complete public import roster required.');
  sameTemplate(named(ast, 'context').getText(ast), "context = (): ToolRunContext => ({ signal: new AbortController().signal, cache: new Map(), executionId: 'group-bc-independent-properties', onProgress() {}, })");
  sameTemplate(named(ast, 'publicTool').getText(ast), "function publicTool(tools: typeof hardwareTools, id: string) { const matches = tools.filter((tool) => tool.id === id); if (matches.length !== 1) throw new Error('Expected exactly one public tool.'); return matches[0]!; }");
  sameTemplate(named(ast, 'close').getText(ast), "function close(actual: unknown, expected: number) { expect(typeof actual).toBe('number'); expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)),); }");
  sameTemplate(named(ast, 'UUID_V4_RE').getText(ast), 'UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/');
  const tests = ast.statements.filter(ts.isExpressionStatement);
  if (tests.length !== 8 || ast.statements.length !== 14) fail('Group BC fixed eight cases/no extra top-level work required.');
  const index = await source('packages/core/src/index.ts'), registry = await source('packages/core/src/default-registry.ts');
  const defaults = unwrap(named(registry.ast, 'defaultTools').initializer);
  if (!ts.isArrayLiteralExpression(defaults)) fail('Group BC default registry literal array required.');
  const common = await source('packages/core/src/utilities/common.ts'), commonFactory = named(common.ast, 'createUtility');
  const returns = commonFactory.body.statements.filter(ts.isReturnStatement);
  if (returns.length !== 1) fail('Group BC unique createUtility return required.');
  const utilityMime = literal(member(unwrap(member(unwrap(returns[0].expression), 'output').initializer), 'mime').initializer);
  if (utilityMime !== 'application/json') fail('Group BC utility MIME changed.');
  await Promise.all(Object.keys(publicPins).map(source));
  const jsonResult = "const result = JSON.parse(await outputs[0]!.text()) as Record<string, unknown>; if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected JSON object.'); ";
  const valuesArray = "const values = result.values as number[]; if (!Array.isArray(values)) throw new Error('Expected values array.'); ";
  const suffixes = [
    "expect(JSON.parse(await outputs[0]!.text())).toMatchObject({ ratio: '16:9' });",
    jsonResult + 'expect(result).toMatchObject({ widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5 }); close(result.geometricFovDistanceIn, 2);',
    jsonResult + valuesArray + 'expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 1000 }, (_, i) => i - 500));',
    jsonResult + valuesArray + 'expect(values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6)).toBe(true); expect(result.total).toBe(values.reduce((a, b) => a + b, 0) - 1);',
    jsonResult + "expect(Number(result.heads) + Number(result.tails)).toBe(1000); expect(result.values).toHaveLength(1000); expect(typeof result.longestStreak).toBe('number'); expect(result.longestStreak).toBeGreaterThan(0);",
    "const text = await outputs[0]!.text(); const paragraphs = text.split('\\n\\n').filter((p) => p.trim().length > 0); expect(paragraphs.length).toBe(1);",
    'const password = await outputs[0]!.text(); expect(password.length).toBe(24);',
    'const uuid = (await outputs[0]!.text()).trim(); expect(uuid).toMatch(UUID_V4_RE);',
  ];
  const candidates = [];
  for (const [position, definition] of definitions.entries()) {
    const [engineId, symbol, arrayMember, originalIndex, kind, expectedParams, oracleFields, originalCaseSha256] = definition;
    const statement = tests[position], test = statement.expression;
    if (!ts.isCallExpression(test) || !id(test.expression, 'it') || test.arguments.length !== 2
      || literal(test.arguments[0]) !== 'group-bc ' + engineId || !ts.isArrowFunction(test.arguments[1])
      || test.arguments[1].parameters.length || !test.arguments[1].modifiers?.some((node) => node.kind === ts.SyntaxKind.AsyncKeyword)
      || !ts.isBlock(test.arguments[1].body)) fail('Group BC fixed ordered async case refused.');
    const statements = [...test.arguments[1].body.statements];
    if (statements.length < 7) fail('Group BC complete one-artifact public witness required.');
    const variable = (node, name) => {
      if (!ts.isVariableStatement(node) || !(node.declarationList.flags & ts.NodeFlags.Const)
        || node.declarationList.declarations.length !== 1 || !id(node.declarationList.declarations[0].name, name)) fail('Group BC fixed const input/parameter/output required.');
      return node.declarationList.declarations[0].initializer;
    };
    const inputs = literal(variable(statements[0], 'inputs')), params = literal(variable(statements[1], 'params'));
    if (!isDeepStrictEqual(inputs, []) || !isDeepStrictEqual(params, expectedParams)) fail('Group BC original raw params/empty inputs changed.');
    const awaitedRun = variable(statements[2], 'outputs');
    if (!ts.isAwaitExpression(awaitedRun)) fail('Group BC actual public run must be awaited.');
    const run = unwrap(awaitedRun.expression);
    if (!ts.isCallExpression(run) || !ts.isPropertyAccessExpression(run.expression) || run.expression.name.text !== 'run'
      || run.arguments.length !== 3 || !id(run.arguments[0], 'inputs') || !id(run.arguments[1], 'params')
      || !ts.isCallExpression(run.arguments[2]) || !id(run.arguments[2].expression, 'context') || run.arguments[2].arguments.length) fail('Group BC actual public run/input/params/context refused.');
    const receiver = run.expression.expression;
    if (arrayMember ? !ts.isCallExpression(receiver) || !id(receiver.expression, 'publicTool') || receiver.arguments.length !== 2
      || !id(receiver.arguments[0], symbol) || literal(receiver.arguments[1]) !== engineId : !id(receiver, symbol)) fail('Group BC exact public receiver refused.');
    const mime = position < 5 ? 'application/json' : 'text/plain';
    sameTemplate(statements.slice(3, 6).map((node) => node.getText(ast)).join('\n'), "if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.'); expect(outputs).toHaveLength(1); expect(outputs[0]!.type).toBe('" + mime + "');");
    sameTemplate(statements.slice(6).map((node) => node.getText(ast)).join('\n'), suffixes[position]);
    const originalRecord = oracles.sourceCaseCatalog.find((row) => row.index === originalIndex);
    if (!originalRecord || sha(originalRecord.exactCaseBody) !== originalCaseSha256) fail('Group BC original selected case differs from frozen authority.');
    const original = await source(originalRecord.source);
    if (original.pin.sha256 !== originalRecord.sourceSha256) fail('Group BC whole original test source changed.');
    const originalCalls = nodes(original.ast, (node) => ts.isCallExpression(node) && id(node.expression, 'it') && node.getText(original.ast) === originalRecord.exactCaseBody);
    if (originalCalls.length !== 1) fail('Group BC original case not found uniquely in actual source.');
    const originalCall = originalCalls[0], originalBody = originalCall.arguments[1]?.body;
    if (!originalBody || !ts.isBlock(originalBody)) fail('Group BC original case body refused.');
    const rawCalls = nodes(originalBody, (node) => ts.isCallExpression(node)
      && (arrayMember ? id(node.expression, 'run') && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === engineId
        : engineId === 'aspect-ratio-calculator' ? id(node.expression, 'calculateAspectRatio') : engineId === 'lorem-ipsum' ? id(node.expression, 'generate')
          : ts.isPropertyAccessExpression(node.expression) && id(node.expression.expression, symbol) && node.expression.name.text === 'run'));
    const originalParamIndex = arrayMember ? 1 : ['aspect-ratio-calculator', 'lorem-ipsum'].includes(engineId) ? 0 : 1;
    if (!rawCalls.length || !rawCalls.some((node) => isDeepStrictEqual(literal(node.arguments[originalParamIndex]), params))) fail('Group BC input params lack actual original public/helper association.');
    const modulePath = symbol === 'hardwareTools' ? 'packages/core/src/utilities/hardware.ts' : symbol === 'planningTools' ? 'packages/core/src/utilities/planning.ts'
      : engineId === 'aspect-ratio-calculator' ? 'packages/core/src/utilities/aspect-ratio.ts' : 'packages/core/src/tools/' + engineId + '/index.ts';
    const specifier = symbol === 'hardwareTools' ? './utilities/hardware.js' : symbol === 'planningTools' ? './utilities/planning.js'
      : engineId === 'aspect-ratio-calculator' ? './utilities/aspect-ratio.js' : './tools/' + engineId + '/index.js';
    const module = await source(modulePath), publicExport = namedEdge(index.ast, symbol, specifier, true), registryImport = namedEdge(registry.ast, symbol, specifier, false);
    const registryMembers = defaults.elements.filter((node) => arrayMember ? ts.isSpreadElement(node) && id(node.expression, symbol) : id(node, symbol));
    if (registryMembers.length !== 1) fail('Group BC unique actual default registry membership required.');
    const declaration = named(module.ast, arrayMember ?? symbol), factoryBindings = [], defaultBindings = [];
    let sourceMime;
    if (arrayMember) {
      const array = unwrap(named(module.ast, symbol).initializer);
      if (!ts.isArrayLiteralExpression(array) || array.elements.filter((node) => id(node, arrayMember)).length !== 1) fail('Group BC unique actual exported array member required.');
      const factoryCall = unwrap(declaration.initializer), factoryName = symbol === 'hardwareTools' ? 'tool' : 'utility';
      if (!ts.isCallExpression(factoryCall) || !id(factoryCall.expression, factoryName) || literal(factoryCall.arguments[0]) !== engineId) fail('Group BC actual literal engine id/factory refused.');
      factoryBindings.push({ name: factoryName, ...span(named(module.ast, factoryName), module.ast) });
      defaultBindings.push(span(factoryCall.arguments[3], module.ast));
      if (symbol === 'hardwareTools') {
        const building = await source('packages/core/src/utilities/building.ts');
        factoryBindings.push({ name: 'buildingUtilityImport', ...namedEdge(module.ast, 'buildingUtility', './building.js', false) });
        factoryBindings.push({ name: 'createUtilityImport', ...namedEdge(building.ast, 'createUtility', './common.js', false) });
        for (const name of ['buildingUtility', 'buildingSpecs', 'buildingResult']) factoryBindings.push({ name, ...span(named(building.ast, name), building.ast) });
      } else {
        factoryBindings.push({ name: 'createUtilityImport', ...namedEdge(module.ast, 'createUtility', './common.js', false) });
        for (const name of ['secureUint32', 'uniformInteger', 'sampleUniqueIntegers']) factoryBindings.push({ name, ...span(named(module.ast, name), module.ast) });
      }
      sourceMime = utilityMime;
    } else if (engineId === 'aspect-ratio-calculator') {
      const factoryCall = unwrap(declaration.initializer);
      if (!ts.isCallExpression(factoryCall) || !id(factoryCall.expression, 'createUtility') || literal(member(unwrap(factoryCall.arguments[0]), 'id').initializer) !== engineId) fail('Group BC actual aspect utility id/factory refused.');
      factoryBindings.push({ name: 'calculateAspectRatio', ...span(named(module.ast, 'calculateAspectRatio'), module.ast) });
      factoryBindings.push({ name: 'createUtilityImport', ...namedEdge(module.ast, 'createUtility', './common.js', false) });
      defaultBindings.push(span(member(unwrap(factoryCall.arguments[0]), 'defaults'), module.ast));
      sourceMime = utilityMime;
    } else {
      const object = unwrap(declaration.initializer);
      if (literal(member(object, 'id').initializer) !== engineId || !ts.isMethodDeclaration(member(object, 'run'))) fail('Group BC actual literal direct ToolModule id/run refused.');
      sourceMime = literal(member(unwrap(member(object, 'output').initializer), 'mime').initializer);
      for (const name of ['defaults', 'run']) defaultBindings.push(span(member(object, name), module.ast));
    }
    if (sourceMime !== mime) fail('Group BC actual output MIME differs from public witness.');
    if (position < 5) for (const name of ['createUtility', 'validateUtilityParams', 'calculateWithAbort']) factoryBindings.push({ name, ...span(named(common.ast, name), common.ast) });
    const originalHelpers = original.ast.statements.filter((node) => ts.isFunctionDeclaration(node)
      || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.initializer && ts.isArrowFunction(unwrap(item.initializer)))).map((node) => span(node, original.ast));
    candidates.push({
      key: 'group-bc-' + engineId, engineId, inputs, params, usesPinnedDefaults: false, qualificationKind: 'group B2 C6 source-bound fixture',
      artifactOracles: [{ kind, mime, ...oracleFields, authority: 'Exact accepted original predicate only; public actual-run witness, no seeded/learned output golden.' }],
      authorityPins: [testSource.pin, original.pin, ...Object.keys(publicPins).map((relative) => cache.get(relative).pin)],
      sourceCaseBinding: { sourcePin: testSource.pin, caseName: 'group-bc ' + engineId, exactCaseBodySha256: sha(statement.getText(ast)), publicSymbol: symbol, method: 'run',
        sourceCaseIndex: originalIndex, originalSourcePin: original.pin, originalCaseBodySha256: originalCaseSha256,
        originalCase: span(originalCall, original.ast), originalHelpers, publicExport, registryImport, registryMember: span(registryMembers[0], registry.ast),
        declaration: span(declaration, module.ast), factoryBindings, defaultBindings, selectedAssertions: statements.slice(6).map((node) => span(node, ast)),
        contextAndPredicateHelpers: ['context', 'publicTool', 'close', 'UUID_V4_RE'].map((name) => span(named(ast, name), ast)),
        defaultsPolicy: 'Exact original raw provided params; unchanged pinned public factory/fallback merge, no complete-default claim.' },
      branch: 'Only the fixed original partial property; randomness/distributions/security and other modes are unqualified.',
      pendingBranches: 'Other modes/refusals and owned build/packed/floor/browser/native/current integrated SOURCE/release remain required; no row promotion.',
    });
  }
  return candidates;
}

function groupBCArtifactDescriptor(oracle) {
  const descriptors = {
    'bc-tv-original-geometry': {
      mime: 'application/json', checkedFields: ['$.widthIn', '$.heightIn', '$.referenceDistanceIn', '$.geometricFovDistanceIn'],
      predicate: 'Only widthIn===4, heightIn===3, referenceDistanceIn===4.5; number geometry with abs(actual-2)<=1e-9*max(1,abs(2)).',
      onlyNumericComparison: { field: 'geometricFovDistanceIn', expected: 2, relativeTolerance: 1e-9, inclusive: true },
    },
    'bc-random-original-complete-range': {
      mime: 'application/json', checkedFields: ['$.values'],
      predicate: 'Only a copied numeric-sort of values deep-equals the complete integer set -500..499; draw order and RNG quality unqualified.',
    },
    'bc-dice-original-faces-total': {
      mime: 'application/json', checkedFields: ['$.values', '$.total'],
      predicate: 'Only every face integer1..6 and total===reduce(sum,0)-1; no length/nonempty or randomness claim.',
    },
    'bc-coin-original-count-streak': {
      mime: 'application/json', checkedFields: ['$.heads', '$.tails', '$.values.length', '$.longestStreak'],
      predicate: 'Only Number(heads)+Number(tails)===1000, values.length===1000, and numeric longestStreak>0; no array/sequence/frequency claim.',
    },
    'bc-lorem-original-paragraph': {
      mime: 'text/plain', checkedFields: ['text.split(LF LF).filter(trim.length>0).length'],
      predicate: 'Only one nonempty double-LF-separated paragraph; no exact text/sentence/word-count claim.',
    },
    'bc-password-original-length': {
      mime: 'text/plain', checkedFields: ['text.length'],
      predicate: 'Only full untrimmed JavaScript text.length===24 code units; no category/entropy/uniqueness claim.',
    },
    'bc-uuid-original-v4': {
      mime: 'text/plain', checkedFields: ['text.trim()'],
      predicate: 'Only trimmed text matches the frozen lowercase UUID v4/variant regex; no uniqueness/unpredictability claim.',
    },
  };
  const descriptor = descriptors[oracle.kind];
  if (!descriptor) fail('Group BC unsupported protected predicate.');
  const closed = { kind: oracle.kind, mime: descriptor.mime,
    ...(oracle.kind === 'bc-tv-original-geometry' ? {
      exactFields: { widthIn: 4, heightIn: 3, referenceDistanceIn: 4.5 },
      onlyNumericComparison: descriptor.onlyNumericComparison,
    } : {}),
    authority: 'Exact accepted original predicate only; public actual-run witness, no seeded/learned output golden.' };
  if (!isDeepStrictEqual(oracle, closed)) fail('Group BC closed independent predicate parameters changed.');
  return descriptor;
}

export function independentArtifactExpectation(authority, artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length !== authority.artifactOracles.length)
    fail('Complete artifact list is required for receipt attribution.');
  function fields(value, prefix = '$') {
    return value && typeof value === 'object'
      ? Object.entries(value).flatMap(([key, item]) =>
          fields(item, Array.isArray(value) ? `${prefix}[${key}]` : `${prefix}.${key}`),
        )
      : [prefix];
  }
  const authorityKind =
    authority.qualificationKind ??
    (Number.isSafeInteger(authority.fixtureIndex)
      ? 'declared-fixture literal'
      : 'protected source control');
  const artifactChecks = artifacts.map((artifact, index) => {
    const oracle = authority.artifactOracles[index];
    const bc = typeof oracle.kind === 'string' && oracle.kind.startsWith('bc-') ? groupBCArtifactDescriptor(oracle) : null;
    if (authority.qualificationKind === 'group B2 C6 source-bound fixture' && artifact.mime !== oracle.mime)
      fail('Group BC receipt artifact MIME differs from ordered authority.');
    return {
      index,
      actualMime: artifact.mime ?? null,
      expectedMime: oracle.mime ?? null,
      oracleKind: oracle.kind,
      authorityKind,
      scope:
        oracle.kind === 'json-exact'
          ? 'Whole parsed JSON equality, including absence of extra keys.'
          : oracle.kind === 'text-exact'
            ? 'Complete UTF8 text equality.'
            : oracle.kind === 'bytes-exact'
              ? 'Complete byte equality.'
              : oracle.kind === 'json-fields'
                ? 'Partial named JSON fields only.'
                : `Protected ${oracle.kind} predicates only.`,
      ...(oracle.kind === 'json-fields' ? { checkedFields: fields(oracle.expected) } : {}),
      ...(bc ? { checkedFields: bc.checkedFields, predicate: bc.predicate,
        ...(bc.onlyNumericComparison ? { onlyNumericComparison: bc.onlyNumericComparison } : {}) } : {}),
      ...(oracle.relativeTolerance !== undefined
        ? { relativeTolerance: oracle.relativeTolerance }
        : {}),
      ...(oracle.absoluteTolerance !== undefined
        ? { absoluteTolerance: oracle.absoluteTolerance }
        : {}),
    };
  });
  return {
    oracleKey: authority.key,
    authorityPins: authority.authorityPins,
    check: artifactChecks
      .map(
        (item) =>
          `Output${item.index} ${item.actualMime}: ${item.oracleKind}; ${item.scope} Authority: ${item.authorityKind}.`,
      )
      .join(' '),
    artifactChecks,
  };
}
export function assertIndependentArtifactExpectation(authority, artifacts, actual) {
  assert.deepEqual(actual, independentArtifactExpectation(authority, artifacts),
    'Independent receipt must describe the complete actual per-artifact oracle/MIME/scope.');
}
export async function protectedNameModuleFixtures(root, oracles) {
  const source = 'packages/core/test/utilities-names.test.ts';
  const moduleSource = 'packages/core/src/utilities/names.ts';
  const bytes = await readOwned(root, source);
  const moduleBytes = await readOwned(root, moduleSource);
  const sourcePin = { path: source, bytes: bytes.length, sha256: sha(bytes) };
  const modulePin = { path: moduleSource, bytes: moduleBytes.length, sha256: sha(moduleBytes) };
  const ts = createRequire(import.meta.url)('typescript');
  const ast = ts.createSourceFile(source, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
  const moduleAst = ts.createSourceFile(
    moduleSource,
    moduleBytes.toString('utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  if (ast.parseDiagnostics.length || moduleAst.parseDiagnostics.length)
    fail('Invalid names source syntax.');
  const actualImport = ast.statements.find(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '../src/utilities/names.js',
  );
  if (
    !actualImport?.importClause?.namedBindings ||
    !ts.isNamedImports(actualImport.importClause.namedBindings) ||
    !actualImport.importClause.namedBindings.elements.some(
      (item) => item.name.text === 'nameTools' && !item.propertyName,
    )
  )
    fail('Original names property case must import the actual nameTools export.');
  const namesDeclaration = moduleAst.statements
    .flatMap((statement) =>
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)
        ? [...statement.declarationList.declarations]
        : [],
    )
    .find(
      (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'nameTools',
    );
  if (
    !namesDeclaration?.initializer ||
    !ts.isArrayLiteralExpression(namesDeclaration.initializer) ||
    namesDeclaration.initializer.elements.length !== 4
  )
    fail('Actual names public export must be its four literal module definitions.');
  const generator = moduleAst.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'generator',
  );
  let defaultExpression;
  function walk(node, visit) {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
  }
  walk(generator, (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'defaults'
    )
      defaultExpression = node.initializer.getText(moduleAst);
  });
  if (defaultExpression !== "{ count: 12, ...(!character ? { topic: '' } : {}), ...defaults }")
    fail('Actual names default projection changed; refusing inferred defaults.');
  const sourceCaseIndex = 50;
  const sourceCase = oracles.sourceCaseCatalog[sourceCaseIndex];
  if (
    sourceCase?.source !== source ||
    sourceCase.sourceSha256 !== sourcePin.sha256 ||
    !bytes.toString('utf8').includes(sourceCase.exactCaseBody)
  )
    fail('Original public names source case is stale.');
  const caseAst = ts.createSourceFile(
    'names-public-case.ts',
    sourceCase.exactCaseBody + ';',
    ts.ScriptTarget.Latest,
    true,
  );
  const caseCall = caseAst.statements[0]?.expression;
  if (caseAst.parseDiagnostics.length || !caseCall || !ts.isCallExpression(caseCall))
    fail('Malformed original public names case.');
  const callback = caseCall.arguments[1];
  if (!callback || !ts.isArrowFunction(callback)) fail('Original public names callback missing.');
  const loop = callback.body.statements?.find(
    (statement) =>
      ts.isForOfStatement(statement) &&
      ts.isIdentifier(statement.expression) &&
      statement.expression.text === 'nameTools',
  );
  if (
    !loop ||
    !ts.isVariableDeclarationList(loop.initializer) ||
    loop.initializer.declarations.length !== 1 ||
    loop.initializer.declarations[0].name.getText(caseAst) !== 'tool'
  )
    fail('Public names control must iterate actual imported modules.');
  const requiredExpressions = [
    "tool.run([], tool.defaults, { signal: new AbortController().signal, executionId: 'names-test', cache: new Map(), onProgress: () => {} })",
    'JSON.parse(await blobs[0]!.text())',
    'expect(result.ideas).toHaveLength(12)',
    'expect(new Set(result.ideas.map(row => row.name)).size).toBe(12)',
    "expect(result.notice).toContain('not been checked')",
  ];
  const actualExpressions = new Set();
  walk(loop.statement, (node) => {
    if (ts.isCallExpression(node)) actualExpressions.add(node.getText(caseAst));
  });
  for (const expression of requiredExpressions)
    if (!actualExpressions.has(expression))
      fail('Actual public names property assertion/run changed.');
  function literal(node) {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isObjectLiteralExpression(node))
      return Object.fromEntries(
        node.properties.map((property) => {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name))
            fail('Nonliteral names default.');
          return [property.name.text, literal(property.initializer)];
        }),
      );
    fail('Unsupported names literal default.');
  }
  return namesDeclaration.initializer.elements.map((node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isIdentifier(node.expression) ||
      node.expression.text !== 'generator' ||
      node.arguments.length !== 4 ||
      !ts.isStringLiteral(node.arguments[0])
    )
      fail('Public names IDs must come from literal actual generator calls.');
    const engineId = node.arguments[0].text;
    const params = {
      count: 12,
      ...(engineId === 'dnd-name-generator' ? {} : { topic: '' }),
      ...literal(node.arguments[2]),
    };
    return {
      key: `protected-public-names-${engineId}`,
      engineId,
      params,
      inputs: [],
      usesPinnedDefaults: true,
      qualificationKind: 'supplemental original public names property control',
      sourceCaseBinding: {
        sourceCaseIndex,
        sourcePin,
        modulePin,
        exactCaseBodySha256: sha(sourceCase.exactCaseBody),
        actualImportExpression: actualImport.getText(ast),
        actualModuleDefinitionExpression: node.getText(moduleAst),
        publicRunAndAssertions: requiredExpressions,
      },
      supplementalSourceCaseCoverage: {
        sourceCaseIndex,
        role: 'Actual imported nameTools public-module loop; original helper pool selections are retained separately.',
      },
      authorityPins: [sourcePin, modulePin],
      artifactOracles: [
        {
          kind: 'names-original-public-properties',
          count: 12,
          distinctNames: 12,
          noticeIncludes: 'not been checked',
          authority:
            'Original case50 actual public-module random outputs: independent count, uniqueness and availability notice; no fixed name strings or RNG override.',
        },
      ],
      coveredBranches: ['canonical-known-answer'],
    };
  });
}
export async function protectedPlanningCaseCandidates(root, oracles, engine) {
  const source = 'packages/core/test/utilities-planning.test.ts';
  const bytes = await readOwned(root, source);
  const sourcePin = { path: source, bytes: bytes.length, sha256: sha(bytes) };
  const ts = createRequire(import.meta.url)('typescript');
  const whole = ts.createSourceFile(source, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
  const nearDefinition = whole.statements
    .flatMap((statement) =>
      ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [],
    )
    .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'near');
  if (
    !nearDefinition ||
    !nearDefinition.initializer ||
    nearDefinition.initializer.getText(whole) !==
      '(actual: unknown, expected: number) => expect(actual).toBeCloseTo(expected, 8)'
  )
    fail('Protected planning near helper precision changed.');
  const candidates = [];
  function unwrap(node) {
    while (
      node &&
      (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node))
    )
      node = node.expression;
    return node;
  }
  function literal(node) {
    node = unwrap(node);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand)
    )
      return -Number(node.operand.text);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (ts.isObjectLiteralExpression(node))
      return Object.fromEntries(
        node.properties.map((property) => {
          if (
            !ts.isPropertyAssignment(property) ||
            !(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ||
            ['__proto__', 'constructor', 'prototype'].includes(property.name.text)
          )
            throw new Error('Nonliteral planning property.');
          return [property.name.text, literal(property.initializer)];
        }),
      );
    throw new Error('Planning expected values must be independent literal data.');
  }
  for (const sourceCaseIndex of engine.oracle.selectedSourceCaseIndexes) {
    const sourceCase = oracles.sourceCaseCatalog[sourceCaseIndex];
    if (sourceCase.source !== source) continue;
    if (
      sourceCase.sourceSha256 !== sourcePin.sha256 ||
      !bytes.toString('utf8').includes(sourceCase.exactCaseBody)
    )
      fail('Protected planning source case is stale.');
    const ast = ts.createSourceFile(
      'planning-case.ts',
      sourceCase.exactCaseBody + ';',
      ts.ScriptTarget.Latest,
      true,
    );
    if (
      ast.parseDiagnostics.length ||
      ast.statements.length !== 1 ||
      !ts.isExpressionStatement(ast.statements[0])
    )
      fail('Malformed protected planning case.');
    const call = ast.statements[0].expression;
    if (
      !ts.isCallExpression(call) ||
      !ts.isIdentifier(call.expression) ||
      call.expression.text !== 'it'
    )
      continue;
    const callback = call.arguments[1];
    if (!callback || !ts.isArrowFunction(callback)) continue;
    const declarations = new Map();
    function walk(node, visit) {
      if (
        ts.isForStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node)
      )
        return;
      visit(node);
      ts.forEachChild(node, (child) => walk(child, visit));
    }
    walk(callback.body, (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
        declarations.set(
          node.name.text,
          declarations.has(node.name.text) ? null : node.initializer,
        );
    });
    function producer(node, seen = new Set()) {
      node = unwrap(node);
      if (ts.isIdentifier(node) && declarations.get(node.text) && !seen.has(node.text)) {
        const next = new Set(seen);
        next.add(node.text);
        return producer(declarations.get(node.text), next);
      }
      return ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'run'
        ? node
        : undefined;
    }
    walk(callback.body, (node) => {
      let run, expected, absoluteTolerance;
      try {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'near' &&
          node.arguments.length === 2
        ) {
          const field = unwrap(node.arguments[0]);
          if (!ts.isPropertyAccessExpression(field)) return;
          run = producer(field.expression);
          const value = literal(node.arguments[1]);
          if (typeof value !== 'number') return;
          expected = { [field.name.text]: value };
          absoluteTolerance = 5e-9;
        } else if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ['toMatchObject', 'toEqual', 'toBe'].includes(node.expression.name.text) &&
          node.arguments.length === 1
        ) {
          const expectCall = node.expression.expression;
          if (
            !ts.isCallExpression(expectCall) ||
            !ts.isIdentifier(expectCall.expression) ||
            expectCall.expression.text !== 'expect' ||
            expectCall.arguments.length !== 1
          )
            return;
          const subject = unwrap(expectCall.arguments[0]);
          if (ts.isPropertyAccessExpression(subject)) {
            run = producer(subject.expression);
            expected = { [subject.name.text]: literal(node.arguments[0]) };
          } else {
            run = producer(subject);
            expected = literal(node.arguments[0]);
          }
        }
        if (
          !run ||
          run.arguments.length < 1 ||
          run.arguments.length > 2 ||
          literal(run.arguments[0]) !== engine.id
        )
          return;
        const params = run.arguments[1] ? literal(run.arguments[1]) : {};
        if (
          !expected ||
          typeof expected !== 'object' ||
          !Object.keys(expected).length ||
          !params ||
          Array.isArray(params) ||
          typeof params !== 'object'
        )
          return;
        candidates.push({
          params,
          oracle: {
            kind: 'json-fields',
            expected,
            ...(absoluteTolerance === undefined ? {} : { absoluteTolerance }),
          },
          binding: {
            sourceCaseIndex,
            sourcePin,
            exactCaseBodySha256: sha(sourceCase.exactCaseBody),
            assertionExpression: node.getText(ast),
            producerExpression: run.getText(ast),
          },
        });
      } catch {
        /* Nonliteral and helper-only controls remain protected but are not executable fixture candidates. */
      }
    });
  }
  return candidates;
}
export async function protectedTextCaseCandidates(root, oracles, engine) {
  const families = {
    'word-counter': [
      'packages/core/test/tools/word-counter/word-counter-extension.test.ts',
      'countWordText',
    ],
    'json-formatter': [
      'packages/core/test/tools/json-formatter/json-formatter-extension.test.ts',
      'formatJsonText',
    ],
    'code-beautifier': ['packages/core/test/utilities/code-beautifier.test.ts', 'beautifyCode'],
    'number-base-converter': [
      'packages/core/test/tools/number-base-converter/extensions.test.ts',
      'run',
    ],
    'json-path': ['packages/core/test/tools/json-path/json-path.test.ts', 'run'],
  };
  const family = families[engine.id];
  if (!family) fail('No protected text case family exists for this engine.');
  const sourceBytes = await readOwned(root, family[0]);
  const sourcePin = { path: family[0], bytes: sourceBytes.length, sha256: sha(sourceBytes) };
  const ts = createRequire(import.meta.url)('typescript');
  const candidates = [];
  function unwrapped(node) {
    while (
      node &&
      (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isAwaitExpression(node))
    )
      node = node.expression;
    return node;
  }
  function literal(node, env) {
    node = unwrapped(node);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(node) && Object.hasOwn(env, node.text)) return env[node.text];
    if (ts.isArrayLiteralExpression(node))
      return node.elements.map((element) => literal(element, env));
    if (ts.isObjectLiteralExpression(node)) {
      const out = {};
      for (const property of node.properties) {
        if (ts.isShorthandPropertyAssignment(property))
          out[property.name.text] = literal(property.name, env);
        else if (
          ts.isPropertyAssignment(property) &&
          (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))
        ) {
          if (['__proto__', 'constructor', 'prototype'].includes(property.name.text))
            throw new Error('Non-data key');
          out[property.name.text] = literal(property.initializer, env);
        } else throw new Error('Nonliteral property');
      }
      return out;
    }
    throw new Error('Not a protected literal expression.');
  }
  for (const index of engine.oracle.selectedSourceCaseIndexes) {
    const sourceCase = oracles.sourceCaseCatalog[index];
    if (sourceCase.source !== family[0]) continue;
    if (
      sourceCase.sourceSha256 !== sourcePin.sha256 ||
      !sourceBytes.toString('utf8').includes(sourceCase.exactCaseBody)
    )
      fail('Protected source case changed; refusing stale text fixture authority.');
    const ast = ts.createSourceFile(
      'protected-case.ts',
      sourceCase.exactCaseBody + ';',
      ts.ScriptTarget.Latest,
      true,
    );
    if (
      ast.parseDiagnostics.length ||
      ast.statements.length !== 1 ||
      !ts.isExpressionStatement(ast.statements[0])
    )
      fail('Malformed protected case.');
    const caseCall = ast.statements[0].expression;
    if (!ts.isCallExpression(caseCall)) fail('Protected case is not an actual test call.');
    const callback = caseCall.arguments[1];
    if (!callback || !ts.isArrowFunction(callback)) continue;
    const declarations = new Map();
    function collectDeclarations(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
        declarations.set(node.name.text, node.initializer);
      ts.forEachChild(node, collectDeclarations);
    }
    collectDeclarations(callback.body);
    let tuples = [null];
    if (ts.isCallExpression(caseCall.expression)) {
      const inner = caseCall.expression;
      if (!ts.isPropertyAccessExpression(inner.expression) || inner.expression.name.text !== 'each')
        continue;
      tuples = literal(inner.arguments[0], {});
    }
    for (const [tupleIndex, tuple] of tuples.entries()) {
      const env = {};
      if (tuple)
        callback.parameters.forEach((parameter, at) => {
          if (ts.isIdentifier(parameter.name)) env[parameter.name.text] = tuple[at];
        });
      function findProducer(node, seen = new Set()) {
        node = unwrapped(node);
        if (ts.isIdentifier(node) && declarations.has(node.text) && !seen.has(node.text)) {
          const next = new Set(seen);
          next.add(node.text);
          return findProducer(declarations.get(node.text), next);
        }
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === family[1]
        )
          return node;
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          if (node.expression.name.text === 'text' && node.arguments.length === 0)
            return findProducer(node.expression.expression, seen);
          if (
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === 'JSON' &&
            node.expression.name.text === 'parse' &&
            node.arguments.length === 1
          )
            return findProducer(node.arguments[0], seen);
        }
        return undefined;
      }
      function visitAssertion(node) {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ['toBe', 'toEqual', 'toMatchObject'].includes(node.expression.name.text)
        ) {
          const expectCall = node.expression.expression;
          if (
            ts.isCallExpression(expectCall) &&
            ts.isIdentifier(expectCall.expression) &&
            expectCall.expression.text === 'expect' &&
            expectCall.arguments.length === 1 &&
            node.arguments.length === 1
          ) {
            const producer = findProducer(expectCall.arguments[0]);
            if (producer) {
              let derived;
              try {
                const value = literal(producer.arguments[0], env);
                let text = value,
                  params = producer.arguments[1] ? literal(producer.arguments[1], env) : {};
                if (engine.id === 'code-beautifier') params = { language: params };
                if (engine.id === 'json-path') {
                  text = JSON.stringify(value);
                  params = {
                    expression: params,
                    limit: producer.arguments[2] ? literal(producer.arguments[2], env) : 0,
                  };
                }
                if (
                  engine.id === 'number-base-converter' &&
                  params.conversionKind === 'utf8-bytes' &&
                  !Object.hasOwn(params, 'direction')
                )
                  params = { ...params, direction: 'encode' };
                const expected = literal(node.arguments[0], env);
                if (typeof text !== 'string') throw new Error('Input is not literal text.');
                derived = {
                  text,
                  params,
                  oracle: {
                    kind: typeof expected === 'string' ? 'text-exact' : 'json-fields',
                    expected,
                  },
                };
                if (engine.id === 'number-base-converter' && params.conversionKind !== 'utf8-bytes')
                  derived.oracle = { kind: 'json-fields', expected: JSON.parse(expected) };
              } catch {
                /* Nonliteral/state/refusal assertions are not canonical fixture candidates. */
              }
              if (derived)
                candidates.push({
                  ...derived,
                  binding: {
                    sourceCaseIndex: index,
                    sourcePin,
                    exactCaseBodySha256: sha(sourceCase.exactCaseBody),
                    assertionExpression: node.getText(ast),
                    producerExpression: producer.getText(ast),
                    tupleIndex: tuple ? tupleIndex : null,
                  },
                });
            }
          }
        }
        ts.forEachChild(node, visitAssertion);
      }
      visitAssertion(callback.body);
    }
  }
  return candidates;
}
async function validateVerifiedEngine(root, engine, gates, oracles, tool) {
  const verification = engine.verification;
  if (!verification || !Array.isArray(verification.cases) || !verification.cases.length)
    fail(`Verified ${engine.id} has no full artifact cases.`);
  if (
    !Array.isArray(verification.coveredBranches) ||
    !verification.coveredBranches.length ||
    !Array.isArray(verification.requiredBranches) ||
    !verification.requiredBranches.length
  )
    fail('Explicit full branch coverage is required.');
  assert.deepEqual(
    [...verification.coveredBranches].sort(),
    requiredBranchKeys(tool, engine),
    'Partial branch coverage cannot verify a row.',
  );
  assert.deepEqual(
    [...verification.requiredBranches].sort(),
    requiredBranchKeys(tool, engine),
    'Self-declared branch list cannot replace actual schema/case/surface authority.',
  );
  const acceptance = gates.currentIntegratedSourceGate.acceptance;
  if (
    gates.currentIntegratedSourceGate.status !== 'accepted' ||
    !acceptance ||
    !Array.isArray(acceptance.engineIds) ||
    !acceptance.engineIds.includes(engine.id)
  )
    fail(`Current integrated SOURCE gate missing for ${engine.id}`);
  const scopePins = new Map((acceptance.sourcePins ?? []).map((item) => [item.path, item.sha256]));
  for (const item of engine.sourceBinding.pins)
    if (scopePins.get(item.path) !== item.sha256)
      fail(`Current integrated SOURCE scope missing/stale: ${item.path}`);
  await verifyPin(root, acceptance.receipt, { nonempty: true });
  const keys = new Set();
  const digest = sourceBindingDigest(engine.sourceBinding);
  for (const item of verification.cases) {
    if (keys.has(item.caseKey) || typeof item.caseKey !== 'string' || !item.caseKey)
      fail('Duplicate/missing artifact case key.');
    keys.add(item.caseKey);
    const producer = await validateCommandReceipt(
      root,
      item.producerReceipt,
      'producer',
      engine.id,
      digest,
    );
    const checker = await validateCommandReceipt(
      root,
      item.checkerReceipt,
      'checker',
      engine.id,
      digest,
    );
    if (checker.producerOwner !== producer.owner)
      fail('Independent checker receipt must bind actual producer owner.');
    assert.deepEqual(
      item.artifacts,
      producer.artifactPins,
      'Complete actual emitted output list must match the producer receipt.',
    );
    if (producer.caseKey !== item.caseKey)
      fail('Artifact case must match the actual native producer.');
    if (!engine.surfaces.includes(item.surface))
      fail('Artifact surface is outside module contract.');
    if (!Array.isArray(item.artifacts) || !item.artifacts.length)
      fail('Every scalar/file case requires complete artifacts.');
    const authority = oracles.executableFixtures?.find(
      (fixture) => fixture.key === item.oracleKey && fixture.engineId === engine.id,
    );
    if (!authority)
      fail('Named independently executable oracle is absent; no historical weak fallback.');
    const browserAuthorityBridge = await boundFixtureOracle(root, authority, oracles, engine);
    if (authority.qualificationKind === 'genuine browser fixed independent control') {
      if (browserAuthorityBridge?.kind !== 'source9-binding-failure-cleanup-bridge-v1' ||
          !isDeepStrictEqual(producer.browserAuthorityBridge, browserAuthorityBridge) ||
          !isDeepStrictEqual(checker.browserAuthorityBridge, browserAuthorityBridge))
        fail('Browser fixture producer/checker bridge differs.');
      const manifest = JSON.parse(await verifyPin(root, producer.manifest, { nonempty: true }));
      await checkBrowserAuthorityCommandPins(root, producer, manifest, browserAuthorityBridge);
    } else if (browserAuthorityBridge !== undefined || Object.hasOwn(producer, 'browserAuthorityBridge') ||
               Object.hasOwn(checker, 'browserAuthorityBridge')) {
      fail('Non-browser receipts must omit browserAuthorityBridge.');
    }
    if (item.artifacts.length !== authority.artifactOracles.length)
      fail('Every emitted output needs an independent artifact oracle.');
    await checkFixtureArtifacts(root, item.artifacts, authority);
  }
  requireNonemptyCanonicalCase(verification.cases);
}
export async function loadCatalogDocuments(root) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(CATALOG_FILES).map(async ([key, file]) => [
        key,
        JSON.parse(await readOwned(root, file)),
      ]),
    ),
  );
}
export async function checkArtifactRun({ root, directory, owner }) {
  if (
    !/^docs\/catalog-artifacts\/[a-zA-Z0-9-]{1,100}$/.test(directory) ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(owner)
  )
    fail('An owned artifact run and explicit independent checker owner are required.');
  const documents = await loadCatalogDocuments(root);
  const entries = await fs.readdir(confinedPath(root, directory), { withFileTypes: true });
  const receiptPaths = entries
    .filter((entry) => entry.isFile() && /^producer-.+\.json$/.test(entry.name))
    .map((entry) => `${directory}/${entry.name}`);
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const relative = `${directory}/${entry.name}/producer-receipt.json`;
    try {
      await fs.access(confinedPath(root, relative));
      receiptPaths.push(relative);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!receiptPaths.length) fail('No complete actual producer receipts in this artifact run.');
  const checked = [];
  const startedAt = new Date().toISOString();
  for (const relative of receiptPaths.sort()) {
    const producerBytes = await readOwned(root, relative);
    const producerPin = { path: relative, bytes: producerBytes.length, sha256: sha(producerBytes) };
    const producer = JSON.parse(producerBytes);
    if (producer.owner === owner) fail('Producer and independent checker ownership must differ.');
    const engine = documents.mapping.rows
      .flatMap((row) => row.engines)
      .find((item) => item.id === producer.engineId);
    if (!engine) fail('Producer names no actual current catalog engine.');
    for (const pin of engine.sourceBinding.pins) await verifyPin(root, pin);
    await validateCommandReceipt(
      root,
      producerPin,
      'producer',
      engine.id,
      sourceBindingDigest(engine.sourceBinding),
    );
    const manifest = JSON.parse(await verifyPin(root, producer.manifest, { nonempty: true }));
    const key = producer.oracleKey ?? manifest.oracleKey;
    const authority = documents.oracles.executableFixtures.find(
      (item) => item.key === key && item.engineId === engine.id,
    );
    if (!authority) fail('Producer lacks its named exact independent fixture.');
    const browserAuthorityBridge = await boundFixtureOracle(root, authority, documents.oracles, engine);
    if (authority.qualificationKind === 'genuine browser fixed independent control') {
      if (browserAuthorityBridge?.kind !== 'source9-binding-failure-cleanup-bridge-v1' ||
          !isDeepStrictEqual(producer.browserAuthorityBridge, browserAuthorityBridge))
        fail('Browser fixture producer bridge differs.');
      await checkBrowserAuthorityCommandPins(root, producer, manifest, browserAuthorityBridge);
    } else if (browserAuthorityBridge !== undefined || Object.hasOwn(producer, 'browserAuthorityBridge')) {
      fail('Non-browser producer receipt must omit browserAuthorityBridge.');
    }
    if (authority.surface === 'web') {
      await checkBrowserProductionBinding(root, producer, manifest, engine);
      assert.deepEqual(
        manifest.artifacts
          .filter((item) => item.engineId === engine.id)
          .map((item) => item.artifact),
        producer.artifactPins,
      );
      assert(manifest.completedCases.includes(engine.id));
      await verifyPin(root, producer.productionBuildManifest, { nonempty: true });
      if (engine.id === 'mp3-to-midi') {
        assert.equal(manifest.observedMidi.sampleRate, 48000);
        assert(
          manifest.observedMidi.workers.some((url) =>
            new URL(url).pathname.includes('file-worker'),
          ),
        );
      }
    } else {
      assert.equal(manifest.caseKey, producer.caseKey);
      assert.equal(manifest.engineId, engine.id);
      assert.deepEqual(manifest.params, authority.params);
      assert.deepEqual(manifest.inputs, authority.inputs);
      assert.deepEqual(manifest.artifacts, producer.artifactPins);
      await verifyPin(root, manifest.builtEntry, { nonempty: true });
    }
    await checkFixtureArtifacts(root, producer.artifactPins, authority);
    if (['supplemental source-bound fixture', 'group A31 source-bound fixture', 'group B2 C6 source-bound fixture'].includes(authority.qualificationKind))
      assertIndependentArtifactExpectation(authority, producer.artifactPins, producer.independentExpectation);
    checked.push({
      engineId: engine.id,
      caseKey: producer.caseKey,
      oracleKey: key,
      producerOwner: producer.owner,
      producerReceipt: producerPin,
      artifactPins: producer.artifactPins,
      sourceBindingDigest: sourceBindingDigest(engine.sourceBinding),
      ...(authority.qualificationKind === 'genuine browser fixed independent control' ? { browserAuthorityBridge } : {}),
    });
  }
  const outputDirectory = `${directory}/checker-${owner}`;
  await fs.mkdir(confinedPath(root, outputDirectory), { recursive: false });
  const logPath = `${outputDirectory}/checker-native.log`;
  await fs.writeFile(
    confinedPath(root, logPath),
    JSON.stringify(
      { checked, actualIndependentExpectations: true, rowPromotion: 'pending' },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  const logBytes = await readOwned(root, logPath),
    scriptBytes = await readOwned(root, 'tools/check-catalog-evidence.mjs');
  const command = [
    process.execPath,
    'tools/check-catalog-evidence.mjs',
    '--check-artifact-run',
    directory,
    '--checker-owner',
    owner,
  ];
  const finishedAt = new Date().toISOString();
  const receipts = [];
  for (const [index, item] of checked.entries()) {
    const receipt = {
      ...item,
      role: 'checker',
      owner,
      command,
      cwd: '.',
      exitCode: 0,
      caseCount: 1,
      startedAt,
      finishedAt,
      log: { path: logPath, bytes: logBytes.length, sha256: sha(logBytes) },
      commandSourcePins: [
        {
          path: 'tools/check-catalog-evidence.mjs',
          bytes: scriptBytes.length,
          sha256: sha(scriptBytes),
        },
      ],
      scope:
        'Independent complete fixed artifact/source-case checks only; all branches/current integrated SOURCE/package/mobile/physical acceptance remain required. No row promotion.',
    };
    const receiptPath = `${outputDirectory}/case-${index + 1}.json`;
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
    await fs.writeFile(confinedPath(root, receiptPath), bytes, { flag: 'wx' });
    receipts.push({ path: receiptPath, bytes: bytes.length, sha256: sha(bytes) });
  }
  return { checkedCases: checked.length, checkerOwner: owner, receipts, rowPromotion: 'pending' };
}

const BROWSER_BINDING_MODE = 'production-source-artifact-context-v1';
const bindingKeys = (value, keys, message) => {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertyNames(value).sort().join(',') !== [...keys].sort().join(',') ||
      Object.getOwnPropertySymbols(value).length) fail(message);
};
const bindingClaims = Object.freeze({ consumedModuleGraphObserved: false, moduleLevelViteMapping: false,
  midiWorkerBuildGraphObserved: false, workerDistToEmittedAssociation: false,
  fixedWorkflowOnly: true, servedResponseBodyEquality: false });

export function validateObservedBindingPolicy(policy) {
  const message = 'Incomplete browser build observation';
  bindingKeys(policy, ['consumer', 'command', 'mode', 'resolve', 'build', 'worker'], message);
  bindingKeys(policy.resolve, ['conditions', 'externalConditions', 'mainFields', 'extensions', 'dedupe',
    'preserveSymlinks', 'builtins', 'noExternal', 'external', 'alias'], message);
  bindingKeys(policy.build, ['ssr', 'target', 'outDir', 'rolldownOptions'], message);
  bindingKeys(policy.build.rolldownOptions, ['external'], message);
  bindingKeys(policy.worker, ['format', 'rolldownOptions'], message);
  bindingKeys(policy.worker.rolldownOptions, ['external'], message);
  let visited = 0;
  function value(item, depth = 0) {
    if (++visited > 4096 || depth > 8) fail(message);
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail(message); return; }
    if (typeof item === 'string') { if (Buffer.byteLength(item) > 8192) fail(message); return; }
    if (!item || typeof item !== 'object') fail(message);
    if (Array.isArray(item)) {
      if (item.length > 256 || Object.getOwnPropertyNames(item).length !== item.length + 1) fail(message);
      item.forEach((child) => value(child, depth + 1)); return;
    }
    if (!['undefined', 'absent', 'regexp'].includes(item.kind)) {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) fail(message);
      for (const [key, child] of Object.entries(item)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(message);
        value(child, depth + 1);
      }
      return;
    }
    bindingKeys(item, item.kind === 'regexp' ? ['kind', 'source', 'flags'] : ['kind'], message);
    if (item.kind === 'regexp') {
      if (typeof item.source !== 'string' || typeof item.flags !== 'string' ||
          !/^[dgimsuvy]*$/.test(item.flags) || new Set(item.flags).size !== item.flags.length ||
          item.flags.includes('u') && item.flags.includes('v')) fail(message);
      value(item.source, depth + 1); value(item.flags, depth + 1);
    }
  }
  value(policy);
  const aliases = policy.resolve.alias;
  if (Array.isArray(aliases)) {
    if (aliases.length > 128) fail(message);
    for (const alias of aliases) {
      bindingKeys(alias, ['find', 'replacement', 'customResolver'], message);
      if (!(typeof alias.find === 'string' || alias.find?.kind === 'regexp') ||
          typeof alias.replacement !== 'string' || !['undefined', 'absent'].includes(alias.customResolver?.kind)) fail(message);
    }
  } else if (!['undefined', 'absent'].includes(aliases?.kind)) fail(message);
  if (Buffer.byteLength(JSON.stringify(policy)) > 256 * 1024) fail(message);
}

export function bindingTemplateFromSource(source, literals) {
  const ts = createRequire(import.meta.url)('typescript');
  const ast = ts.createSourceFile('productionBrowserHarness.ts', source, ts.ScriptTarget.Latest, true);
  if (ast.parseDiagnostics.length) fail('Browser binding generated-config template mismatch');
  const declarations = [];
  function walk(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'BINDING_CONFIG_TEMPLATE') declarations.push(node);
    ts.forEachChild(node, walk);
  }
  walk(ast);
  if (declarations.length !== 1) fail('Browser binding generated-config template mismatch');
  const value = declarations[0].initializer;
  if (!value || !ts.isCallExpression(value) || !ts.isPropertyAccessExpression(value.expression) ||
      value.expression.name.text !== 'join' || !ts.isArrayLiteralExpression(value.expression.expression) ||
      value.arguments.length !== 1 || !ts.isStringLiteral(value.arguments[0]) || value.arguments[0].text !== '\n' ||
      value.expression.expression.elements.some((item) => !ts.isStringLiteral(item)))
    fail('Browser binding generated-config template mismatch');
  const template = value.expression.expression.elements.map((item) => item.text).join('\n');
  const marker = '__WYREUP_BINDING_OPTIONS_JSON__';
  if (template.split(marker).length !== 2 || !template.endsWith('\n')) fail('Browser binding generated-config template mismatch');
  bindingKeys(literals, ['runId', 'observationDir', 'observerIdentity'], 'Browser binding generated-config template mismatch');
  bindingKeys(literals.observerIdentity, ['relativePath', 'bytes', 'sha256'], 'Browser binding generated-config template mismatch');
  return template.replace(marker, () => JSON.stringify({ runId: literals.runId, observationDir: literals.observationDir,
    observerIdentity: { relativePath: literals.observerIdentity.relativePath, bytes: literals.observerIdentity.bytes, sha256: literals.observerIdentity.sha256 } }));
}

export function validateBindingRunRelation(binding, runId) {
  const convention = binding.templateBinding?.producerPathConvention === 'posix' ? path.posix :
    binding.templateBinding?.producerPathConvention === 'win32' ? path.win32 : null;
  const originalRoot = binding.templateBinding?.originalRoot;
  const literals = binding.templateBinding?.literals;
  const suffix = `docs/catalog-artifacts/${runId}/build-evidence/binding-${runId}`;
  if (!/^[A-Za-z0-9-]{1,100}$/.test(runId) || !convention || typeof originalRoot !== 'string' ||
      !convention.isAbsolute(originalRoot) || !literals || typeof literals.observationDir !== 'string' ||
      convention.relative(originalRoot, literals.observationDir).split(convention.sep).join('/') !== suffix ||
      binding.runId !== runId || binding.observationDir !== literals.observationDir || literals.runId !== runId ||
      binding.durableConfig?.path !== `${suffix}/generated-config.mjs.txt`)
    fail('Browser binding run identity mismatch');
  return { convention, originalRoot, literals, suffix };
}

export function validateBindingRoleJoin(role, build, runId) {
  const inventories = { 'copied-original': build.inputs, 'preparation-output': build.preparedInputs,
    'binding-generated': build.generatedInputs, 'emitted-output': build.artifacts };
  if (inventories[role.captureClass]) {
    const records = inventories[role.captureClass];
    if (!Array.isArray(records) || new Set(records.map((item) => item.path)).size !== records.length)
      fail('Browser binding unmapped source role');
    const matches = records.filter((item) => item.path === role.logicalPath);
    if (matches.length !== 1 || matches[0].bytes !== role.bytes || matches[0].sha256 !== role.sha256)
      fail(role.captureClass === 'copied-original' ? 'Browser binding copied-input mismatch' : 'Browser binding unmapped source role');
    return;
  }
  if (role.captureClass === 'selected-dependency-context') {
    const owners = build.dependencyIdentities?.filter((item) => item.packageRoot === role.packageRoot);
    if (owners?.length !== 1 || owners[0].packageJson.bytes !== role.bytes || owners[0].packageJson.sha256 !== role.sha256)
      fail('Browser binding unmapped source role');
    return;
  }
  if (role.captureClass === 'selected-named-export-edge' && role.edge?.sourcePin?.sha256 === role.sha256 &&
      role.edge.requestedName && role.edge.statementSha256 && role.runId === runId) return;
  if (role.captureClass === 'selected-core-runtime' && role.runId === runId && Array.isArray(role.association)) {
    if (role.association.length !== 2 || !isDeepStrictEqual(role.association.map((item) => item.environment).sort(), ['client', 'prerender']))
      fail('Browser binding core environment-map mismatch');
    for (const association of role.association) {
      const prefix = association.environment === 'client' ? 'browser/' : 'node/';
      if (!association.entry?.startsWith(prefix) || association.map !== `${association.entry}.map` ||
          !association.sourceMap?.startsWith(prefix) || !Number.isSafeInteger(association.sourceIndex) || association.sourceIndex < 0)
        fail('Browser binding core environment-map mismatch');
    }
    return;
  }
  fail('Browser binding unmapped source role');
}

async function bindingParsers(root) {
  const webRequire = createRequire(path.join(root, 'packages/web/package.json'));
  const astroRequire = createRequire(webRequire.resolve('astro/package.json'));
  return { ts: createRequire(import.meta.url)('typescript'),
    svelte: webRequire('svelte/compiler'),
    astro: await import(pathToFileURL(astroRequire.resolve('@astrojs/compiler-rs')).href) };
}

async function localBindingModule(root, importer, specifier) {
  if (!specifier.startsWith('.')) fail('Browser binding unmapped source role');
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  if (base.startsWith('../') || path.posix.isAbsolute(base)) fail('Browser binding unmapped source role');
  const candidates = /\.js$/.test(base) ? [base.slice(0, -3) + '.ts', base] : path.posix.extname(base) ? [base] : [base + '.ts', base + '.js', base + '/index.ts'];
  const found = [];
  for (const candidate of candidates) {
    try { await readOwned(root, candidate); found.push(candidate); }
    catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
  }
  if (found.length !== 1) fail('Browser binding unmapped source role');
  return found[0];
}

async function bindingImports(root, file, parsers, variants, knownVariants) {
  const bytes = await readOwned(root, file), text = bytes.toString('utf8'), result = [];
  if (/\.(css|json)$/.test(file)) return result;
  if (file.endsWith('.svelte') || file.endsWith('.astro')) {
    const parsed = file.endsWith('.svelte') ? parsers.svelte.parse(text) : parsers.astro.parse(text);
    if (parsed.diagnostics?.some((item) => item.severity === 'error')) fail('Browser binding source parser refusal');
    const seen = new Set();
    function walk(node, ancestors = []) {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
        const module = node.source?.value;
        if (typeof module === 'string') result.push({ module, typeOnly: node.importKind === 'type' || node.exportKind === 'type',
          names: node.type === 'ExportAllDeclaration' ? ['*'] : (node.specifiers ?? []).filter((item) => item.importKind !== 'type' && item.exportKind !== 'type')
            .map((item) => item.imported?.name ?? item.imported?.value ?? (item.type === 'ImportDefaultSpecifier' ? 'default' : '*')) });
      }
      if (node.type === 'ImportExpression') {
        if (typeof node.source?.value !== 'string') fail('Browser binding source parser refusal');
        const module = node.source.value;
        // Exclude only mapped literal runners belonging to another variant.
        const otherRunner = file.endsWith('/ToolRunner.svelte') &&
          knownVariants.some((variant) => module === `./runners/${variant}.svelte`) &&
          !variants.some((variant) => module === `./runners/${variant}.svelte`);
        if (!otherRunner) {
          let index = ancestors.length - 1;
          while (index >= 0 && ['AwaitExpression', 'ParenthesizedExpression'].includes(ancestors[index].type)) index--;
          const parent = ancestors[index];
          const member = parent?.type === 'MemberExpression' && !parent.computed ? parent : null;
          const names = module === '@wyreup/core' ? [member?.property?.name] : ['*'];
          if (names.some((name) => typeof name !== 'string')) fail('Browser binding source parser refusal');
          result.push({ module, typeOnly: false, names });
        }
      }
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach((item) => walk(item, [...ancestors, node]));
        else if (child && typeof child === 'object') walk(child, [...ancestors, node]);
      }
    }
    walk(parsed.ast ?? parsed);
    return result;
  }
  const ts = parsers.ts, ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (ast.parseDiagnostics.length) fail('Browser binding source parser refusal');
  function walk(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.importClause;
      const names = [];
      if (clause?.name) names.push('default');
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const item of clause.namedBindings.elements) if (!item.isTypeOnly) names.push((item.propertyName ?? item.name).text);
      } else if (clause?.namedBindings) names.push('*');
      result.push({ module: node.moduleSpecifier.text, typeOnly: Boolean(clause?.isTypeOnly), names });
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier))
      result.push({ module: node.moduleSpecifier.text, typeOnly: node.isTypeOnly,
        names: node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.filter((item) => !item.isTypeOnly).map((item) => (item.propertyName ?? item.name).text) : ['*'] });
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) fail('Browser binding source parser refusal');
      const module = node.arguments[0].text;
      let parent = node.parent;
      while (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent)) parent = parent.parent;
      const names = module === '@wyreup/core' && ts.isPropertyAccessExpression(parent) ? [parent.name.text] : ['*'];
      if (module === '@wyreup/core' && names[0] === '*') fail('Browser binding source parser refusal');
      result.push({ module, typeOnly: false, names });
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  return result;
}

async function selectedCoreEdge(root, file, requestedName, parsers, runId, visited = new Set(), supportingType = false) {
  const identity = `${file}:${requestedName}`;
  if (visited.has(identity)) fail('Browser binding source parser refusal');
  visited.add(identity);
  const bytes = await readOwned(root, file), text = bytes.toString('utf8'), ts = parsers.ts;
  const sourcePin = { path: file, bytes: bytes.length, sha256: sha(bytes) };
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (ast.parseDiagnostics.length) fail('Browser binding source parser refusal');
  const hasModuleRuntime = ast.statements.some((node) => {
    if (ts.isImportDeclaration(node)) return !node.importClause || !node.importClause.isTypeOnly &&
      !(node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && !node.importClause.name &&
        node.importClause.namedBindings.elements.every((item) => item.isTypeOnly));
    return ts.isVariableStatement(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
      ts.isExpressionStatement(node) || ts.isExportAssignment(node) || ts.isEnumDeclaration(node);
  });
  const matches = ast.statements.filter((node) => ts.isExportDeclaration(node) && node.exportClause &&
    ts.isNamedExports(node.exportClause) && node.exportClause.elements.some((item) => item.name.text === requestedName));
  if (matches.length > 1) fail('Browser binding source parser refusal');
  if (!matches.length) {
    const definitions = ast.statements.filter((node) => node.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword) &&
      (node.name?.text === requestedName || ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.text === requestedName)));
    if (definitions.length !== 1 || requestedName === '*') fail('Browser binding source parser refusal');
    if (supportingType) return [];
    return [{ kind: 'runtime-code', captureClass: 'selected-core-runtime', ...sourcePin, logicalPath: file, runId }];
  }
  const statement = matches[0], exported = statement.exportClause.elements.filter((item) => item.name.text === requestedName);
  if (exported.length !== 1 || !supportingType && (statement.isTypeOnly || exported[0].isTypeOnly))
    fail('Browser binding source parser refusal');
  const localName = (exported[0].propertyName ?? exported[0].name).text;
  let moduleSpecifier = statement.moduleSpecifier, importedName = localName, localImport;
  if (moduleSpecifier) {
    if (!ts.isStringLiteralLike(moduleSpecifier)) fail('Browser binding source parser refusal');
  } else {
    const imports = [];
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node)) continue;
      const clause = node.importClause, bindings = clause?.namedBindings;
      if (clause?.name?.text === localName || bindings && ts.isNamespaceImport(bindings) && bindings.name.text === localName)
        fail('Browser binding source parser refusal');
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) if (binding.name.text === localName) imports.push({ node, binding });
      }
    }
    if (imports.length !== 1) fail('Browser binding source parser refusal');
    const { node, binding } = imports[0];
    if (!ts.isStringLiteralLike(node.moduleSpecifier) || !node.moduleSpecifier.text.startsWith('.') ||
        !supportingType && (node.importClause.isTypeOnly || binding.isTypeOnly))
      fail('Browser binding source parser refusal');
    moduleSpecifier = node.moduleSpecifier;
    importedName = (binding.propertyName ?? binding.name).text;
    localImport = { localName, importedName, moduleSpecifier: moduleSpecifier.text,
      start: node.getStart(ast), end: node.end, statementSha256: sha(Buffer.from(node.getText(ast))) };
  }
  const next = await localBindingModule(root, file, moduleSpecifier.text);
  const nextBytes = await readOwned(root, next);
  const edge = { sourcePin, requestedName, importedName, exportedName: exported[0].name.text, supportingType,
    moduleSpecifier: moduleSpecifier.text, start: statement.getStart(ast), end: statement.end,
    statementSha256: sha(Buffer.from(statement.getText(ast))), nextSourcePath: next,
    nextSourcePin: { path: next, bytes: nextBytes.length, sha256: sha(nextBytes) },
    ...localImport ? { localImport } : {} };
  return [{ kind: supportingType ? 'type-only-export-edge' : 'named-export-edge', captureClass: 'selected-named-export-edge', ...sourcePin, logicalPath: file, runId, edge },
    ...!supportingType && hasModuleRuntime ? [{ kind: 'runtime-code', captureClass: 'selected-core-runtime', ...sourcePin, logicalPath: file, runId }] : [],
    ...await selectedCoreEdge(root, next, importedName, parsers, runId, visited, supportingType)];
}

async function bindingDependencyContext(root, importer, specifier, ownerName, owner) {
  const message = 'Browser binding unmapped source role';
  try {
    const require = createRequire(confinedPath(root, importer));
    let manifestPath;
    try { manifestPath = await fs.realpath(require.resolve(`${ownerName}/package.json`)); }
    catch (error) {
      if (!['ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND'].includes(error.code)) throw error;
      // Resolve only the public entry; inspect its package owner without loading it.
      let directory = path.dirname(await fs.realpath(require.resolve(specifier)));
      for (let depth = 0; depth < 64; depth++) {
        const candidate = path.join(directory, 'package.json');
        try {
          const info = await fs.lstat(candidate);
          if (!info.isFile() || info.isSymbolicLink() || await fs.realpath(candidate) !== candidate) fail(message);
          const metadata = JSON.parse((await fs.readFile(candidate)).toString('utf8'));
          if (typeof metadata.name === 'string') {
            if (metadata.name !== ownerName) fail(message);
            manifestPath = candidate;
            break;
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        const parent = path.dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    if (!manifestPath) fail(message);
    const packageRoot = path.dirname(manifestPath);
    const info = await fs.lstat(manifestPath);
    if (!info.isFile() || info.isSymbolicLink() || await fs.realpath(manifestPath) !== manifestPath ||
        owner.packageRoot !== packageRoot || owner.packageJson?.path !== path.join(packageRoot, 'package.json')) fail(message);
    const bytes = await fs.readFile(manifestPath), metadata = JSON.parse(bytes.toString('utf8'));
    const digest = sha(bytes);
    if (metadata.name !== ownerName || owner.name !== metadata.name || owner.version !== metadata.version ||
        typeof metadata.version !== 'string' || owner.packageJson.bytes !== bytes.length ||
        owner.packageJson.sha256 !== digest) fail(message);
    // Source-resolved owner context only, not observed Vite consumption.
    return { packageRoot, bytes: bytes.length, sha256: digest };
  } catch { fail(message); }
}

async function derivedBrowserRoles(root, build, engineId, runId) {
  const parsers = await bindingParsers(root), ts = parsers.ts;
  const variantText = (await readOwned(root, 'packages/web/src/components/runners/variantMap.ts')).toString('utf8');
  const variantAst = ts.createSourceFile('variantMap.ts', variantText, ts.ScriptTarget.Latest, true);
  if (variantAst.parseDiagnostics.length) fail('Browser binding source parser refusal');
  const knownVariants = new Set();
  let variant;
  function findVariant(node) {
    if (ts.isVariableDeclaration(node) && node.name.text === 'VARIANT_MAP' && ts.isObjectLiteralExpression(node.initializer))
      for (const item of node.initializer.properties) if (ts.isPropertyAssignment(item) &&
        (ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name)) && ts.isStringLiteralLike(item.initializer)) {
        knownVariants.add(item.initializer.text);
        if (item.name.text === engineId) variant = item.initializer.text;
      }
    ts.forEachChild(node, findVariant);
  }
  findVariant(variantAst);
  if (!variant) fail('Browser binding unmapped source role');
  const queue = ['packages/web/src/pages/tools/[slug].astro', 'packages/web/src/layouts/BaseLayout.astro',
    'packages/web/src/components/ToolRunner.svelte', `packages/web/src/components/runners/${variant}.svelte`,
    'packages/web/astro.config.mjs', 'packages/web/src/sw.ts', 'packages/web/scripts/pwa.mjs',
    'packages/web/scripts/copy-skills.mjs', 'packages/web/test/fixtures/ProductionCatalogHarness.svelte',
    'packages/web/test/fixtures/ProductionCatalogRoute.astro.txt', 'packages/web/public/_headers'];
  const roles = [], visited = new Set(), core = new Map();
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    if (visited.size >= 4096) fail('Browser binding source parser budget');
    visited.add(file);
    const bytes = await readOwned(root, file), digest = sha(bytes);
    const matches = build.inputs?.filter((item) => item.path === file);
    if (matches?.length !== 1) fail('Browser binding copied-input mismatch');
    roles.push({ kind: 'first-party-context', captureClass: 'copied-original', logicalPath: file, bytes: bytes.length, sha256: digest });
    if (file.endsWith('.txt') || file.endsWith('/_headers')) continue;
    for (const item of await bindingImports(root, file, parsers, [variant], [...knownVariants])) {
      if (item.module.startsWith('.')) queue.push(await localBindingModule(root, file, item.module));
      else if (item.module === '@wyreup/core') {
        if (!item.typeOnly && item.names.length === 0) fail('Browser binding source parser refusal');
        for (const name of item.names) {
          if (name === '*') fail('Browser binding source parser refusal');
          for (const role of await selectedCoreEdge(root, 'packages/core/src/index.ts', name, parsers, runId, new Set(), item.typeOnly))
            core.set(`${role.logicalPath}:${role.kind}:${role.edge?.requestedName ?? ''}`, role);
        }
      } else if (!item.module.startsWith('node:') && !item.module.startsWith('astro:')) {
        const ownerName = item.module.startsWith('@') ? item.module.split('/').slice(0, 2).join('/') : item.module.split('/')[0];
        const owners = build.dependencyIdentities?.filter((owner) => owner.name === ownerName);
        if (owners?.length !== 1) fail('Browser binding unmapped source role');
        const actualOwner = await bindingDependencyContext(root, file, item.module, ownerName, owners[0]);
        roles.push({ kind: 'dependency-owner-context', captureClass: 'selected-dependency-context', ...actualOwner });
      }
    }
  }
  for (const name of ['skill', 'cli-skill', 'mcp-skill']) {
    const logicalPath = `packages/web/public/skills/wyreup${name === 'skill' ? '' : name === 'cli-skill' ? '-cli' : '-mcp'}.md`;
    const source = `packages/${name}/skill.md`, sourceBytes = await readOwned(root, source);
    const input = build.inputs?.find((item) => item.path === source);
    if (!input || input.bytes !== sourceBytes.length || input.sha256 !== sha(sourceBytes)) fail('Browser binding copied-input mismatch');
    const prepared = build.preparedInputs?.find((item) => item.path === logicalPath);
    if (!prepared || prepared.bytes !== sourceBytes.length || prepared.sha256 !== sha(sourceBytes))
      fail('Browser binding unmapped source role');
    roles.push({ kind: 'named-preparation-output', captureClass: 'preparation-output', logicalPath,
      bytes: sourceBytes.length, sha256: sha(sourceBytes), sourceRelationship: source });
  }
  return [...roles, ...core.values()];
}

export async function checkBrowserProductionBinding(root, producer, manifest, engine) {
  const build = JSON.parse(await verifyPin(root, producer.productionBuildManifest, { nonempty: true }));
  const binding = build.browserBindingObservation;
  if (!binding || binding.mode !== BROWSER_BINDING_MODE) fail('Browser binding missing observation mode');
  const runId = manifest.run;
  if (!/^[A-Za-z0-9-]{1,100}$/.test(runId) || manifest.resolvedProductionBuild?.mode !== 'owned-production-build' ||
      binding.runId !== runId || producer.manifest.path !== `docs/catalog-artifacts/${runId}/browser-producer-manifest.json`)
    fail('Browser binding run identity mismatch');
  const context = manifest.browserProductionArtifactContextBinding;
  let origin;
  try { origin = new URL(context?.origin); } catch { fail('Browser binding run identity mismatch'); }
  if (origin.origin !== context.origin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port)
    fail('Browser binding run identity mismatch');
  if (!context || context.runId !== runId || !isDeepStrictEqual(context.claimLimits, bindingClaims) ||
      !Array.isArray(context.bindingFailures) || context.bindingFailures.length !== 0 ||
      !Array.isArray(context.browserResponses) || !Array.isArray(context.controllerSnapshots))
    fail('Incomplete browser build observation');
  if (context.browserResponses.some((item) => item.fromServiceWorker) || context.controllerSnapshots.some((item) => item.controlled))
    fail('Browser binding selected asset served by service worker');
  const observerSource = 'packages/web/test/productionBuildBindingObserver.mjs';
  const readerModule = await import(pathToFileURL(confinedPath(root, observerSource)).href);
  const stageA = await readerModule.readCoordinatedCoreProof(root, runId);
  if (!isDeepStrictEqual(binding.proofPin, stageA.proofPin) ||
      !isDeepStrictEqual(binding.consumedCoordinatedCoreDist?.outputs, stageA.proof.outputs) ||
      binding.consumedCoordinatedCoreDist?.packageTarget !== 'packages/core')
    fail('Browser binding coordinated core proof mismatch: consumed outputs');
  const helperSourcePath = 'packages/web/test/productionBrowserHarness.ts';
  const helperSourcePin = binding.templateBinding.helperSource;
  if (helperSourcePin?.path !== helperSourcePath) fail('Browser binding generated-config template mismatch');
  let helperSource;
  try { helperSource = await verifyPin(root, helperSourcePin, { nonempty: true }); }
  catch { fail('Browser binding generated-config template mismatch'); }
  const { convention, literals, suffix } = validateBindingRunRelation(binding, runId);
  const rendered = bindingTemplateFromSource(helperSource.toString('utf8'), literals);
  let durable;
  try { durable = await verifyPin(root, binding.durableConfig, { nonempty: true }); }
  catch (error) { throw new Error('Browser binding generated-config template mismatch', { cause: error }); }
  if (!durable.equals(Buffer.from(rendered))) fail('Browser binding generated-config template mismatch');
  const observerBytes = await readOwned(root, observerSource);
  if (literals.observerIdentity.relativePath !== observerSource || literals.observerIdentity.bytes !== observerBytes.length || literals.observerIdentity.sha256 !== sha(observerBytes))
    fail('Browser binding generated-config template mismatch');
  for (const role of [
    { captureClass: 'binding-generated', logicalPath: 'packages/web/astro.acceptance.config.mjs', bytes: durable.length, sha256: sha(durable) },
    { captureClass: 'binding-generated', logicalPath: observerSource, bytes: observerBytes.length, sha256: sha(observerBytes) },
  ]) {
    try { validateBindingRoleJoin(role, build, runId); }
    catch (error) { throw new Error('Browser binding generated-config template mismatch', { cause: error }); }
  }
  if (!Array.isArray(binding.records) || binding.records.length > 14 || binding.failures?.length)
    fail('Incomplete browser build observation');
  const sidecarEntries = await fs.readdir(confinedPath(root, suffix), { withFileTypes: true });
  if (sidecarEntries.some((item) => !item.isFile()) ||
      !isDeepStrictEqual(sidecarEntries.map((item) => `${suffix}/${item.name}`).sort(), binding.records.map((item) => item.path).sort()))
    fail('Incomplete browser build observation');
  const records = [], observedPaths = new Set();
  let numberedBytes = 0;
  let terminal, total = 0;
  for (const item of binding.records) {
    if (!item.path.startsWith(`${suffix}/`) || observedPaths.has(item.path)) fail('Browser binding run identity mismatch');
    observedPaths.add(item.path);
    const bytes = await verifyPin(root, item, { nonempty: true });
    if (bytes.length > 256 * 1024 || (total += bytes.length) > 2 * 1024 * 1024) fail('Incomplete browser build observation');
    const name = path.posix.basename(item.path);
    if (name === 'generated-config.mjs.txt') continue;
    const record = JSON.parse(bytes.toString('utf8'));
    if (record.runId !== runId || record.version !== 1) fail('Browser binding run identity mismatch');
    if (name === 'terminal.json') { if (terminal) fail('Incomplete browser build observation'); terminal = record; }
    else if (/^[0-9]{2}-(prerender|client)-(start|end)\.json$/.test(name) || /^[0-9]{2}-build-done\.json$/.test(name)) {
      if (name !== `${String(record.sequence).padStart(2, '0')}-${record.stage}.json`) fail('Incomplete browser build observation');
      numberedBytes += bytes.length;
      records.push(record);
    }
    else fail('Incomplete browser build observation');
  }
  records.sort((a, b) => a.sequence - b.sequence);
  if (!terminal || !terminal.completed || records.length !== 5 || terminal.records !== records.length || terminal.totalBytes !== numberedBytes ||
      records.some((record, index) => record.sequence !== index) ||
      !isDeepStrictEqual(terminal.stages, records.map((record) => record.stage)) ||
      !isDeepStrictEqual(terminal.claimLimits, bindingClaims) ||
      !isDeepStrictEqual([...terminal.stages].sort(), ['build-done', 'client-end', 'client-start', 'prerender-end', 'prerender-start']))
    fail('Incomplete browser build observation');
  const associations = new Map();
  for (const environment of ['prerender', 'client']) {
    const start = records.find((item) => item.stage === `${environment}-start`), end = records.find((item) => item.stage === `${environment}-end`);
    validateObservedBindingPolicy(start.policy); validateObservedBindingPolicy(end.policy);
    if (start.environment !== environment || end.environment !== environment ||
        !isDeepStrictEqual(start.core, end.core) || !isDeepStrictEqual(start.policy, end.policy) ||
        start.policy.consumer !== (environment === 'client' ? 'client' : 'server') || !start.core?.supported)
      fail('Browser binding core environment-map mismatch');
    const ownedCore = convention.resolve(build.cwd, '../core');
    const packageMetadata = JSON.parse(stageA.packageBytes.toString('utf8'));
    if (start.core.packageRoot !== ownedCore || start.core.name !== packageMetadata.name || start.core.version !== packageMetadata.version ||
        start.core.package?.path !== convention.join(ownedCore, 'package.json') ||
        start.core.package.bytes !== stageA.proof.packageManifest.bytes || start.core.package.sha256 !== stageA.proof.packageManifest.sha256)
      fail('Browser binding core environment-map mismatch');
    const selectedPath = convention.relative(convention.join(ownedCore, 'dist'), start.core.entry.path).split(convention.sep).join('/');
    const mapPath = convention.relative(convention.join(ownedCore, 'dist'), start.core.map.path).split(convention.sep).join('/');
    const expectedNamespace = environment === 'client' ? 'browser/' : 'node/';
    if (!selectedPath.startsWith(expectedNamespace) || mapPath !== `${selectedPath}.map` ||
        !stageA.proof.outputs.some((item) => item.path === selectedPath && item.bytes === start.core.entry.bytes && item.sha256 === start.core.entry.sha256) ||
        !stageA.proof.outputs.some((item) => item.path === mapPath && item.bytes === start.core.map.bytes && item.sha256 === start.core.map.sha256))
      fail('Browser binding core environment-map mismatch');
    associations.set(environment, { entry: selectedPath, map: mapPath });
  }
  const done = records.find((item) => item.stage === 'build-done');
  if (!isDeepStrictEqual(done.identities, ['prerender', 'client'].map((environment) => ({ environment,
    core: records.find((item) => item.stage === `${environment}-end`).core }))) ||
      done.observer?.bytes !== observerBytes.length || done.observer.sha256 !== sha(observerBytes) ||
      done.observer.path !== convention.join(build.cwd, 'test/productionBuildBindingObserver.mjs') ||
      done.outputDir !== convention.join(build.cwd, 'dist')) fail('Incomplete browser build observation');
  const commandHelperPins = Array.isArray(producer.commandSourcePins)
    ? producer.commandSourcePins.filter((item) => item.path === helperSourcePath) : [];
  const currentHelperPin = { path: helperSourcePath, bytes: helperSource.length, sha256: sha(helperSource) };
  if (binding.templateBinding.declaration !== 'BINDING_CONFIG_TEMPLATE' ||
      binding.templateBinding.marker !== '__WYREUP_BINDING_OPTIONS_JSON__' || commandHelperPins.length !== 1 ||
      !isDeepStrictEqual(commandHelperPins[0], currentHelperPin) || !isDeepStrictEqual(helperSourcePin, currentHelperPin))
    fail('Browser binding generated-config template mismatch');
  const roles = await derivedBrowserRoles(root, build, engine.id, runId);
  const ts = createRequire(import.meta.url)('typescript');
  const mapContexts = new Map();
  for (const [environment, association] of associations) {
    const queue = [association.entry], visited = new Set(), candidates = [];
    const namespace = association.entry.split('/')[0] + '/';
    while (queue.length) {
      const file = queue.shift();
      if (visited.has(file)) continue;
      if (visited.size >= 10000) fail('Browser binding core source association mismatch');
      visited.add(file);
      const output = stageA.proof.outputs.find((item) => item.path === file);
      if (!output || !file.startsWith(namespace)) fail('Browser binding core environment-map mismatch');
      const code = await fs.readFile(path.join(stageA.outputDirectory, file));
      if (code.length !== output.bytes || sha(code) !== output.sha256) fail('Browser binding core source association mismatch');
      const mapPath = `${file}.map`, mapPin = stageA.proof.outputs.find((item) => item.path === mapPath);
      if (!mapPin) fail('Browser binding core source association mismatch');
      const mapBytes = await fs.readFile(path.join(stageA.outputDirectory, mapPath));
      if (mapBytes.length !== mapPin.bytes || sha(mapBytes) !== mapPin.sha256) fail('Browser binding core source association mismatch');
      candidates.push({ mapPath, map: JSON.parse(mapBytes.toString('utf8')) });
      const ast = ts.createSourceFile(file, code.toString('utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      if (ast.parseDiagnostics.length) fail('Browser binding core source association mismatch');
      for (const node of ast.statements) {
        if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
        if (!ts.isStringLiteralLike(node.moduleSpecifier)) fail('Browser binding core source association mismatch');
        const specifier = node.moduleSpecifier.text;
        if (!specifier.startsWith('.')) continue;
        const imported = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
        if (!imported.startsWith(namespace) || !/\.(js|mjs)$/.test(imported)) fail('Browser binding core environment-map mismatch');
        queue.push(imported);
      }
    }
    // Compiler static context only: no Vite consumption or nested-worker graph claim.
    mapContexts.set(environment, candidates);
  }
  for (const role of roles) {
    if (role.captureClass === 'selected-named-export-edge') {
      for (const pin of [role.edge.sourcePin, role.edge.nextSourcePin]) {
        const input = stageA.proof.sourceInputs.find((item) => item.path === pin.path);
        if (!input || input.bytes !== pin.bytes || input.sha256 !== pin.sha256) fail('Browser binding core source association mismatch');
      }
    }
    if (role.captureClass === 'selected-core-runtime') {
      const input = stageA.proof.sourceInputs.find((item) => item.path === role.logicalPath);
      if (!input || input.bytes !== role.bytes || input.sha256 !== role.sha256) fail('Browser binding core source association mismatch');
      const environmentAssociations = [];
      for (const [environment, association] of associations) {
        const matches = [];
        for (const { mapPath, map } of mapContexts.get(environment)) {
          if (map.version !== 3 || !Array.isArray(map.sources))
            fail('Browser binding core source association mismatch');
          if (map.sources.length === 0 && !Object.hasOwn(map, 'sourcesContent')) continue;
          if (!Array.isArray(map.sourcesContent) || map.sources.length !== map.sourcesContent.length)
            fail('Browser binding core source association mismatch');
          for (const [index, source] of map.sources.entries()) {
          if (typeof source !== 'string' || typeof map.sourcesContent[index] !== 'string') continue;
          const compilerMapPath = path.resolve(stageA.proof.sourcePathMapping.ownedPrefix, 'dist', mapPath);
          const absolute = path.resolve(path.dirname(compilerMapPath), map.sourceRoot ?? '', source);
          const owned = stageA.proof.sourcePathMapping.ownedPrefix;
          const original = stageA.proof.sourcePathMapping.originalPrefix;
          const prefix = absolute.startsWith(owned + path.sep) ? owned : absolute.startsWith(original + path.sep) ? original : null;
          if (!prefix) continue;
          const logical = 'packages/core/' + path.relative(prefix, absolute).split(path.sep).join('/');
          if (logical === role.logicalPath && sha(Buffer.from(map.sourcesContent[index])) === role.sha256 && Buffer.byteLength(map.sourcesContent[index]) === role.bytes) matches.push({ sourceMap: mapPath, sourceIndex: index });
          }
        }
        if (matches.length !== 1) fail('Browser binding core source association mismatch');
        environmentAssociations.push({ environment, ...association, ...matches[0] });
      }
      role.association = environmentAssociations;
    }
    validateBindingRoleJoin(role, build, runId);
  }
  if (!Array.isArray(context.emittedArtifacts) || !Array.isArray(context.emittedWorkerEvidence))
    fail('Browser binding emitted artifact path mismatch');
  const requiredEmitted = new Map();
  function requiredArtifact(rawUrl, document = false) {
    let url, logical;
    try {
      url = new URL(rawUrl);
      if (typeof rawUrl !== 'string' || url.origin !== origin.origin || url.protocol !== origin.protocol)
        fail('Browser binding emitted artifact path mismatch');
      logical = decodeURIComponent(url.pathname).replace(/^\//, '');
    } catch { fail('Browser binding emitted artifact path mismatch'); }
    if (document) logical = logical.endsWith('/') ? logical + 'index.html' : logical + '.html';
    if (!logical || logical.split('/').some((item) => item === '.' || item === '..') || logical.includes('\\'))
      fail('Browser binding emitted artifact path mismatch');
    const previous = requiredEmitted.get(url.href);
    if (previous && previous.logicalPath !== logical) fail('Browser binding emitted artifact path mismatch');
    requiredEmitted.set(url.href, { logicalPath: logical, document: document || previous?.document === true });
  }
  for (const response of context.browserResponses) {
    if (response.status !== 200 || response.fromServiceWorker ||
        !['document', 'script', 'stylesheet', 'font'].includes(response.resourceType)) continue;
    let url;
    try { url = new URL(response.url); } catch { fail('Browser binding emitted artifact path mismatch'); }
    if (url.origin === origin.origin) requiredArtifact(response.url, response.resourceType === 'document');
  }
  for (const url of context.emittedWorkerEvidence) requiredArtifact(url);
  if (![...requiredEmitted.values()].some((item) => item.document && item.logicalPath === `tools/${engine.id}/index.html`))
    fail('Browser binding emitted artifact path mismatch');
  for (const [url, required] of requiredEmitted) {
    const captures = context.emittedArtifacts.filter((item) => item.url === url);
    if (captures.length !== 1 || captures[0].logicalPath !== required.logicalPath)
      fail('Browser binding emitted artifact path mismatch');
  }
  for (const emitted of context.emittedArtifacts) {
    let url;
    try { url = new URL(emitted.url); } catch { fail('Browser binding emitted artifact path mismatch'); }
    const response = context.browserResponses.find((item) => item.url === emitted.url && item.status === 200 &&
      !item.fromServiceWorker && ['document', 'script', 'stylesheet', 'font'].includes(item.resourceType));
    const workerContextOnly = context.emittedWorkerEvidence?.includes(emitted.url);
    if (url.origin !== origin.origin || !response && !workerContextOnly) fail('Browser binding emitted artifact path mismatch');
    let logical = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (response?.resourceType === 'document') logical = logical.endsWith('/') ? logical + 'index.html' : logical + '.html';
    if (logical !== emitted.logicalPath) fail('Browser binding emitted artifact path mismatch');
    await verifyPin(root, emitted, { nonempty: true });
    validateBindingRoleJoin({ captureClass: 'emitted-output', logicalPath: emitted.logicalPath, bytes: emitted.bytes, sha256: emitted.sha256 }, build, runId);
    if (emitted.path !== `docs/catalog-artifacts/${runId}/build-evidence/emitted/${emitted.logicalPath}`)
      fail('Browser binding emitted artifact path mismatch');
  }
  return { mode: BROWSER_BINDING_MODE, runId, derivedRoles: roles, proofPin: stageA.proofPin,
    claimLimits: bindingClaims, fullMidiSourceQualification: 'held', rowPromotion: 'pending' };
}
function validateContinuedEpochMapping(mapping) {
  const refusal = 'Continued epoch exact823 ledger/original mapping differs.';
  const plain = (value) => value !== null && typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype;
  const keys = (value, names) => plain(value) &&
    isDeepStrictEqual(Reflect.ownKeys(value).sort(), [...names].sort()) &&
    names.every((name) => Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'));
  function jsonSafe(value, active = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if ((!plain(value) && !Array.isArray(value)) || active.has(value)) fail(refusal);
    active.add(value);
    const names = Reflect.ownKeys(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || names.length !== value.length + 1 ||
          !names.includes('length')) fail(refusal);
      for (let i = 0; i < value.length; i++) {
        const item = Object.getOwnPropertyDescriptor(value, String(i));
        if (!item || !Object.hasOwn(item, 'value')) fail(refusal);
        jsonSafe(item.value, active);
      }
    } else {
      for (const name of names) {
        const item = Object.getOwnPropertyDescriptor(value, name);
        if (typeof name !== 'string' || !Object.hasOwn(item, 'value')) fail(refusal);
        jsonSafe(item.value, active);
      }
    }
    active.delete(value);
  }
  jsonSafe(mapping);
  if (mapping.releaseIntegrationEpoch?.id !== 'release-integration-176-continued' ||
      !Array.isArray(mapping.pendingSourceRecaptures) || mapping.pendingSourceRecaptures.length !== 5)
    fail(refusal);
  const entry = mapping.pendingSourceRecaptures[4];
  if (!keys(entry, ['originalMapping', 'changes', 'acceptance']) ||
      !keys(entry.originalMapping, ['historicalEvidenceName', 'bytes', 'sha256']) ||
      !isDeepStrictEqual(entry.originalMapping, {
        historicalEvidenceName: 'release-integration-reconciliation-169/source-integration-171/catalog-integration-mapping-current-candidate.json',
        bytes: 6103676, sha256: '135d0aaff69aaf4b8b391565473c9f83fa8c626e2f2802ecf5b2f9f5c58a58fc',
      }) || entry.acceptance !== 'Pending current source identity only; historical authority, owner receipts, observations and statuses unchanged.' ||
      !Array.isArray(entry.changes) || entry.changes.length !== 823 ||
      sha(JSON.stringify(entry.changes)) !== 'd57b94c7326bac555e2aa324ac99c9b90aeb04381c9677fbe2d33fc12765b9c3')
    fail(refusal);
  const fields = new Set();
  const epochFields = new Set(['releaseIntegrationEpoch.id', 'releaseIntegrationEpoch.historicalMapping.sourcePath',
    'releaseIntegrationEpoch.historicalMapping.path', 'releaseIntegrationEpoch.historicalMapping.bytes',
    'releaseIntegrationEpoch.historicalMapping.sha256', 'releaseIntegrationEpoch.updatedFields']);
  function selected(value, field) {
    const parts = field.split('.');
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(value, part)) fail(refusal);
      value = value[part];
    }
    const key = parts.at(-1);
    if (!Object.hasOwn(value, key)) fail(refusal);
    return [value, key];
  }
  for (const row of entry.changes) {
    if (!keys(row, ['rowNumber', 'engineId', 'field', 'prior', 'current', 'disposition']) ||
        typeof row.field !== 'string' || fields.has(row.field) ||
        (!epochFields.has(row.field) && !/^rows\.(0|[1-9]\d*)\.engines\.(0|[1-9]\d*)\.(sourceBinding\.pins\.(0|[1-9]\d*)|requiredSourceClosure\.(0|[1-9]\d*)|sourceGateBindings\.currentIntegratedSourceGate\.currentSource|sourceBinding\.tree)$/.test(row.field)))
      fail(refusal);
    fields.add(row.field);
    const [value, key] = selected(mapping, row.field);
    if (!isDeepStrictEqual(value[key], row.current)) fail(refusal);
  }
  const historical = structuredClone(mapping);
  historical.pendingSourceRecaptures.pop();
  for (const row of [...entry.changes].reverse()) {
    const [value, key] = selected(historical, row.field);
    value[key] = structuredClone(row.prior);
  }
  if (sha(JSON.stringify(historical)) !== 'a6d991ebf5aaa3c0f12bda6cca8874e4663dacc1d8a525ef88cb5837ab019bb0')
    fail(refusal);
}
export async function validateCatalogEvidence({
  root,
  mapping,
  oracles,
  gates,
  registry,
  requireVerified = false,
}) {
  if (mapping?.schemaVersion !== 1 || oracles?.schemaVersion !== 1 || gates?.schemaVersion !== 1)
    fail('Unsupported catalog evidence schema.');
  if (!Array.isArray(mapping.rows) || mapping.rows.length !== 193)
    fail('Exactly193 original rows required.');
  if (
    !Array.isArray(oracles.sourceCaseCatalog) ||
    oracles.sourceCaseCatalog.length !== 902 ||
    !Array.isArray(oracles.declaredFixtureCatalog) ||
    oracles.declaredFixtureCatalog.length !== 81
  )
    fail('Immutable902 cases/81 tuples required.');
  if (oracles.supplementalFixtureAuthorities !== undefined) {
    const candidates = await validateSupplementalCatalog(root, oracles);
    assert.deepEqual(
      oracles.executableFixtures.filter(
        (fixture) => fixture.qualificationKind === 'supplemental source-bound fixture',
      ),
      candidates,
      'Supplemental executable records must match the ten exact additive authorities.',
    );
  }
  await validateGroupA31Catalog(root, oracles);
  await validateGroupBCCatalog(root, oracles);
  if (!registry) {
    const core = await import(
      pathToFileURL(path.join(root, 'packages/core/dist/node/index.js')).href
    );
    registry = core.createDefaultRegistry();
  }
  const canonical = registry.toolsById;
  const historical = JSON.parse(await readOwned(root, 'docs/CATALOG-COVERAGE.json'));
  if (!Array.isArray(historical.tools) || historical.tools.length !== 193)
    fail('Original193 historical classification authority missing.');
  const gateIds = new Set(gates.historicalScopedRecords.map((item) => item.id ?? item.gateId));
  gateIds.add('integration-final-SOURCE');
  const numbers = new Set(),
    slugs = new Set(),
    pinCache = new Map();
  let verifiedRows = 0,
    engineReferences = 0;
  for (const row of mapping.rows) {
    if (
      !Number.isSafeInteger(row.rowNumber) ||
      row.rowNumber < 1 ||
      row.rowNumber > 193 ||
      numbers.has(row.rowNumber) ||
      slugs.has(row.slug)
    )
      fail('Duplicate/invalid original row identity.');
    numbers.add(row.rowNumber);
    slugs.add(row.slug);
    const original = historical.tools[row.rowNumber - 1];
    if (
      original.sourceSlug !== row.slug ||
      original.sourceCategory !== row.category ||
      original.classification !== row.classification
    )
      fail('Original row classification/identity differs from protected history.');
    if (!['existing-equivalent', 'extension', 'new-task'].includes(row.classification))
      fail('Invalid original classification.');
    if (!['pending', 'verified'].includes(row.status)) fail('Invalid row status.');
    assert.deepEqual(
      row.engineIds,
      row.engines.map((item) => item.id),
      'Canonical engine IDs disagree.',
    );
    if (
      !Array.isArray(row.wyreupIds) ||
      new Set(row.wyreupIds).size !== row.wyreupIds.length ||
      row.wyreupIds.some((id) => !canonical.has(id) || !row.engineIds.includes(id))
    )
      fail('Canonical public IDs must name actual reached engines.');
    if (row.engines.length && !row.wyreupIds.length)
      fail('Populated row requires its canonical public ID.');
    if (
      !row.engines.length &&
      (row.rowNumber !== 111 || !row.unresolved || row.status !== 'pending')
    )
      fail('Only unresolved DWG may omit a real engine.');
    const ownIds = new Set();
    for (const engine of row.engines) {
      engineReferences++;
      if (!canonical.has(engine.id) || ownIds.has(engine.id))
        fail(`Unknown/duplicate canonical engine ${engine.id}`);
      ownIds.add(engine.id);
      const tool = canonical.get(engine.id);
      assert.deepEqual(
        [...engine.surfaces].sort(),
        [...(tool.surfaces ?? ['web', 'cli', 'mcp'])].sort(),
        'Actual module surface mismatch.',
      );
      if (!['pending', 'verified'].includes(engine.status)) fail('Invalid engine status.');
      const selection = engine.oracle.selectedSourceCaseIndexes;
      if (
        !Array.isArray(selection) ||
        new Set(selection).size !== selection.length ||
        selection.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= 902)
      )
        fail('Invalid current oracle selection.');
      assert.deepEqual(
        engine.oracle.qualification.currentSourceCaseIndexes,
        selection,
        'Oracle qualification must mirror selected cases.',
      );
      if (selection.includes(367) && engine.id !== 'markdown-to-html')
        fail('Markdown-only367 selection has unrelated engine provenance.');
      if (
        (row.rowNumber === 165 || row.rowNumber === 166) &&
        selection.some((index) => index === 45 || index === 46)
      )
        fail('Seating-only timer selection is invalid.');
      if (!engine.oracle.qualification.specification && !row.unresolved)
        fail('Named independent oracle specification required.');
      const expectedGates = [
        ...new Set([
          ...(engine.sourceGateBindings.ownerBindings ?? []).map((item) => item.gateId),
          'integration-final-SOURCE',
        ]),
      ];
      assert.deepEqual(
        [...engine.requiredGateIds].sort(),
        expectedGates.sort(),
        'Actual source gate resolver mismatch.',
      );
      if (engine.requiredGateIds.some((id) => !gateIds.has(id)))
        fail('Unknown actual source gate receipt.');
      if (
        !engine.sourceBinding ||
        !/^[a-f0-9]{40}$/.test(engine.sourceBinding.baseSha) ||
        !engine.sourceBinding.pins?.length
      )
        fail('Current nonself source binding required.');
      const paths = new Set();
      for (const item of engine.sourceBinding.pins) {
        if (
          paths.has(item.path) ||
          item.path.startsWith('docs/CATALOG-INTEGRATION-') ||
          item.path.startsWith('docs/catalog-artifacts/')
        )
          fail('Duplicate/self-referencing source binding.');
        paths.add(item.path);
        const key = JSON.stringify(item);
        if (!pinCache.has(key)) pinCache.set(key, verifyPin(root, item));
        await pinCache.get(key);
      }
      if (engine.status === 'verified')
        await validateVerifiedEngine(root, engine, gates, oracles, tool);
    }
    if (row.status === 'verified') {
      if (!row.engines.length || row.engines.some((engine) => engine.status !== 'verified'))
        fail('Row cannot verify incomplete engines.');
      verifiedRows++;
    }
  }
  if (engineReferences !== 196) fail('Original196 engine references must remain.');
  validateContinuedEpochMapping(mapping);
  if (requireVerified && verifiedRows !== 193)
    fail(`${193 - verifiedRows} pending/unresolved rows; catalog release evidence incomplete.`);
  return {
    rows: 193,
    engineReferences,
    verifiedRows,
    pendingRows: 193 - verifiedRows,
    scope: requireVerified
      ? 'full verified release evidence'
      : 'structure/current pins only; pending is not acceptance',
  };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const root = path.resolve(new URL('../', import.meta.url).pathname);
  try {
    if (process.argv.includes('--check-artifact-run')) {
      const at = process.argv.indexOf('--check-artifact-run'),
        ownerAt = process.argv.indexOf('--checker-owner');
      if (process.argv.length !== 6 || at !== 2 || ownerAt !== 4)
        fail('Use exact --check-artifact-run DIR --checker-owner OWNER.');
      console.log(
        JSON.stringify(
          await checkArtifactRun({
            root,
            directory: process.argv[at + 1],
            owner: process.argv[ownerAt + 1],
          }),
        ),
      );
    } else {
      const documents = await loadCatalogDocuments(root);
      console.log(
        JSON.stringify(
          await validateCatalogEvidence({
            root,
            ...documents,
            requireVerified: process.argv.includes('--require-verified'),
          }),
        ),
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
