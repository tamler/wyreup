<script lang="ts">
  import { flushSync, onMount } from 'svelte';
  import PreviewRunner from '../../src/components/runners/PreviewRunner.svelte';
  import ChainRunner from '../../src/components/ChainRunner.svelte';
  import BatchFolderRun from '../../src/components/BatchFolderRun.svelte';
  import ChainBuilder from '../../src/components/ChainBuilder.svelte';
  import TriggerRuntime from '../../src/components/TriggerRuntime.svelte';
  import TriggerPreviewSheet from '../../src/components/TriggerPreviewSheet.svelte';
  import HowItWorks from '../../src/components/HowItWorks.svelte';
  import { dropStore } from '../../src/stores/drop';
  import { stashChainHandover, peekChainHandover } from '../../src/components/runners/chainStorage';
  import { calls, callInputs, settleFirst, createDefaultRegistry } from './mediaCallerCore';
  import type { SerializedTool } from '../../src/components/runners/types';
  import type { PreloadAdmission } from '../../src/components/runners/types';
  import type { TriggerRule } from '@wyreup/core';
  import { upsertRule, getFires } from '../../src/components/runners/triggerStorage';
  import { saveChain } from '../../src/components/runners/toolbeltStorage';
  import { user, authReady } from '../../src/stores/user';
  const scenario = new URLSearchParams(location.search).get('scenario') ?? 'race';
  const file = new File(['independent original bytes'], 'original.mp4', { type: 'video/mp4' });
  const registry = createDefaultRegistry();
  const first = registry.toolsById.get('convert-video') as unknown as SerializedTool;
  const second = registry.toolsById.get('compress-video') as unknown as SerializedTool;
  const tools = Array.from(registry.toolsById.values()).map((t) => ({ id: t.id, name: t.name, outputMime: t.output.mime, defaults: t.defaults }));
  const rule = { id: 'controlled-rule', name: 'Controlled paid rule', mime: '*/*', enabled: true, confirmed: false } as TriggerRule;
  let firstMounted = true;
  let firstFile = file;
  const admissions: PreloadAdmission[] = [];
  const buildTools = [...registry.tools].map((t) => ({ id: t.id, name: t.name, description: t.description, inputAccept: t.input.accept, inputMin: t.input.min, outputMime: t.output.mime, defaults: t.defaults }));
  let chainSteps = new URLSearchParams(location.search).get('paid') === '1'
    ? [{ toolId: 'bg-remove-pro', name: 'bg-remove-pro', params: {}, valid: true }, { toolId: 'compress-video', name: 'compress-video', params: {}, valid: true }]
    : [{ toolId: 'compress-video', name: 'compress-video', params: {}, valid: true }];
  let batchMounted = true;
  let batchRegion: HTMLElement;
  function replaceBatchSteps() {
    chainSteps = [{ toolId: 'convert-video', name: 'convert-video', params: {}, valid: true }];
  }
  function runThenReplaceBatch() {
    const run = Array.from(batchRegion.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Run on 2 files');
    if (!run) throw new Error('Controlled batch review is not ready');
    // The real handler reaches its first dynamic-import await before this
    // synchronous prop update; no timer or mocked registry continuation.
    run.click();
    flushSync(replaceBatchSteps);
  }
  let ready = scenario !== 'chain';
  onMount(async () => {
    Object.assign(window, { mediaCalls: calls, mediaCallInputs: callInputs, settleMedia: settleFirst, peekMediaFile: peekChainHandover, mediaAdmissions: admissions, mediaFires: getFires });
    user.set({ email: 'controlled@example.invalid', balance: 100 }); authReady.set(true);
    if (scenario === 'trigger') {
      const now = new Date().toISOString();
      saveChain({ id: 'controlled-chain', name: 'Controlled media chain', steps: [{ toolId: 'compress-video', params: {} }], createdAt: now, updatedAt: now });
      upsertRule({ id: 'controlled-rule', name: 'Controlled media rule', mime: 'video/*', chainId: 'controlled-chain', order: 0, confirmed: true, enabled: true, createdAt: Date.now(), updatedAt: Date.now() });
    }
    if (scenario === 'chain') { await stashChainHandover(file, { autoAccept: false }); ready = true; }
    if (scenario === 'handover') {
      dropStore.set({ file, mime: file.type, compatibleTools: [...registry.tools] });
      Object.defineProperty(indexedDB, 'open', { configurable: true, value() { throw new Error('Controlled storage failure'); } });
    }
  });
</script>
{#if scenario === 'race'}
  <button on:click={() => { firstMounted = false; }}>Unmount first caller</button>
  <button on:click={() => { firstFile = new File(['replacement original bytes'], 'replacement.mp4', { type: 'video/mp4' }); }}>Replace first original</button>
  {#if firstMounted}<section aria-label="First caller"><PreviewRunner tool={first} preloadedFile={firstFile} onPreloadAdmission={(result) => admissions.push(result)} /></section>{/if}
  <section aria-label="Second caller"><PreviewRunner tool={second} preloadedFile={file} /></section>
{:else if scenario === 'chain' && ready}
  <ChainRunner {tools} />
{:else if scenario === 'price'}
  <TriggerPreviewSheet {file} {rule} chain={[{ toolId: 'bg-remove-pro', params: {} }]} />
{:else if scenario === 'handover'}
  <HowItWorks />
{:else if scenario === 'batch'}
  <button on:click={replaceBatchSteps}>Replace batch steps</button>
  <button on:click={runThenReplaceBatch} disabled={!batchMounted}>Run batch then replace steps synchronously</button>
  <button on:click={() => { batchMounted = false; }}>Unmount batch caller</button>
  <button on:click={() => { chainSteps = [{ toolId: 'compress-video', name: 'compress-video', params: {}, valid: true }]; batchMounted = true; }} disabled={batchMounted}>Mount replacement batch</button>
  <section aria-label="Batch caller" bind:this={batchRegion}>{#if batchMounted}<BatchFolderRun resolvedSteps={chainSteps} />{/if}</section>
  <section aria-label="Other caller"><PreviewRunner tool={first} preloadedFile={file} /></section>
{:else if scenario === 'builder'}
  <section aria-label="Builder caller"><ChainBuilder tools={buildTools} /></section>
  <section aria-label="Other caller"><PreviewRunner tool={second} preloadedFile={file} /></section>
{:else if scenario === 'trigger'}
  <TriggerRuntime />
  <button on:click={() => document.dispatchEvent(new CustomEvent('wyreup:filedrop', { cancelable: true, detail: { files: [file] } }))}>Fire controlled trigger</button>
  <section aria-label="Other caller"><PreviewRunner tool={first} preloadedFile={file} /></section>
{/if}
