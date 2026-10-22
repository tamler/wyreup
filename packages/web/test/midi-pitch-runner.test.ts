import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { openBrowserHarness } from './browserHarness';

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../core/test/fixtures/catalog-files/${name}.mp3`, import.meta.url));

function parseMidi(bytes: Uint8Array) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('MThd');
  expect(data.getUint32(4)).toBe(6);
  expect(data.getUint16(8)).toBe(0);
  expect(data.getUint16(10)).toBe(1);
  expect(data.getUint16(12)).toBe(480);
  expect(new TextDecoder().decode(bytes.slice(14, 18))).toBe('MTrk');
  expect(data.getUint32(18)).toBe(bytes.length - 22);
  let offset = 22,
    tick = 0,
    tempo = 0,
    ended = false;
  const notes: { on: boolean; note: number; tick: number }[] = [];
  while (offset < bytes.length) {
    let delta = 0,
      byte = 0;
    do {
      byte = bytes[offset++]!;
      delta = delta * 128 + (byte & 127);
    } while (byte & 128);
    tick += delta;
    const status = bytes[offset++];
    if (status === 255) {
      const type = bytes[offset++],
        length = bytes[offset++];
      if (type === 81) tempo = bytes[offset] * 65536 + bytes[offset + 1] * 256 + bytes[offset + 2];
      else if (type === 88)
        expect([...bytes.slice(offset, offset + length)]).toEqual([4, 2, 24, 8]);
      else {
        expect(type).toBe(47);
        expect(length).toBe(0);
        ended = true;
      }
      offset += length;
    } else {
      expect([128, 144]).toContain(status);
      notes.push({ on: status === 144, note: bytes[offset++], tick });
      offset++;
    }
  }
  expect(ended).toBe(true);
  expect(offset).toBe(bytes.length);
  return { notes, tempo };
}

async function saved(page: Page, button: string) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const path = await (await pending).path();
  if (!path) throw new Error('Missing browser download.');
  return readFile(path);
}

async function chooseFile(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
) {
  const pending = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Drop file or click to browse', exact: true }).click();
  await (await pending).setFiles(file);
}

async function instrument(page: Page, delayed = false) {
  await page.addInitScript(
    ({ delayed }) => {
      const probe = {
        created: 0,
        closed: 0,
        decoded: 0,
        urls: new Set<string>(),
        workerReplies: [] as unknown[],
        release: () => {},
      };
      const NativeWorker = window.Worker;
      class ObservedWorker extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener('message', (event) => probe.workerReplies.push(event.data));
        }
      }
      window.Worker = ObservedWorker;
      const Native = window.AudioContext;
      class ObservedContext extends Native {
        constructor(options?: AudioContextOptions) {
          super(options);
          probe.created++;
        }
        override async decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer> {
          const decoded = await super.decodeAudioData(buffer);
          probe.decoded++;
          if (delayed && probe.decoded === 1)
            await new Promise<void>((resolve) => {
              probe.release = resolve;
            });
          return decoded;
        }
        override close(): Promise<void> {
          probe.closed++;
          return super.close();
        }
      }
      window.AudioContext = ObservedContext;
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        probe.urls.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        probe.urls.delete(url);
        revoke(url);
      };
      Object.assign(window, { midiProbe: probe });
    },
    { delayed },
  );
}

describe('actual MP3 melody preview and selected MIDI exports', () => {
  let harness: Awaited<ReturnType<typeof openBrowserHarness>>;
  beforeAll(async () => {
    harness = await openBrowserHarness('./test/fixtures/MidiPitchHarness.svelte', {
      fileWorker: true,
    });
  }, 30000);
  afterAll(async () => {
    await harness?.close();
  });

  it('mounts the real metadata settings and enables analysis for a selected MP3', async () => {
    const page = await harness.browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(harness.url);
      await page.waitForTimeout(300);
      expect(
        await page
          .getByRole('button', { name: 'Drop file or click to browse', exact: true })
          .count(),
        JSON.stringify({ errors, body: await page.locator('body').innerText() }),
      ).toBe(1);
      await chooseFile(page, fixture('melody-220-440'));
      await page.waitForTimeout(500);
      const state = { errors, body: await page.locator('body').innerText() };
      expect(state.errors, JSON.stringify(state)).toEqual([]);
      expect(
        await page.getByRole('button', { name: 'Analyze melody' }).isEnabled(),
        JSON.stringify(state),
      ).toBe(true);
    } finally {
      await page.close();
    }
  }, 10000);

  it.each([1200, 390])(
    'decodes the original melody, rejects notes and reopens exports at %spx',
    async (width) => {
      const page = await harness.browser.newPage({ viewport: { width, height: 844 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await instrument(page);
        await page.goto(harness.url);
        await chooseFile(page, fixture('melody-220-440'));
        await page.getByRole('button', { name: 'Analyze melody' }).focus();
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
        expect(
          await page.getByRole('alert').count(),
          JSON.stringify({
            errors,
            body: await page.locator('body').innerText(),
            replies: await page.evaluate(
              () =>
                (window as unknown as { midiProbe: { workerReplies: unknown[] } }).midiProbe
                  .workerReplies,
            ),
          }),
        ).toBe(0);
        expect(errors).toEqual([]);
        await page.getByRole('region', { name: 'Detected melody' }).waitFor();
        const report = JSON.parse((await saved(page, 'Download pitch report')).toString()) as {
          notes: { id: string; note: number; start: number; end: number; frequency: number }[];
          unvoicedFrames: number;
        };
        expect(report.notes.map((note) => note.note)).toEqual([57, 69]);
        expect(report.notes.map((note) => note.id)).toEqual(['n0', 'n1']);
        for (const [index, hz] of [220, 440].entries()) {
          const note = report.notes[index];
          expect(Math.abs(note.frequency / hz - 1)).toBeLessThan(0.01);
          expect(Math.abs(note.start - index)).toBeLessThanOrEqual(0.15);
          expect(Math.abs(note.end - index - 1)).toBeLessThanOrEqual(0.15);
        }
        expect(report.unvoicedFrames).toBeGreaterThanOrEqual(0);
        const all = parseMidi(await saved(page, 'Download MIDI'));
        expect(all.tempo).toBe(500000);
        expect(all.notes.map((note) => [note.on, note.note])).toEqual([
          [true, 57],
          [false, 57],
          [true, 69],
          [false, 69],
        ]);
        await page.getByLabel('Accept note n0', { exact: true }).uncheck();
        expect(
          parseMidi(await saved(page, 'Download MIDI')).notes.map((note) => note.note),
        ).toEqual([69, 69]);
        await page.getByRole('button', { name: 'Reject all notes' }).click();
        expect(parseMidi(await saved(page, 'Download MIDI')).notes).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await page.getByLabel('Tempo (BPM)', { exact: true }).fill('');
        expect(await page.getByRole('button', { name: 'Analyze melody' }).isDisabled()).toBe(true);
        expect(await page.getByRole('region', { name: 'Detected melody' }).count()).toBe(0);
        expect(
          await page.evaluate(
            () => (window as unknown as { midiProbe: { urls: Set<string> } }).midiProbe.urls.size,
          ),
        ).toBe(0);
        expect(
          await page.evaluate(() => {
            const probe = (
              window as unknown as {
                midiProbe: { created: number; closed: number; decoded: number };
              }
            ).midiProbe;
            return [probe.created, probe.closed, probe.decoded];
          }),
        ).toEqual([1, 1, 1]);
      } finally {
        await page.close();
      }
    },
    30000,
  );

  it('pages actual thirty-note analysis and saves the complete report and selected MIDI', async () => {
    const page = await harness.browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
      await page.goto(harness.url);
      await chooseFile(page, fixture('alternating-30-notes'));
      await page.getByRole('button', { name: 'Analyze melody' }).click();
      await page.getByRole('region', { name: 'Detected melody' }).waitFor();
      expect(await page.locator('tbody tr').count()).toBe(25);
      await page.getByLabel('Accept note n0', { exact: true }).uncheck();
      await page.getByRole('button', { name: 'Next notes' }).click();
      expect(await page.locator('tbody tr').count()).toBe(5);
      await page.getByLabel('Accept note n29', { exact: true }).waitFor();
      const report = JSON.parse((await saved(page, 'Download pitch report')).toString()) as {
        notes: { id: string; note: number; start: number; end: number; frequency: number }[];
      };
      expect(report.notes).toHaveLength(30);
      for (const [index, note] of report.notes.entries()) {
        const hz = index % 2 ? 440 : 220;
        expect(note.id).toBe(`n${index}`);
        expect(note.note).toBe(index % 2 ? 69 : 57);
        expect(Math.abs(note.frequency / hz - 1)).toBeLessThan(0.01);
        expect(Math.abs(note.start - index)).toBeLessThanOrEqual(0.15);
        expect(Math.abs(note.end - index - 1)).toBeLessThanOrEqual(0.15);
      }
      const midi = parseMidi(await saved(page, 'Download MIDI'));
      expect(midi.notes).toHaveLength(58);
      expect(midi.notes.filter((note) => note.on).map((note) => note.note)).toEqual(
        report.notes.slice(1).map((note) => note.note),
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      await page.close();
    }
  }, 30000);

  it.each(['silence', 'quiet-noise'])(
    'emits a valid no-note MIDI for actual %s MP3',
    async (name) => {
      const page = await harness.browser.newPage();
      try {
        await page.goto(harness.url);
        await chooseFile(page, fixture(name));
        await page.getByRole('button', { name: 'Analyze melody' }).click();
        await page.getByText('No notes met the thresholds.', { exact: false }).waitFor();
        expect(parseMidi(await saved(page, 'Download MIDI')).notes).toEqual([]);
        const report = JSON.parse((await saved(page, 'Download pitch report')).toString()) as {
          status: string;
          notes: unknown[];
        };
        expect(report.status).toBe('no-notes');
        expect(report.notes).toEqual([]);
      } finally {
        await page.close();
      }
    },
    30000,
  );

  it('rejects malformed MP3 before native decode and resets old preview on file replacement', async () => {
    const page = await harness.browser.newPage();
    try {
      await instrument(page);
      await page.goto(harness.url);
      await chooseFile(page, {
        name: 'invalid.mp3',
        mimeType: 'audio/mpeg',
        buffer: Buffer.from('not MP3'),
      });
      await page.getByRole('button', { name: 'Analyze melody' }).click();
      await page.getByRole('alert').waitFor();
      expect(
        await page.evaluate(
          () => (window as unknown as { midiProbe: { created: number } }).midiProbe.created,
        ),
      ).toBe(0);
      await chooseFile(page, fixture('melody-220-440'));
      await page.getByRole('button', { name: 'Analyze melody' }).click();
      await page.getByRole('region', { name: 'Detected melody' }).waitFor();
      await chooseFile(page, fixture('silence'));
      expect(await page.getByRole('region', { name: 'Detected melody' }).count()).toBe(0);
      await page.getByRole('button', { name: 'Clear file' }).click();
      expect(await page.getByRole('button', { name: 'Analyze melody' }).isDisabled()).toBe(true);
    } finally {
      await page.close();
    }
  }, 30000);

  it.each(['cancel', 'unmount'])(
    'closes the real owned context and ignores late decoded audio after %s',
    async (action) => {
      const page = await harness.browser.newPage();
      try {
        await instrument(page, true);
        await page.goto(harness.url);
        await chooseFile(page, fixture('melody-220-440'));
        await page.getByRole('button', { name: 'Analyze melody' }).click();
        await page.waitForFunction(
          () => (window as unknown as { midiProbe: { decoded: number } }).midiProbe.decoded === 1,
        );
        await page
          .getByRole('button', { name: action === 'cancel' ? 'Cancel analysis' : 'Unmount runner' })
          .click();
        await page.waitForFunction(
          () => (window as unknown as { midiProbe: { closed: number } }).midiProbe.closed === 1,
        );
        await page.evaluate(() =>
          (window as unknown as { midiProbe: { release: () => void } }).midiProbe.release(),
        );
        await page.waitForTimeout(200);
        expect(await page.getByRole('region', { name: 'Detected melody' }).count()).toBe(0);
        expect(await page.getByRole('alert').count()).toBe(0);
      } finally {
        await page.close();
      }
    },
    30000,
  );
});
