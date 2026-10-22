import { afterAll, beforeAll, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { buildProductionCatalogFixture, serveBuiltCatalog } from './productionBrowserHarness';

let server: Awaited<ReturnType<typeof serveBuiltCatalog>> | undefined;
let browser: Browser | undefined;
let ownedFixture: Awaited<ReturnType<typeof buildProductionCatalogFixture>> | undefined;
let resolvedBuild:
  | {
      mode: 'coordinated-dist' | 'owned-production-build';
      distDir: string;
      manifest: string;
    }
  | undefined;
let buildProvenance:
  | {
      kind: unknown;
      aliases: unknown;
      knownAdditionalAcceptanceRoute: string | null;
    }
  | undefined;
let setupFailure: string | undefined;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const run = process.env.CATALOG_BROWSER_RUN ?? `browser-${randomUUID()}`;
if (!/^[a-zA-Z0-9-]{1,100}$/.test(run)) throw new Error('Invalid owned browser artifact run.');
const output = join(root, 'docs/catalog-artifacts', run);
const completedCases = new Set<string>();
const producedArtifacts: {
  engineId: string;
  artifact: { path: string; bytes: number; sha256: string };
}[] = [];
let startedAt: string;
let buildManifestPin: { path: string; bytes: number; sha256: string };
let sourceContext: unknown;
const observedMidi: { sampleRate?: number; workers?: string[] } = {};
const bindingFailures: { name: string; message: string }[] = [];
const browserResponses: { url: string; resourceType: string; fromServiceWorker: boolean; status: number }[] = [];
const controllerSnapshots: { url: string; controlled: boolean; scriptURL: string | null }[] = [];
const emittedWorkerEvidence: string[] = [];
const capturedEmittedArtifacts = new Map<string, { url: string; logicalPath: string; path: string; bytes: number; sha256: string }>();
const captureWork: Promise<void>[] = [];
const captureErrors = new WeakSet<object>();

function captureFailure(error: unknown) {
  if (error && typeof error === 'object') {
    if (captureErrors.has(error)) return;
    captureErrors.add(error);
  }
  bindingFailures.push(error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) });
}

async function captureEmitted(url: string, resourceType: string, fromServiceWorker: boolean | null, status: number | null) {
  if (!server || !resolvedBuild) throw new Error('Incomplete browser build observation');
  if (new URL(url).origin !== new URL(server.url).origin) return;
  if (!['document', 'script', 'stylesheet', 'font', 'worker'].includes(resourceType)) return;
  if (fromServiceWorker) throw new Error('Browser binding selected asset served by service worker');
  if (status !== null && status !== 200) throw new Error('Browser binding emitted artifact unavailable');
  const parsed = new URL(url);
  let logical = decodeURIComponent(parsed.pathname).replace(/^\//, '');
  if (logical.split('/').some((part) => part === '.' || part === '..') || logical.includes('\\'))
    throw new Error('Browser binding emitted artifact path mismatch');
  if (resourceType === 'document') logical = logical.endsWith('/') ? `${logical}index.html` : `${logical}.html`;
  const existing = capturedEmittedArtifacts.get(logical);
  if (existing) return;
  const manifest = JSON.parse(await readFile(resolvedBuild.manifest, 'utf8')) as { artifacts: { path: string; bytes: number; sha256: string }[] };
  const expected = manifest.artifacts.filter((item) => item.path === logical);
  if (expected.length !== 1) throw new Error('Browser binding unmapped source role');
  const bytes = await readFile(join(resolvedBuild.distDir, logical));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== expected[0].bytes || hash !== expected[0].sha256)
    throw new Error('Browser binding emitted artifact path mismatch');
  const destination = `docs/catalog-artifacts/${run}/build-evidence/emitted/${logical}`;
  await mkdir(join(root, destination, '..'), { recursive: true });
  try { await writeFile(join(root, destination), bytes, { flag: 'wx' }); }
  catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
    if (!(await readFile(join(root, destination))).equals(bytes)) throw new Error('Browser binding emitted artifact path mismatch');
  }
  capturedEmittedArtifacts.set(logical, { url, logicalPath: logical, path: destination, bytes: bytes.length, sha256: hash });
}

async function sourcePin(relative: string) {
  const bytes = await readFile(join(root, relative));
  return {
    path: relative,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

beforeAll(async () => {
  const started = Date.now();
  await mkdir(output, { recursive: true });
  startedAt = new Date().toISOString();
  try {
    const explicitDist = process.env.WYREUP_CATALOG_DIST;
    if (process.env.WYREUP_CATALOG_MANIFEST && !explicitDist)
      throw new Error('WYREUP_CATALOG_MANIFEST requires WYREUP_CATALOG_DIST.');
    if (explicitDist) {
      const distDir = resolve(explicitDist);
      resolvedBuild = {
        mode: 'coordinated-dist',
        distDir,
        manifest:
          process.env.WYREUP_CATALOG_MANIFEST ?? `${resolve(distDir, '../../..')}-manifest.json`,
      };
    } else {
      const evidenceDir = join(output, 'build-evidence');
      await mkdir(evidenceDir, { recursive: true });
      ownedFixture = await buildProductionCatalogFixture({
        webDir: fileURLToPath(new URL('..', import.meta.url)),
        evidenceDir,
        deadlineAt: started + 230000,
      });
      resolvedBuild = {
        mode: 'owned-production-build',
        distDir: ownedFixture.distDir,
        manifest: ownedFixture.manifest,
      };
    }
    const { distDir, manifest } = resolvedBuild;
    const buildBytes = await readFile(manifest);
    await writeFile(join(output, 'production-build-manifest.json'), buildBytes, { flag: 'wx' });
    buildManifestPin = await sourcePin(
      `docs/catalog-artifacts/${run}/production-build-manifest.json`,
    );
    const manifestData: unknown = JSON.parse(buildBytes.toString('utf8'));
    if (typeof manifestData !== 'object' || manifestData === null || Array.isArray(manifestData))
      throw new Error('Production build manifest must be a JSON object.');
    const kind: unknown = 'kind' in manifestData ? manifestData.kind : null;
    buildProvenance = {
      kind,
      aliases: 'aliases' in manifestData ? manifestData.aliases : null,
      knownAdditionalAcceptanceRoute:
        kind === 'temporary-real-Astro-controlled-route' ? '/acceptance/catalog/' : null,
    };
    const mapping = JSON.parse(
      await readFile(join(root, 'docs/CATALOG-INTEGRATION-MAPPING.json'), 'utf8'),
    ) as {
      rows: { engines: { id: string; sourceBinding: unknown }[] }[];
    };
    sourceContext = mapping.rows
      .flatMap((row) => row.engines)
      .filter((engine) =>
        [
          'stopwatch',
          'countdown-timer',
          'wedding-seating-chart-builder',
          'gamepad-tester',
          'touchscreen-dead-zone-tester',
          'mp3-to-midi',
        ].includes(engine.id),
      )
      .map((engine) => ({
        engineId: engine.id,
        declaredPendingSourceBinding: engine.sourceBinding,
      }));
    server = await serveBuiltCatalog({
      distDir,
      headersFile: join(distDir, '_headers'),
      deadlineAt: Date.now() + 600000,
    });
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    setupFailure = error instanceof Error ? error.message : String(error);
    throw error;
  }
}, 240000);
afterAll(async () => {
  async function settleCaptures() {
    let index = 0;
    while (index < captureWork.length) {
      const pending = captureWork.slice(index);
      index = captureWork.length;
      await Promise.all(pending);
    }
  }
  await settleCaptures();
  const results = await Promise.allSettled([browser?.close(), server?.close()]);
  const failures: unknown[] = [];
  for (const result of results)
    if (result.status === 'rejected') failures.push(result.reason as unknown);
  await settleCaptures();
  const buildCleanup = await Promise.allSettled([ownedFixture?.close()]);
  for (const result of buildCleanup)
    if (result.status === 'rejected') failures.push(result.reason as unknown);
  try {
    if (output && startedAt)
      await writeFile(
        join(output, 'browser-producer-manifest.json'),
        JSON.stringify(
          {
            run,
            startedAt,
            finishedAt: new Date().toISOString(),
            completedCases: [...completedCases],
            command: [
              'pnpm',
              'exec',
              'vitest',
              'run',
              '--config',
              'vitest.production.config.ts',
              'packages/web/test/catalog-baseline-browser.test.ts',
            ],
            environment: {
              WYREUP_CATALOG_DIST: process.env.WYREUP_CATALOG_DIST,
              WYREUP_CATALOG_MANIFEST: process.env.WYREUP_CATALOG_MANIFEST,
            },
            resolvedProductionBuild: resolvedBuild,
            buildProvenance,
            setupFailure,
            cleanupFailures: failures.map((failure) =>
              failure instanceof Error
                ? { name: failure.name, message: failure.message }
                : { message: String(failure) },
            ),
            buildManifestPin,
            commandSourcePins: [
              await sourcePin('packages/web/test/catalog-baseline-browser.test.ts'),
              await sourcePin('packages/web/test/productionBrowserHarness.ts'),
              await sourcePin('packages/web/test/productionBuildBindingObserver.mjs'),
            ],
            sourceContext,
            artifacts: producedArtifacts,
            observedMidi,
            browserProductionArtifactContextBinding: {
              version: 1, runId: run, origin: server?.url, browserResponses, controllerSnapshots,
              emittedArtifacts: [...capturedEmittedArtifacts.values()], emittedWorkerEvidence, bindingFailures,
              claimLimits: { consumedModuleGraphObserved: false, moduleLevelViteMapping: false,
                midiWorkerBuildGraphObserved: false, workerDistToEmittedAssociation: false,
                fixedWorkflowOnly: true, servedResponseBodyEquality: false },
            },
            scope:
              'Actual owned production-browser producer; resolved kind records any extra acceptance route. This is not a byte-identical deployed-output claim. Native exit/log must be paired externally; current-source/build parity, independent checker, all modes/mobile and physical acceptance remain pending.',
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx' },
      );
  } catch (error) {
    failures.push(error);
  }
  if (bindingFailures.length)
    failures.push(new Error('Browser production artifact context binding failed.'));
  if (failures.length)
    throw new AggregateError(
      failures,
      'Owned production baseline binding, cleanup or manifest persistence failed.',
    );
});
async function pageFor(id: string, before?: (page: Page) => Promise<void>) {
  const context = await browser!.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  if (before) await before(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const item = { url: response.url(), resourceType: response.request().resourceType(),
      fromServiceWorker: response.fromServiceWorker(), status: response.status() };
    browserResponses.push(item);
    captureWork.push(captureEmitted(item.url, item.resourceType, item.fromServiceWorker, item.status).catch(captureFailure));
  });
  page.on('worker', (worker) => {
    emittedWorkerEvidence.push(worker.url());
    // A worker event supplies a URL, not response status or a SW-body association.
    captureWork.push(captureEmitted(worker.url(), 'worker', null, null).catch(captureFailure));
  });
  expect((await page.goto(`${server!.url}/tools/${id}/`))?.status()).toBe(200);
  await expect.poll(() => page.locator('astro-island[ssr]').count()).toBe(0);
  expect(await page.getByText(/runner (is )?unavailable|not mapped/i).count()).toBe(0);
  const controller = await page.evaluate(() => ({ url: window.location.href,
    controlled: navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined,
    scriptURL: navigator.serviceWorker?.controller?.scriptURL ?? null }));
  controllerSnapshots.push(controller);
  if (controller.controlled) throw new Error('Browser binding selected asset served by service worker');
  return { page, context, errors };
}
async function saved(page: Page, button: string, filename: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const download = await pending;
  const destination = join(output, filename);
  await download.saveAs(destination);
  const bytes = await readFile(destination);
  expect(bytes.length).toBeGreaterThan(0);
  const artifact = {
    path: `docs/catalog-artifacts/${run}/${filename}`,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  producedArtifacts.push({ engineId: new URL(page.url()).pathname.split('/')[2], artifact });
  await writeFile(
    `${destination}.receipt.json`,
    JSON.stringify(
      {
        artifact: {
          path: `docs/catalog-artifacts/${run}/${filename}`,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
        producer: 'actual production default registry/ToolRunner/emitted components',
        url: page.url(),
        limitation:
          'This fixed case is not all branch/package/source or physical-device acceptance.',
      },
      null,
      2,
    ),
  );
  return bytes;
}
const fixture = (name: string) => join(root, 'packages/core/test/fixtures', name);

it('real stopwatch restore/export preserves the complete independent fixed lap session', async () => {
  const { page, context, errors } = await pageFor('stopwatch');
  try {
    const original = await readFile(fixture('planning-stopwatch-session.json'));
    await page
      .getByLabel('Restore session JSON')
      .setInputFiles({ name: 'original.json', mimeType: 'application/json', buffer: original });
    await page.getByText('State: paused', { exact: true }).waitFor();
    expect(
      JSON.parse((await saved(page, 'Save session JSON', 'stopwatch.json')).toString()),
    ).toEqual({
      version: 1,
      kind: 'stopwatch',
      state: 'paused',
      elapsedMs: 1200,
      laps: [
        { totalMs: 500, deltaMs: 500 },
        { totalMs: 1100, deltaMs: 600 },
      ],
    });
    expect(errors).toEqual([]);
    completedCases.add('stopwatch');
  } finally {
    await context.close();
  }
}, 30000);
it('real countdown restores running snapshots paused and reopens a complete done artifact', async () => {
  const { page, context, errors } = await pageFor('countdown-timer');
  try {
    await page
      .getByLabel('Restore session JSON')
      .setInputFiles(fixture('planning-countdown-session.json'));
    await page.getByText('State: paused', { exact: true }).waitFor();
    expect(
      JSON.parse((await saved(page, 'Save session JSON', 'countdown-paused.json')).toString()),
    ).toEqual({
      version: 1,
      kind: 'countdown',
      state: 'paused',
      durationMs: 300000,
      elapsedMs: 12000,
    });
    const done = {
      version: 1,
      kind: 'countdown',
      state: 'done',
      durationMs: 1000,
      elapsedMs: 1000,
    };
    await page.getByLabel('Restore session JSON').setInputFiles({
      name: 'done.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(done)),
    });
    await page.getByText('State: done', { exact: true }).waitFor();
    expect(
      JSON.parse((await saved(page, 'Save session JSON', 'countdown-done.json')).toString()),
    ).toEqual(done);
    expect(await page.getByText('Countdown complete.', { exact: true }).count()).toBe(0);
    expect(errors).toEqual([]);
    completedCases.add('countdown-timer');
  } finally {
    await context.close();
  }
}, 30000);
it('real seating editor reopens the full fixed plan with duplicate names and exact ID references', async () => {
  const { page, context, errors } = await pageFor('wedding-seating-chart-builder');
  try {
    await page.getByLabel('Import plan JSON').setInputFiles(fixture('planning-seating-plan.json'));
    await expect.poll(() => page.getByLabel(/^Assign Alex/).count()).toBe(2);
    expect(JSON.parse((await saved(page, 'Save plan JSON', 'seating.json')).toString())).toEqual({
      version: 1,
      kind: 'seating',
      guests: [
        { id: 'guest1', name: 'Alex' },
        { id: 'guest2', name: 'Alex' },
      ],
      tables: [{ id: 'table1', name: 'Friends', capacity: 2 }],
      assignments: [{ guestId: 'guest1', tableId: 'table1' }],
    });
    expect((await saved(page, 'Export seating CSV', 'seating.csv')).toString()).toContain(
      'Friends',
    );
    expect(errors).toEqual([]);
    completedCases.add('wedding-seating-chart-builder');
  } finally {
    await context.close();
  }
}, 30000);
it('real gamepad module exports controlled exposed raw API data without claiming physical hardware', async () => {
  const { page, context, errors } = await pageFor('gamepad-tester', async (page) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () => [
          null,
          {
            index: 7,
            id: '<img src=x>',
            mapping: 'standard',
            connected: true,
            timestamp: 42,
            axes: [1.2, -0.05],
            buttons: [{ value: 1.1, pressed: true, touched: true }],
          },
        ],
      });
    });
  });
  try {
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByText('API slot 1; index 7: <img src=x>', { exact: true }).waitFor();
    const report = JSON.parse((await saved(page, 'Export JSON', 'gamepad.json')).toString()) as {
      devices: unknown[];
    };
    expect(report.devices).toHaveLength(1);
    expect(report.devices[0]).toMatchObject({
      slot: 1,
      index: 7,
      descriptor: '<img src=x>',
      mapping: 'standard',
      connected: true,
      timestamp: 42,
      axes: [1.2, -0.05],
      buttons: [{ value: 1.1, pressed: true, touched: true }],
      outOfNominal: { axes: [0], buttons: [0] },
    });
    expect(errors).toEqual([]);
    completedCases.add('gamepad-tester');
  } finally {
    await context.close();
  }
}, 30000);
it('real touchscreen session exports captured geometry and preserves the sealed report after scroll', async () => {
  const { page, context, errors } = await pageFor('touchscreen-dead-zone-tester');
  try {
    await page.getByLabel('Columns', { exact: true }).fill('2');
    await page.getByLabel('Rows', { exact: true }).fill('2');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByLabel('Pointer measurement canvas').evaluate((canvas) => {
      const rect = canvas.getBoundingClientRect();
      for (const [clientX, clientY, pointerType] of [
        [rect.left, rect.top, 'mouse'],
        [rect.right, rect.bottom, 'pen'],
      ] as const)
        canvas.dispatchEvent(
          new PointerEvent('pointermove', {
            clientX,
            clientY,
            pointerType,
            pressure: 0.5,
            bubbles: true,
          }),
        );
    });
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const before = await saved(page, 'Export JSON', 'touchscreen-before.json');
    expect(JSON.parse(before.toString())).toMatchObject({
      status: 'measured',
      sampleCount: 2,
      excludedSampleCount: 0,
      coveragePercent: 50,
      cellCoverage: [1, 0, 0, 1],
      pointerTypeCounts: { mouse: 1, pen: 1 },
    });
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    expect(await saved(page, 'Export JSON', 'touchscreen-after.json')).toEqual(before);
    expect(errors).toEqual([]);
    completedCases.add('touchscreen-dead-zone-tester');
  } finally {
    await context.close();
  }
}, 30000);
function midiNotes(bytes: Buffer) {
  expect(bytes.subarray(0, 4).toString()).toBe('MThd');
  expect(bytes.readUInt32BE(4)).toBe(6);
  expect([bytes.readUInt16BE(8), bytes.readUInt16BE(10), bytes.readUInt16BE(12)]).toEqual([
    0, 1, 480,
  ]);
  expect(bytes.subarray(14, 18).toString()).toBe('MTrk');
  expect(bytes.readUInt32BE(18)).toBe(bytes.length - 22);
  let offset = 22,
    ended = false,
    tempo = 0,
    tick = 0,
    tempoCount = 0,
    signatureCount = 0;
  const notes: [boolean, number][] = [];
  const ticks: number[] = [];
  while (offset < bytes.length) {
    let count = 0,
      byte,
      delta = 0;
    do {
      byte = bytes[offset++];
      delta = delta * 128 + (byte & 127);
      expect(++count).toBeLessThanOrEqual(4);
    } while (byte & 128);
    tick += delta;
    const status = bytes[offset++];
    if (status === 255) {
      const type = bytes[offset++],
        length = bytes[offset++];
      if (type === 81) {
        expect(length).toBe(3);
        tempo = bytes.readUIntBE(offset, 3);
        tempoCount++;
      } else if (type === 88) {
        expect(length).toBe(4);
        expect([...bytes.subarray(offset, offset + length)]).toEqual([4, 2, 24, 8]);
        signatureCount++;
      } else {
        expect(type).toBe(47);
        expect(length).toBe(0);
        ended = true;
      }
      offset += length;
    } else {
      expect([128, 144]).toContain(status);
      notes.push([status === 144, bytes[offset]]);
      ticks.push(tick);
      const velocity = bytes[offset + 1];
      expect(velocity).toBeLessThanOrEqual(127);
      if (status === 144) expect(velocity).toBeGreaterThan(0);
      else expect(velocity).toBe(0);
      offset += 2;
    }
    expect(offset).toBeLessThanOrEqual(bytes.length);
    if (ended) expect(offset).toBe(bytes.length);
  }
  expect(ended).toBe(true);
  expect(tempo).toBe(500000);
  expect(tempoCount).toBe(1);
  expect(signatureCount).toBe(1);
  return { notes, ticks };
}
it('real48kHz MP3 decode and emitted analysis worker produce the full independent melody/MIDI', async () => {
  const workers: string[] = [];
  const { page, context, errors } = await pageFor('mp3-to-midi', async (page) => {
    page.on('worker', (worker) => workers.push(worker.url()));
    await page.addInitScript(() => {
      const Native = window.AudioContext;
      class Observed extends Native {
        constructor(options?: AudioContextOptions) {
          super(options);
          Object.assign(window, { actualMidiSampleRate: this.sampleRate });
        }
      }
      window.AudioContext = Observed;
    });
  });
  try {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Drop file or click to browse', exact: true }).click();
    await (await chooser).setFiles(fixture('catalog-files/melody-220-440.mp3'));
    await page.getByRole('button', { name: 'Analyze melody', exact: true }).click();
    await page.getByRole('region', { name: 'Detected melody', exact: true }).waitFor();
    const report = JSON.parse(
      (await saved(page, 'Download pitch report', 'melody.json')).toString(),
    ) as { notes: { id: string; note: number; frequency: number; start: number; end: number }[] };
    expect(report.notes.map((note) => [note.id, note.note])).toEqual([
      ['n0', 57],
      ['n1', 69],
    ]);
    for (const [index, hz] of [220, 440].entries()) {
      expect(Math.abs(report.notes[index].frequency / hz - 1)).toBeLessThan(0.01);
      expect(Math.abs(report.notes[index].start - index)).toBeLessThanOrEqual(0.15);
      expect(Math.abs(report.notes[index].end - index - 1)).toBeLessThanOrEqual(0.15);
    }
    expect(
      await page.evaluate(
        () => (window as unknown as { actualMidiSampleRate: number }).actualMidiSampleRate,
      ),
    ).toBe(48000);
    expect(workers.some((url) => new URL(url).pathname.includes('file-worker'))).toBe(true);
    observedMidi.sampleRate = await page.evaluate(
      () => (window as unknown as { actualMidiSampleRate: number }).actualMidiSampleRate,
    );
    observedMidi.workers = workers;
    const midi = midiNotes(await saved(page, 'Download MIDI', 'melody.mid'));
    expect(midi.notes).toEqual([
      [true, 57],
      [false, 57],
      [true, 69],
      [false, 69],
    ]);
    for (const [index, independentSeconds] of [0, 1, 1, 2].entries())
      expect(Math.abs(midi.ticks[index] - independentSeconds * 960)).toBeLessThanOrEqual(144);
    expect(errors).toEqual([]);
    completedCases.add('mp3-to-midi');
  } finally {
    await context.close();
  }
}, 60000);
