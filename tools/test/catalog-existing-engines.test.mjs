import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import {
  checkFixtureArtifacts,
  confinedPath,
  independentArtifactExpectation,
  verifyPin,
} from '../check-catalog-evidence.mjs';

const root = path.resolve(new URL('../../', import.meta.url).pathname);
const exec = promisify(execFile);
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const oracles = JSON.parse(
  await fs.readFile(path.join(root, 'docs/CATALOG-INTEGRATION-ORACLES.json')),
);
const runId =
  process.env.CATALOG_ARTIFACT_RUN ??
  `native-${new Date().toISOString().replace(/[^0-9]/g, '')}-${crypto.randomUUID()}`;
if (!/^[a-zA-Z0-9-]{1,100}$/.test(runId))
  throw new Error('Invalid owned catalog artifact run identifier.');
const selected = process.env.CATALOG_FIXTURE_KEYS?.split(',');
if (
  selected &&
  selected.some((key) => !oracles.executableFixtures.some((fixture) => fixture.key === key))
)
  throw new Error('Unknown named independent fixture selection.');
if (
  selected?.some(
    (key) => oracles.executableFixtures.find((fixture) => fixture.key === key).surface === 'web',
  )
)
  throw new Error(
    'Web-only fixtures require the genuine browser producer; Node simulation is forbidden.',
  );
const fixtures = selected
  ? oracles.executableFixtures.filter((fixture) => selected.includes(fixture.key))
  : oracles.executableFixtures.filter((fixture) => fixture.surface !== 'web');
assert(fixtures.length > 0, 'Zero-case baseline is not evidence.');
async function pin(relative) {
  const bytes = await fs.readFile(confinedPath(root, relative));
  return { path: relative, bytes: bytes.length, sha256: sha(bytes) };
}
for (const fixture of fixtures)
  for (const format of ['esm', 'cjs']) {
    test(
      `actual public ${format} ${fixture.engineId} fixed independent ${fixture.key}`,
      { timeout: 65000 },
      async () => {
        const outputDirectory = `docs/catalog-artifacts/${runId}/${fixture.key}-${format}`;
        const command = [
          process.execPath,
          'tools/catalog-baseline-producers.mjs',
          '--fixture',
          fixture.key,
          '--format',
          format,
          '--out',
          outputDirectory,
        ];
        const startedAt = new Date().toISOString();
        let result;
        try {
          result = await exec(command[0], command.slice(1), {
            cwd: root,
            timeout: 60000,
            maxBuffer: 1024 * 1024,
          });
        } catch (error) {
          await fs.mkdir(confinedPath(root, outputDirectory), { recursive: true });
          await fs.writeFile(
            confinedPath(root, `${outputDirectory}/failed-native.log`),
            `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${String(error)}\n`,
          );
          throw error;
        }
        const logPath = `${outputDirectory}/producer.log`;
        await fs.writeFile(confinedPath(root, logPath), result.stdout + '\n' + result.stderr);
        const { manifestPath, manifest } = JSON.parse(result.stdout.trim());
        assert.equal(manifest.engineId, fixture.engineId);
        assert.equal(manifest.oracleKey, fixture.key);
        assert.equal(manifest.format, format);
        assert.deepEqual(manifest.params, fixture.params);
        assert.deepEqual(manifest.inputs, fixture.inputs);
        assert.equal(
          manifest.artifacts.length,
          fixture.artifactOracles.length,
          'All actual outputs need complete independent oracles.',
        );
        for (const item of fixture.authorityPins) await verifyPin(root, item);
        await checkFixtureArtifacts(root, manifest.artifacts, fixture);
        const receipt = {
          role: 'producer',
          engineId: fixture.engineId,
          caseKey: manifest.caseKey,
          owner: process.env.CATALOG_PRODUCER_OWNER ?? 'catalog_gap_inventory',
          command,
          cwd: '.',
          exitCode: 0,
          caseCount: 1,
          startedAt,
          finishedAt: new Date().toISOString(),
          sourceBindingDigest: manifest.sourceBindingDigest,
          log: await pin(logPath),
          commandSourcePins: [await pin('tools/catalog-baseline-producers.mjs')],
          manifest: await pin(manifestPath),
          artifactPins: manifest.artifacts,
          independentExpectation: independentArtifactExpectation(fixture, manifest.artifacts),
          status:
            'Actual native producer exit0 and independent literal checks; pending additional branches/packed/browser/current integrated SOURCE; no row promotion.',
        };
        await fs.writeFile(
          confinedPath(root, `${outputDirectory}/producer-receipt.json`),
          JSON.stringify(receipt, null, 2) + '\n',
        );
        console.log(
          JSON.stringify({
            caseKey: manifest.caseKey,
            artifacts: manifest.artifacts,
            receipt: `${outputDirectory}/producer-receipt.json`,
            rowVerification: 'pending',
          }),
        );
      },
    );
  }
