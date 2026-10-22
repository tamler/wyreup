<script lang="ts">
  import PsdPngRunner from '../../src/components/runners/PsdPngRunner.svelte';
  import CsvViewerRunner from '../../src/components/runners/CsvViewerRunner.svelte';
  import BankStatementRunner from '../../src/components/runners/BankStatementRunner.svelte';
  import StlContourRunner from '../../src/components/runners/StlContourRunner.svelte';
  import MidiPitchRunner from '../../src/components/runners/MidiPitchRunner.svelte';
  import TimerRunner from '../../src/components/runners/TimerRunner.svelte';
  import SeatingChartRunner from '../../src/components/runners/SeatingChartRunner.svelte';
  import ColorConverterRunner from '../../src/components/runners/ColorConverterRunner.svelte';
  import { psdToPng, csvViewer } from '../../../core/src/utilities/files';
  import { bankStatementToCsv } from '../../../core/src/utilities/bank-module';
  import { stlToGcode } from '../../../core/src/utilities/stl-module';
  import { mp3ToMidi } from '../../../core/src/utilities/mp3-to-midi';
  import { planningTools } from '../../../core/src/utilities/planning';
  import { colorConverter } from '../../../core/src/tools/color-converter/index';
  import { parseCsv } from '../../../core/src/utilities/csv-data';
  import type { CsvFileJob } from '../../../core/src/utilities/file-job';
  import type { PreloadAdmission } from '../../src/components/runners/types';

  interface FixtureInput { bytes: number[]; name: string; mime: string; delayedRead?: boolean; failRead?: boolean; understatedSize?: boolean }
  const input = (window as unknown as { admissionFixtureInput: FixtureInput }).admissionFixtureInput;
  const query = new URLSearchParams(location.search);
  const id = query.get('id') ?? 'csv-viewer';
  function makeFile(raw: FixtureInput) {
    const file = new File([new Uint8Array(raw.bytes)], raw.name, { type: raw.mime });
    if (raw.understatedSize) Object.defineProperty(file, 'size', { value: 1 });
    return file;
  }
  const original = makeFile(input);
  let preloadedFile: File | null = original;
  let visible = true;
  const operationReleases: (() => void)[] = [];
  const probe = { events: [] as { status: string; original: boolean; current: boolean; name: string }[], reads: 0, completedReads: 0, pendingOperations: 0, completedOperations: 0, slices: [] as number[], releaseRead: () => {}, releaseOperation: () => { operationReleases.shift()?.(); } };
  Object.assign(window, { admissionFixture: probe });
  const actualText = original.text.bind(original);
  const actualBuffer = original.arrayBuffer.bind(original);
  const actualSlice = original.slice.bind(original);
  async function waitRead() {
    probe.reads++;
    if (input.failRead) throw new Error('Controlled actual File read rejection.');
    if (input.delayedRead) await new Promise<void>(resolve => { probe.releaseRead = resolve; });
  }
  original.text = async () => { await waitRead(); const result = await actualText(); probe.completedReads++; return result; };
  original.arrayBuffer = async () => { await waitRead(); const result = await actualBuffer(); probe.completedReads++; return result; };
  original.slice = (start, end, type) => {
    probe.slices.push(end ?? original.size);
    const blob = actualSlice(start, end, type);
    const read = blob.arrayBuffer.bind(blob);
    blob.arrayBuffer = async () => { await waitRead(); const result = await read(); probe.completedReads++; return result; };
    return blob;
  };
  function admitted(result: PreloadAdmission) {
    probe.events.push({ status: result.status, original: result.file === original, current: result.file === preloadedFile, name: result.file.name });
  }
  async function parse(job: CsvFileJob, signal: AbortSignal) {
    const table = parseCsv(job.bytes, job.params, signal);
    if (query.has('deferred')) { probe.pendingOperations++; await new Promise<void>(resolve => { operationReleases.push(resolve); }); }
    probe.completedOperations++;
    return table;
  }
  const injectedColor: typeof colorConverter = { ...colorConverter, async run(files, params, ctx) {
    const result = await colorConverter.run(files, params, ctx);
    if (query.has('deferred')) { probe.pendingOperations++; await new Promise<void>(resolve => { operationReleases.push(resolve); }); }
    probe.completedOperations++;
    return result;
  } };
  const planningTool = planningTools.find(tool => tool.id === id);
  const stlTool = { ...stlToGcode, defaults: { ...stlToGcode.defaults, layerHeightMm: 2 } };
</script>
<button type="button" on:click={() => { visible = false; }}>Unmount admission runner</button>
<button type="button" on:click={() => { preloadedFile = new File(['name,count\nReplacement,7'], 'replacement.csv', { type: 'text/csv' }); }}>Replace original preload</button>
{#if visible}
  {#if id === 'psd-to-png'}
    <PsdPngRunner tool={psdToPng} {preloadedFile} onPreloadAdmission={admitted} injectedTool={psdToPng} />
  {:else if id === 'csv-viewer'}
    <CsvViewerRunner tool={csvViewer} {preloadedFile} onPreloadAdmission={admitted} injectedParser={parse} />
  {:else if id === 'bank-statement-to-csv'}
    <BankStatementRunner tool={bankStatementToCsv} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'stl-to-gcode'}
    <StlContourRunner tool={stlTool} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'mp3-to-midi'}
    <MidiPitchRunner tool={mp3ToMidi} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'color-converter'}
    <ColorConverterRunner tool={colorConverter} {preloadedFile} onPreloadAdmission={admitted} injectedTool={injectedColor} showChain={false} />
  {:else if planningTool && id === 'wedding-seating-chart-builder'}
    <SeatingChartRunner tool={planningTool} {preloadedFile} onPreloadAdmission={admitted} injectedTool={planningTool} />
  {:else if planningTool}
    <TimerRunner tool={planningTool} {preloadedFile} onPreloadAdmission={admitted} injectedTool={planningTool} />
  {/if}
{/if}
