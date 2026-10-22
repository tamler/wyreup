<script lang="ts">
  import type { ToolModule } from '@wyreup/core';
  import { numberBaseConverter } from '../../../core/src/tools/number-base-converter/index.js';
  import TextInputRunner from '../../src/components/runners/TextInputRunner.svelte';
  import type { PreloadAdmission, SerializedTool } from '../../src/components/runners/types';

  const invalid = new URLSearchParams(location.search).has('invalid');
  const original = new File([invalid ? new Uint8Array([0xff, 0x61]) : new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x0d, 0x0a])], 'original.txt', { type: 'text/plain' });
  const probe = { admissions: [] as { status: string; sameFile: boolean }[], calls: [] as { sameFile: boolean; bytes: number[] }[] };
  Object.assign(window, { ownedTextProbe: probe });
  const module: ToolModule<Record<string, unknown>> = {
    ...numberBaseConverter,
    defaults: { ...numberBaseConverter.defaults },
    async run(inputs, params, ctx) {
      probe.calls.push({ sameFile: inputs[0] === original, bytes: Array.from(new Uint8Array(await inputs[0]!.arrayBuffer())) });
      return numberBaseConverter.run(inputs, params, ctx);
    },
  };
  const tool: SerializedTool = { ...module, memoryEstimate: module.memoryEstimate ?? 'low' };
  function admitted(result: PreloadAdmission) { probe.admissions.push({ status: result.status, sameFile: result.file === original }); }
</script>

<TextInputRunner {tool} preloadedFile={original} injectedTool={module} onPreloadAdmission={admitted} showChain={false} />
