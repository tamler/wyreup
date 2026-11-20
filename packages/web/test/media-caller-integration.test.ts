import { afterAll, beforeAll, expect, it } from 'vitest';
import { openMediaCallerHarness } from './mediaCallerHarness';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
let harness: Awaited<ReturnType<typeof openMediaCallerHarness>>;
beforeAll(async () => {
  harness = await openMediaCallerHarness();
}, 30000);
afterAll(async () => {
  await harness?.close();
});

it('stale free batch restores its retained review only after owned work settles', async () => {
    const page = await harness.browser.newPage();
    const directory = await mkdtemp(join(tmpdir(), 'wyreup-stale-batch-'));
    await writeFile(join(directory, 'a.mp4'), 'retained stale original a');
    await writeFile(join(directory, 'b.mp4'), 'retained stale original b');
    const initialCalls = ['compress-video'];
    try {
      await page.goto(harness.url + '?scenario=batch');
      const batch = page.getByRole('region', { name: 'Batch caller' });
      const other = page.getByRole('region', { name: 'Other caller' });
      await batch.getByText('Or run on every file in a folder', { exact: true }).click();
      const choosing = page.waitForEvent('filechooser');
      await batch.getByRole('button', { name: 'Pick folder…', exact: true }).click();
      await (await choosing).setFiles(directory);
      await batch.getByRole('button', { name: 'Run on 2 files', exact: true }).click();
      await page.waitForFunction((count) => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === count, initialCalls.length);
      await page.getByRole('button', { name: 'Replace batch steps', exact: true }).click();
      expect(await batch.getByRole('button', { name: /Download ZIP/ }).count()).toBe(0);
      await other.getByRole('button', { name: 'Run convert-video', exact: true }).click();
      await other.getByRole('alert').waitFor();
      expect(await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls)).toEqual(initialCalls);
      await page.evaluate(() => (window as unknown as { settleMedia(): void }).settleMedia());
      // A real second caller acquiring work proves the obsolete promise's
      // complete chain/finally settled; the prop change alone did not release it.
      await other.getByRole('button', { name: 'Run convert-video', exact: true }).click();
      await page.waitForFunction((count) => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === count, initialCalls.length + 1);
      expect(await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls)).toEqual([...initialCalls, 'convert-video']);
      await batch.getByRole('button', { name: 'Run on 2 files', exact: true }).waitFor({ timeout: 2000 });
      expect(await batch.getByRole('dialog').count()).toBe(0);
      expect(await batch.getByRole('button', { name: /Download ZIP/ }).count()).toBe(0);
    } finally {
      await page.close();
      await rm(directory, { recursive: true });
    }
}, 20000);

it('stale batch at the real registry-await boundary restores review without starting a task', async () => {
  const page = await harness.browser.newPage();
  const directory = await mkdtemp(join(tmpdir(), 'wyreup-stale-registry-batch-'));
  await writeFile(join(directory, 'a.mp4'), 'registry-boundary original a');
  await writeFile(join(directory, 'b.mp4'), 'registry-boundary original b');
  try {
    await page.goto(harness.url + '?scenario=batch');
    const batch = page.getByRole('region', { name: 'Batch caller' });
    await batch.getByText('Or run on every file in a folder', { exact: true }).click();
    const choosing = page.waitForEvent('filechooser');
    await batch.getByRole('button', { name: 'Pick folder…', exact: true }).click();
    await (await choosing).setFiles(directory);
    await batch.getByRole('button', { name: 'Run on 2 files', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Run batch then replace steps synchronously', exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls)).toEqual([]);
    await page.getByRole('region', { name: 'Other caller' }).getByRole('button', { name: 'Run convert-video', exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 1);
    expect(await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls)).toEqual(['convert-video']);
    await batch.getByRole('button', { name: 'Run on 2 files', exact: true }).waitFor({ timeout: 2000 });
    expect(await batch.getByRole('button', { name: /Download ZIP/ }).count()).toBe(0);
  } finally {
    await page.close();
    await rm(directory, { recursive: true });
  }
}, 20000);

it('old stale batch settlement cannot reset a remounted replacement review or release its lease early', async () => {
  const page = await harness.browser.newPage();
  const directory = await mkdtemp(join(tmpdir(), 'wyreup-remounted-batch-'));
  await writeFile(join(directory, 'a.mp4'), 'remount original a');
  await writeFile(join(directory, 'b.mp4'), 'remount original b');
  try {
    await page.goto(harness.url + '?scenario=batch');
    const batch = page.getByRole('region', { name: 'Batch caller' });
    await batch.getByText('Or run on every file in a folder', { exact: true }).click();
    let choosing = page.waitForEvent('filechooser');
    await batch.getByRole('button', { name: 'Pick folder…', exact: true }).click();
    await (await choosing).setFiles(directory);
    await batch.getByRole('button', { name: 'Run on 2 files', exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 1);
    await page.getByRole('button', { name: 'Replace batch steps', exact: true }).click();
    await page.getByRole('button', { name: 'Unmount batch caller', exact: true }).click();
    await page.getByRole('button', { name: 'Mount replacement batch', exact: true }).click();
    await batch.getByText('Or run on every file in a folder', { exact: true }).click();
    choosing = page.waitForEvent('filechooser');
    await batch.getByRole('button', { name: 'Pick folder…', exact: true }).click();
    await (await choosing).setFiles(directory);
    await batch.getByRole('button', { name: 'Run on 2 files', exact: true }).waitFor();
    const other = page.getByRole('region', { name: 'Other caller' });
    await other.getByRole('button', { name: 'Run convert-video', exact: true }).click();
    await other.getByRole('alert').waitFor();
    expect(await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls)).toEqual(['compress-video']);
    await page.evaluate(() => (window as unknown as { settleMedia(): void }).settleMedia());
    await other.getByRole('button', { name: 'Run convert-video', exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 2);
    expect(await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls)).toEqual(['compress-video', 'convert-video']);
    expect(await batch.getByRole('button', { name: 'Run on 2 files', exact: true }).count()).toBe(1);
    expect(await batch.getByRole('button', { name: /Download ZIP/ }).count()).toBe(0);
  } finally {
    await page.close();
    await rm(directory, { recursive: true });
  }
}, 20000);

it('two actual mounted callers refuse concurrent unsettled native work and retain the second original', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await page
      .getByRole('region', { name: 'First caller' })
      .getByRole('button', { name: 'Run convert-video', exact: true })
      .click();
    await page.waitForFunction(
      () => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 1,
    );
    await page
      .getByRole('region', { name: 'Second caller' })
      .getByRole('button', { name: 'Run compress-video', exact: true })
      .click();
    await page
      .getByRole('region', { name: 'Second caller' })
      .getByRole('alert')
      .waitFor({ timeout: 2000 });
    expect(
      await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls),
    ).toEqual(['convert-video']);
    expect(await page.getByRole('region', { name: 'Second caller' }).textContent()).toContain(
      'original.mp4',
    );
    await page.evaluate(() => (window as unknown as { settleMedia(): void }).settleMedia());
  } finally {
    await page.close();
  }
}, 20000);

it('unmount does not release an unsettled caller lease', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await page
      .getByRole('region', { name: 'First caller' })
      .getByRole('button', { name: 'Run convert-video', exact: true })
      .click();
    await page.waitForFunction(
      () => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 1,
    );
    await page.getByRole('button', { name: 'Unmount first caller' }).click();
    await page
      .getByRole('region', { name: 'Second caller' })
      .getByRole('button', { name: 'Run compress-video', exact: true })
      .click();
    await page.getByRole('alert').waitFor({ timeout: 2000 });
    expect(
      await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls),
    ).toEqual(['convert-video']);
    await page.evaluate(() => (window as unknown as { settleMedia(): void }).settleMedia());
  } finally {
    await page.close();
  }
}, 20000);

it('retains the stored original when an automatic URL names a retired step', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url + '?scenario=chain&steps=bg-remove-pro&auto=1');
    await page.getByRole('alert').getByText('bg-remove-pro', { exact: true }).waitFor();
    expect(
      await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls),
    ).toEqual([]);
    const state = await page.evaluate(async () => {
      const value = await (
        window as unknown as { peekMediaFile(): Promise<{ file?: File } | null> }
      ).peekMediaFile();
      return value?.file?.name ?? null;
    });
    expect(state).toBe('original.mp4');
    expect(await page.getByRole('button', { name: 'Use this file for this chain', exact: true }).count()).toBe(0);
  } finally {
    await page.close();
  }
}, 20000);

it('a retired step disables the actual trigger before dispatch', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url + '?scenario=retired-trigger');
    await page.getByRole('dialog').waitFor();
    expect(await page.getByRole('button', { name: /^Run/ }).isDisabled()).toBe(true);
    expect(await page.getByRole('dialog').textContent()).toMatch(/Unknown tool:\s*bg-remove-pro/i);
    expect(
      await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls),
    ).toEqual([]);
  } finally {
    await page.close();
  }
}, 20000);

it('walkthrough exposes a valid importer beyond its historical first six', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url + '?scenario=handover');
    await page.getByRole('listbox', { name: 'Compatible tools' }).waitFor();
    expect(
      await page.getByRole('option', { name: 'camera-shutter-count-checker', exact: true }).count(),
    ).toBe(1);
  } finally {
    await page.close();
  }
}, 20000);

it('failed walkthrough stash stays on page and offers the exact original download', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url + '?scenario=handover');
    await page.getByRole('option', { name: 'convert-video', exact: true }).click();
    await page.getByRole('button', { name: 'Run convert-video →', exact: true }).click();
    await page.waitForTimeout(100);
    expect(new URL(page.url()).searchParams.get('scenario')).toBe('handover');
    expect(await page.getByRole('alert').textContent()).toMatch(/retained|could not/i);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download original', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('original.mp4');
    const path = await download.path();
    if (!path) throw new Error('Original download unavailable.');
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(path, 'utf8')).toBe('independent original bytes');
  } finally {
    await page.close();
  }
}, 20000);

it('replacement original blocks stale result/admission without freeing unsettled work, then admits the current File only', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url);
    await page
      .getByRole('region', { name: 'First caller' })
      .getByRole('button', { name: 'Run convert-video', exact: true })
      .click();
    await page.waitForFunction(
      () => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 1,
    );
    await page.getByRole('button', { name: 'Replace first original' }).click();
    await page
      .getByRole('region', { name: 'Second caller' })
      .getByRole('button', { name: 'Run compress-video', exact: true })
      .click();
    await page.getByRole('alert').waitFor();
    await page.evaluate(() => (window as unknown as { settleMedia(): void }).settleMedia());
    await page.waitForTimeout(50);
    expect(
      await page.evaluate(
        () => (window as unknown as { mediaAdmissions: unknown[] }).mediaAdmissions.length,
      ),
    ).toBe(0);
    expect(await page.getByRole('region', { name: 'First caller' }).textContent()).not.toContain(
      'Download result',
    );
    await page
      .getByRole('region', { name: 'First caller' })
      .getByRole('button', { name: 'Run convert-video', exact: true })
      .click();
    await page.waitForFunction(
      () => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 2,
    );
    await page.evaluate(() => (window as unknown as { settleMedia(): void }).settleMedia());
    await page.waitForFunction(
      () => (window as unknown as { mediaAdmissions: unknown[] }).mediaAdmissions.length === 1,
    );
    expect(
      await page.evaluate(() => {
        const report = (
          window as unknown as { mediaAdmissions: Array<{ file: File; status: string }> }
        ).mediaAdmissions[0];
        return { name: report.file.name, status: report.status };
      }),
    ).toEqual({ name: 'replacement.mp4', status: 'admitted' });
  } finally {
    await page.close();
  }
}, 20000);

it('batch owns one lease across every file and complete real ZIP acquisition', async () => {
  const page = await harness.browser.newPage();
  const directory = await mkdtemp(join(tmpdir(), 'wyreup-owned-media-batch-'));
  await writeFile(join(directory, 'a.mp4'), 'batch original a');
  await writeFile(join(directory, 'b.mp4'), 'batch original b');
  try {
    await page.goto(harness.url + '?scenario=batch');
    await page.getByText('Or run on every file in a folder', { exact: true }).click();
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Pick folder…', exact: true }).click();
    await (await choosing).setFiles(directory);
    await page.getByRole('button', { name: 'Run on 2 files', exact: true }).click();
    await page.waitForFunction(
      () => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 1,
    );
    await page.evaluate(() => (window as unknown as { settleMedia(): void }).settleMedia());
    await page.waitForFunction(
      () => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 2,
    );
    await page
      .getByRole('region', { name: 'Other caller' })
      .getByRole('button', { name: 'Run convert-video', exact: true })
      .click();
    await page.getByRole('region', { name: 'Other caller' }).getByRole('alert').waitFor();
    expect(
      await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls),
    ).toEqual(['compress-video', 'compress-video']);
    await page.evaluate(() => (window as unknown as { settleMedia(): void }).settleMedia());
    await page.getByRole('button', { name: /Download ZIP/ }).waitFor();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download ZIP/ }).click();
    const path = await (await downloading).path();
    if (!path) throw new Error('Complete ZIP missing.');
    const { readFile } = await import('node:fs/promises');
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await readFile(path));
    expect(await zip.file('Wyreup-output/a.mp4')!.async('string')).toBe(
      'actual controlled task result',
    );
    expect(await zip.file('Wyreup-output/b.mp4')!.async('string')).toBe(
      'actual controlled task result',
    );
  } finally {
    await page.close();
    await rm(directory, { recursive: true });
  }
}, 20000);

it('actual chain builder and a direct caller share the same unsettled lease', async () => {
  const page = await harness.browser.newPage();
  page.setDefaultTimeout(5000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(harness.url + '?scenario=builder&steps=convert-video');
    const choosing = page.waitForEvent('filechooser');
    await page
      .getByRole('region', { name: 'Builder caller' })
      .getByRole('button', { name: 'Drop input file or click to browse', exact: true })
      .click();
    await (
      await choosing
    ).setFiles({
      name: 'builder.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('builder original'),
    });
    await page
      .getByRole('region', { name: 'Builder caller' })
      .getByRole('button', { name: 'Run chain', exact: true })
      .click();
    await page.waitForFunction(
      () => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 1,
    );
    await page
      .getByRole('region', { name: 'Other caller' })
      .getByRole('button', { name: 'Run compress-video', exact: true })
      .click();
    await page.getByRole('alert').waitFor();
    expect(
      await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls),
    ).toEqual(['convert-video']);
    await page.evaluate(() => (window as unknown as { settleMedia(): void }).settleMedia());
  } catch (error) {
    console.error('Controlled builder diagnostic', {
      errors,
      body: (await page.locator('body').textContent())?.slice(0, 4000),
    });
    throw error;
  } finally {
    await page.close();
  }
}, 20000);

it('busy trigger preserves original and records no fire until explicit retry actually owns work', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url + '?scenario=trigger');
    await page
      .getByRole('region', { name: 'Other caller' })
      .getByRole('button', { name: 'Run convert-video', exact: true })
      .click();
    await page.waitForFunction(
      () => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 1,
    );
    await page.getByRole('button', { name: 'Fire controlled trigger' }).click();
    await page.getByRole('dialog').waitFor();
    expect(
      await page.evaluate(() => (window as unknown as { mediaFires(): unknown[] }).mediaFires()),
    ).toEqual([]);
    expect(await page.getByRole('dialog').textContent()).toContain('original.mp4');
    expect(
      await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls),
    ).toEqual(['convert-video']);
    await page.evaluate(() => (window as unknown as { settleMedia(): void }).settleMedia());
    await page.getByRole('dialog').getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(
      () => (window as unknown as { mediaCalls: string[] }).mediaCalls.length === 2,
    );
    expect(
      await page.evaluate(
        () => (window as unknown as { mediaFires(): unknown[] }).mediaFires().length,
      ),
    ).toBe(1);
    await page.evaluate(() => (window as unknown as { settleMedia(): void }).settleMedia());
  } finally {
    await page.close();
  }
}, 20000);

it('a retired URL-chain step disables the builder before dispatch of any step', async () => {
  const page = await harness.browser.newPage();
  try {
    await page.goto(harness.url + '?scenario=builder&steps=compress-video|bg-remove-pro');
    const choosing = page.waitForEvent('filechooser');
    await page
      .getByRole('region', { name: 'Builder caller' })
      .getByRole('button', { name: 'Drop input file or click to browse', exact: true })
      .click();
    await (
      await choosing
    ).setFiles({
      name: 'retained-original.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('retained original'),
    });
    const builder = page.getByRole('region', { name: 'Builder caller' });
    expect(await builder.getByRole('button', { name: 'Run chain', exact: true }).isDisabled()).toBe(true);
    expect(await builder.getByText('Unavailable tools: bg-remove-pro', { exact: false }).count()).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls)).toEqual([]);
  } finally {
    await page.close();
  }
}, 20000);

it('a retired batch step fails locally before any file dispatch or ZIP', async () => {
  const page = await harness.browser.newPage();
  const directory = await mkdtemp(join(tmpdir(), 'wyreup-retired-batch-'));
  await writeFile(join(directory, 'a.mp4'), 'retained original a');
  await writeFile(join(directory, 'b.mp4'), 'retained original b');
  try {
    await page.goto(harness.url + '?scenario=batch&retired=1');
    await page.getByText('Or run on every file in a folder', { exact: true }).click();
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Pick folder…', exact: true }).click();
    await (await choosing).setFiles(directory);
    await page.getByRole('button', { name: 'Run on 2 files', exact: true }).click();
    const alert = page.getByRole('region', { name: 'Batch caller' }).getByRole('alert');
    await alert.waitFor({ timeout: 2000 });
    expect(await alert.textContent()).toContain('Tool is unavailable on Wyreup: bg-remove-pro');
    expect(await page.getByRole('button', { name: 'Download ZIP' }).count()).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { mediaCalls: string[] }).mediaCalls)).toEqual([]);
  } finally {
    await page.close();
    await rm(directory, { recursive: true });
  }
}, 20000);

async function busyBatchObservation(page: Page, firstTool: string) {
  return page.evaluate(async (firstTool) => {
    const rawCalls: unknown = Reflect.get(window, 'mediaCalls');
    const rawInputs: unknown = Reflect.get(window, 'mediaCallInputs');
    const captured: unknown = Reflect.get(window, 'busySelectedFiles');
    if (!Array.isArray(rawCalls) || !Array.isArray(rawInputs) || !Array.isArray(captured))
      throw new Error('Actual media/input/chooser observations are unavailable.');
    const calls = rawCalls.map((id: unknown) => {
      if (typeof id !== 'string') throw new Error('Invalid media call observation.');
      return id;
    });
    const selected = captured.map((file: unknown) => {
      if (!(file instanceof File)) throw new Error('Captured chooser value is not a File.');
      return file;
    });
    if (selected.length !== 2) throw new Error('The same two chooser originals are required.');
    const records = rawInputs.map((record: unknown) => {
      if (!record || typeof record !== 'object') throw new Error('Invalid input observation.');
      const toolId: unknown = Reflect.get(record, 'toolId');
      const inputs: unknown = Reflect.get(record, 'inputs');
      if (typeof toolId !== 'string' || !Array.isArray(inputs))
        throw new Error('Invalid actual tool input observation.');
      return {
        toolId,
        inputs: inputs.map((file: unknown) => {
          if (!(file instanceof File)) throw new Error('Observed run input is not a File.');
          return file;
        }),
      };
    });
    const firstSteps = await Promise.all(records.filter((record) => record.toolId === firstTool).map(async (record, index) => {
      if (record.inputs.length !== 1) throw new Error('First chain step needs its actual one File.');
      const file = record.inputs[0];
      return { sameOriginal: file === selected[index], name: file.name, text: await file.text() };
    }));
    return {
      calls,
      inputTools: records.map((record) => record.toolId),
      originals: await Promise.all(selected.map(async (file) => ({ name: file.name, text: await file.text() }))),
      firstSteps,
    };
  }, firstTool);
}

async function settleBusyMedia(page: Page) {
  await page.evaluate(() => {
    const settle: unknown = Reflect.get(window, 'settleMedia');
    if (typeof settle !== 'function') throw new Error('Actual controlled settlement is unavailable.');
    Reflect.apply(settle, undefined, []);
  });
}

it('busy free batch retains its exact selected Files and completes only after an explicit retry', async () => {
    const page = await harness.browser.newPage();
    const directory = await mkdtemp(join(tmpdir(), 'wyreup-busy-retained-batch-'));
    await writeFile(join(directory, 'a.mp4'), 'busy original a');
    await writeFile(join(directory, 'b.mp4'), 'busy original b');
    const firstTool = 'compress-video';
    try {
      await page.goto(harness.url + '?scenario=batch');
      const batch = page.getByRole('region', { name: 'Batch caller' });
      const other = page.getByRole('region', { name: 'Other caller' });
      await batch.getByText('Or run on every file in a folder', { exact: true }).click();
      const choosing = page.waitForEvent('filechooser');
      await batch.getByRole('button', { name: 'Pick folder…', exact: true }).click();
      const chooser = await choosing;
      const actualInput = chooser.element();
      await chooser.setFiles(directory);
      const originals = await page.evaluate(async (element) => {
        if (!(element instanceof HTMLInputElement)) throw new Error('Actual chooser input is unavailable.');
        const files = Array.from(element.files ?? []);
        if (files.length !== 2 || !files.every((file) => file instanceof File))
          throw new Error('Actual chooser must contain exactly two Files.');
        if (JSON.stringify(files.map((file) => file.name).sort()) !== JSON.stringify(['a.mp4', 'b.mp4']))
          throw new Error('Unexpected actual chooser filenames.');
        const values = await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })));
        for (const value of values)
          if (value.text !== (value.name === 'a.mp4' ? 'busy original a' : 'busy original b'))
            throw new Error('Actual chooser bytes differ from the owned inputs.');
        if (Reflect.has(window, 'busySelectedFiles')) throw new Error('Chooser originals were already captured.');
        Reflect.set(window, 'busySelectedFiles', files);
        return values;
      }, actualInput);
      await batch.getByRole('button', { name: 'Run on 2 files', exact: true }).waitFor({ timeout: 2000 });
      await other.getByRole('button', { name: 'Run convert-video', exact: true }).click();
      await page.waitForFunction(() => {
        const calls: unknown = Reflect.get(window, 'mediaCalls');
        return Array.isArray(calls) && calls.length === 1;
      });
      expect((await busyBatchObservation(page, firstTool)).calls).toEqual(['convert-video']);
      await batch.getByRole('button', { name: 'Run on 2 files', exact: true }).click();
      const alert = batch.getByRole('alert');
      await alert.waitFor({ timeout: 2000 });
      expect(await alert.textContent()).toContain('Another media job is still running');
      const denied = await busyBatchObservation(page, firstTool);
      expect(denied.calls).toEqual(['convert-video']);
      expect(denied.inputTools).toEqual(['convert-video']);
      expect(denied.originals).toEqual(originals);
      expect(denied.firstSteps).toEqual([]);
      expect(await batch.getByRole('button', { name: /Download ZIP/ }).count()).toBe(0);
      expect(await batch.getByRole('dialog').count()).toBe(0);
      const retainedRun = batch.getByRole('button', { name: 'Run on 2 files', exact: true });
      const retainedCount = await retainedRun.count();
      console.warn('SOURCE8_SECOND_BUSY_TARGET', JSON.stringify({ reached: 'actual holder, busy alert, no batch calls, no ZIP, retained Run assertion', calls: denied.calls, inputTools: denied.inputTools, originals: denied.originals, retainedRunCount: retainedCount }));
      expect(retainedCount).toBe(1);
      expect(await batch.getByRole('button', { name: 'Cancel', exact: true }).count()).toBe(1);
      expect((await batch.textContent())?.replace(/\s+/g, ' ')).toContain('2 of 2 files match this chain');
      await settleBusyMedia(page);
      await other.getByRole('button', { name: 'Download result', exact: true }).waitFor({ timeout: 2000 });
      expect(await retainedRun.count()).toBe(1);
      const settledHolder = await busyBatchObservation(page, firstTool);
      expect(settledHolder.inputTools).toEqual(['convert-video']);
      expect(settledHolder.originals).toEqual(originals);
      await retainedRun.click();
      const firstCount = 2;
      await page.waitForFunction((count) => {
        const calls: unknown = Reflect.get(window, 'mediaCalls');
        return Array.isArray(calls) && calls.length === count;
      }, firstCount);
      const first = await busyBatchObservation(page, firstTool);
      expect(first.calls).toEqual(['convert-video', 'compress-video']);
      expect(first.inputTools).toEqual(first.calls);
      expect(first.firstSteps).toEqual([{ sameOriginal: true, ...originals[0] }]);
      expect(await batch.getByRole('button', { name: /Download ZIP/ }).count()).toBe(0);
      await settleBusyMedia(page);
      const secondCount = 3;
      await page.waitForFunction((count) => {
        const calls: unknown = Reflect.get(window, 'mediaCalls');
        return Array.isArray(calls) && calls.length === count;
      }, secondCount);
      const second = await busyBatchObservation(page, firstTool);
      expect(second.calls).toEqual(['convert-video', 'compress-video', 'compress-video']);
      expect(second.inputTools).toEqual(second.calls);
      expect(second.firstSteps).toEqual(originals.map((file) => ({ sameOriginal: true, ...file })));
      expect(await batch.getByRole('button', { name: /Download ZIP/ }).count()).toBe(0);
      await settleBusyMedia(page);
      const download = batch.getByRole('button', { name: 'Download ZIP', exact: true });
      await download.waitFor({ timeout: 2000 });
      expect((await batch.textContent())?.replace(/\s+/g, ' ')).toContain('Processed 2 files; 2 outputs');
      expect(await batch.getByText('Show failures', { exact: true }).count()).toBe(0);
      expect(await batch.locator('.batch-result__failures li').count()).toBe(0);
      const downloading = page.waitForEvent('download');
      await download.click();
      const path = await (await downloading).path();
      if (!path) throw new Error('Complete actual ZIP download is unavailable.');
      const { readFile } = await import('node:fs/promises');
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(await readFile(path));
      expect(Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort()).toEqual(['Wyreup-output/a.mp4', 'Wyreup-output/b.mp4']);
      for (const name of ['Wyreup-output/a.mp4', 'Wyreup-output/b.mp4']) {
        const entry = zip.file(name);
        if (!entry) throw new Error('An exact batch output is missing from the ZIP.');
        expect(await entry.async('string')).toBe('actual controlled task result');
      }
      expect((await busyBatchObservation(page, firstTool)).originals).toEqual(originals);
    } finally {
      await page.close();
      await rm(directory, { recursive: true });
    }
}, 20000);
