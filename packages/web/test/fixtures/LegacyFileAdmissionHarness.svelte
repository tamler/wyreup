<script lang="ts">
  import SimpleImageRunner from '../../src/components/runners/SimpleImageRunner.svelte';
  import MultiOutputRunner from '../../src/components/runners/MultiOutputRunner.svelte';
  import TextResultRunner from '../../src/components/runners/TextResultRunner.svelte';
  import ColorPaletteRunner from '../../src/components/runners/ColorPaletteRunner.svelte';
  import HashRunner from '../../src/components/runners/HashRunner.svelte';
  import ImageInfoRunner from '../../src/components/runners/ImageInfoRunner.svelte';
  import PdfInfoRunner from '../../src/components/runners/PdfInfoRunner.svelte';
  import PdfMetadataRunner from '../../src/components/runners/PdfMetadataRunner.svelte';
  import QrReaderRunner from '../../src/components/runners/QrReaderRunner.svelte';
  import ImageSimilarityRunner from '../../src/components/runners/ImageSimilarityRunner.svelte';
  import ZipInfoRunner from '../../src/components/runners/ZipInfoRunner.svelte';
  import ExcelInfoRunner from '../../src/components/runners/ExcelInfoRunner.svelte';
  import { createDefaultRegistry } from '@wyreup/core';
  import type { SerializedTool, PreloadAdmission } from '../../src/components/runners/types';
  interface FixtureInput { bytes: number[]; name: string; mime: string; delayedRead?: boolean; failRead?: boolean }
  const input = (window as unknown as { legacyAdmissionInput: FixtureInput }).legacyAdmissionInput;
  const id = new URLSearchParams(location.search).get('id') ?? 'hash';
  const module = createDefaultRegistry().toolsById.get(id);
  if (!module) throw new Error(`Actual default registry is missing ${id}.`);
  const tool: SerializedTool = { ...module, slug: module.id };
  const original = new File([new Uint8Array(input.bytes)], input.name, { type: input.mime });
  let preloadedFile: File | null = original;
  let visible = true;
  const probe = { events: [] as { status: string; original: boolean; current: boolean }[], reads: 0, completedReads: 0, releaseRead: () => {} };
  Object.assign(window, { legacyAdmission: probe });
  const readText = original.text.bind(original);
  const readBuffer = original.arrayBuffer.bind(original);
  async function waitRead() {
    probe.reads++;
    if (input.failRead) throw new Error('Controlled actual File read rejection.');
    if (input.delayedRead) await new Promise<void>(resolve => { probe.releaseRead = resolve; });
  }
  original.text = async () => { await waitRead(); const result = await readText(); probe.completedReads++; return result; };
  original.arrayBuffer = async () => { await waitRead(); const result = await readBuffer(); probe.completedReads++; return result; };
  function admitted(result: PreloadAdmission) { probe.events.push({ status: result.status, original: result.file === original, current: result.file === preloadedFile }); }
</script>
<button type="button" on:click={() => { visible = false; }}>Unmount legacy runner</button>
<button type="button" on:click={() => { preloadedFile = new File(['replacement'], 'replacement.txt', { type: 'text/plain' }); }}>Replace legacy preload</button>
{#if visible}
  {#if id === 'hash'}<HashRunner {tool} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'split-pdf'}<MultiOutputRunner {tool} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'base64'}<TextResultRunner {tool} {preloadedFile} onPreloadAdmission={admitted} showChain={false} />
  {:else if id === 'color-palette'}<ColorPaletteRunner {tool} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'image-info'}<ImageInfoRunner {tool} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'pdf-info'}<PdfInfoRunner {tool} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'pdf-metadata'}<PdfMetadataRunner {tool} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'qr-reader'}<QrReaderRunner {tool} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'image-similarity'}<ImageSimilarityRunner {tool} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'zip-info'}<ZipInfoRunner {tool} {preloadedFile} onPreloadAdmission={admitted} />
  {:else if id === 'excel-info'}<ExcelInfoRunner {tool} {preloadedFile} onPreloadAdmission={admitted} />
  {:else}<SimpleImageRunner {tool} {preloadedFile} onPreloadAdmission={admitted} />{/if}
{/if}
