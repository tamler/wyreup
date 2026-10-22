<script lang="ts">
  import { onMount, tick } from 'svelte';
  import HowItWorks from '../../src/components/HowItWorks.svelte';
  import JobLauncher from '../../src/components/JobLauncher.svelte';
  import ScenarioGrid from '../../src/components/ScenarioGrid.svelte';
  import ToolFilter from '../../src/components/ToolFilter.svelte';
  import TriggerPreviewSheet from '../../src/components/TriggerPreviewSheet.svelte';
  import BankStatementRunner from '../../src/components/runners/BankStatementRunner.svelte';
  import CsvViewerRunner from '../../src/components/runners/CsvViewerRunner.svelte';
  import MidiPitchRunner from '../../src/components/runners/MidiPitchRunner.svelte';
  import PsdPngRunner from '../../src/components/runners/PsdPngRunner.svelte';
  import StlContourRunner from '../../src/components/runners/StlContourRunner.svelte';
  import ImageSimilarityRunner from '../../src/components/runners/ImageSimilarityRunner.svelte';
  import TrimMediaRunner from '../../src/components/runners/TrimMediaRunner.svelte';
  import PdfCropRunner from '../../src/components/runners/PdfCropRunner.svelte';
  import PdfRedactRunner from '../../src/components/runners/PdfRedactRunner.svelte';
  import { dropStore } from '../../src/stores/drop';
  import { createDefaultRegistry, scanNames, settleScan, source7Runs } from './source7LifecycleCore';
  import { closeSnapshot, rejectFirstClose } from './source7PdfReader';
  import { bankStatementToCsv, stlToGcode } from '@wyreup/core';
  import { csvViewer, psdToPng } from '../../../core/src/utilities/files';
  import { mp3ToMidi } from '../../../core/src/utilities/mp3-to-midi';
  import type { SerializedTool, PreloadAdmission } from '../../src/components/runners/types';
  import type { Chain } from '../../../core/src/chain/types';
  import type { TriggerRule } from '../../../core/src/triggers/types';

  const query = new URLSearchParams(location.search);
  const scenario = query.get('scenario') ?? 'handoff';
  const caller = query.get('caller') ?? 'how';
  const runner = query.get('runner') ?? 'csv';
  const registry = createDefaultRegistry();
  const tools = registry.tools.map(tool => ({ ...tool, accept: [...tool.input.accept] }));
  let mounted = true;
  let ready = false;
  let original = new File(['source7 original bytes'], 'original.txt', { type: 'text/plain' });
  let job = { slug: 'source7-fixed', title: 'Count words', action: { kind: 'tool' as const, toolId: 'word-counter' }, acceptMimes: ['text/plain'] };
  let scanFile = new File(['scan-original'], 'scan-original.txt', { type: 'text/plain' });
  let chain: Chain = [{ toolId: 'word-counter', params: {} }];
  const rule = { id: 'source7-fixed-rule', name: 'Fixed scanner rule', mime: 'text/plain', enabled: true, confirmed: false } as TriggerRule;
  let runEvents: Array<{ name: string; chainFingerprint: string }> = [];
  let pdfFile = new File([new Uint8Array([1])], 'first.pdf', { type: 'application/pdf' });
  const pdfTool: SerializedTool = { id: 'pdf-crop', slug: 'pdf-crop', name: 'PDF fixture', description: '', category: 'pdf', keywords: [], input: { accept: ['application/pdf'], min: 1, max: 1, sizeLimit: 64 }, output: { mime: 'application/pdf' }, defaults: {}, memoryEstimate: 'low' };
  const bounded = (tool: SerializedTool): SerializedTool => ({ ...tool, input: { ...tool.input, sizeLimit: 64 } });
  const bank = bounded(bankStatementToCsv);
  const csv = bounded(csvViewer);
  const midi = bounded({ ...mp3ToMidi, memoryEstimate: 'low' });
  const psd = bounded(psdToPng);
  const stl = bounded(stlToGcode);
  const image: SerializedTool = { ...pdfTool, id: 'image-similarity', slug: 'image-similarity', name: 'Image fixture', category: 'image', input: { accept: ['image/png'], min: 2, max: 4, sizeLimit: 64 }, output: { mime: 'application/json' } };
  const trim: SerializedTool = { ...pdfTool, id: 'trim-media', slug: 'trim-media', name: 'Media fixture', category: 'media', input: { accept: ['video/mp4'], min: 1, max: 1, sizeLimit: 64 }, output: { mime: 'video/mp4' } };
  let preload: File | null = null;
  const admissions: PreloadAdmission[] = [];

  function setDrop() {
    dropStore.set({ file: original, mime: original.type, compatibleTools: [...registry.tools] });
    document.dispatchEvent(new CustomEvent('wyreup:filedrop', { detail: { files: [original] } }));
  }
  function replaceOriginal() {
    original = new File(['source7 replacement original'], 'replacement.txt', { type: 'text/plain' });
    job = { ...job };
    setDrop();
  }
  function replaceScan() {
    scanFile = new File(['scan-replacement'], 'scan-replacement.txt', { type: 'text/plain' });
    chain = [{ toolId: 'word-counter', params: {} }];
  }
  function deliverPreload(kind: 'valid' | 'oversized' | 'wrong-mime') {
    const mime = runner === 'image' ? 'image/png' : 'video/mp4';
    preload = new File([new Uint8Array(kind === 'oversized' ? 65 : 64)], kind + (runner === 'image' ? '.png' : '.mp4'), { type: kind === 'wrong-mime' ? 'text/plain' : mime });
  }
  onMount(async () => {
    Object.assign(window, { source7Probe: {
      scanNames, settleScan, runs: source7Runs, closeSnapshot, rejectFirstClose,
      runEvents: () => runEvents.map(event => ({ ...event })),
      admissions: () => admissions.map(value => ({ name: value.file.name, status: value.status })),
    } });
    await tick();
    if (scenario === 'handoff') setDrop();
    ready = true;
  });
</script>

<div data-source7-ready={ready}>
  <button type="button" on:click={() => { mounted = false; }}>Unmount SOURCE7 target</button>
  <button type="button" on:click={() => { mounted = true; }}>Remount SOURCE7 target</button>
  {#if scenario === 'handoff'}
    <button type="button" on:click={replaceOriginal}>Replace handoff original</button>
    {#if mounted}<section aria-label="SOURCE7 caller">
      {#if caller === 'how'}<HowItWorks />
      {:else if caller === 'job'}<JobLauncher {job} />
      {:else if caller === 'scenario'}<ScenarioGrid />
      {:else if caller === 'filter'}<ToolFilter {tools} categories={['text']} />{/if}
    </section>{/if}
  {:else if scenario === 'trigger'}
    <button type="button" on:click={replaceScan}>Replace scanner input</button>
    {#if mounted}<TriggerPreviewSheet file={scanFile} {rule} {chain} on:run={event => { runEvents = [...runEvents, { name: event.detail.file.name, chainFingerprint: event.detail.chainFingerprint }]; }} />{/if}
  {:else if scenario === 'pdf'}
    <button type="button" on:click={() => { pdfFile = new File([new Uint8Array([2])], 'replacement.pdf', { type: 'application/pdf' }); }}>Replace PDF input</button>
    {#if mounted}
      {#if runner === 'redact'}<PdfRedactRunner tool={{ ...pdfTool, id: 'pdf-redact', slug: 'pdf-redact' }} preloadedFile={pdfFile} />
      {:else}<PdfCropRunner tool={pdfTool} preloadedFile={pdfFile} />{/if}
    {/if}
  {:else if scenario === 'intake'}
    {#if mounted}<section aria-label="SOURCE7 runner">
      {#if runner === 'bank'}<BankStatementRunner tool={bank} />
      {:else if runner === 'csv'}<CsvViewerRunner tool={csv} />
      {:else if runner === 'midi'}<MidiPitchRunner tool={midi} />
      {:else if runner === 'psd'}<PsdPngRunner tool={psd} injectedTool={psdToPng} />
      {:else if runner === 'stl'}<StlContourRunner tool={stl} />{/if}
    </section>{/if}
  {:else if scenario === 'preload'}
    <button type="button" on:click={() => deliverPreload('valid')}>Deliver boundary preload</button>
    <button type="button" on:click={() => deliverPreload('oversized')}>Deliver oversized preload</button>
    <button type="button" on:click={() => deliverPreload('wrong-mime')}>Deliver wrong-MIME preload</button>
    {#if mounted}<section aria-label="SOURCE7 runner">
      {#if runner === 'image'}<ImageSimilarityRunner tool={image} preloadedFile={preload} onPreloadAdmission={value => admissions.push(value)} />
      {:else}<TrimMediaRunner tool={trim} preloadedFile={preload} onPreloadAdmission={value => admissions.push(value)} />{/if}
    </section>{/if}
  {/if}
</div>
