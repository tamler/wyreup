<script lang="ts">
  import TextInputRunner from '../../src/components/runners/TextInputRunner.svelte';
  import { numberBaseConverter } from '../../../core/src/tools/number-base-converter/index';
  import type { NumberBaseConverterParams } from '../../../core/src/tools/number-base-converter/index';
  import type { ToolModule } from '../../../core/src/types';
  import type { PreloadAdmission, SerializedTool } from '../../src/components/runners/types';
  const original = new File([new Uint8Array([239, 187, 191, 49, 54, 13, 10])], 'original.txt', { type: 'text/plain' });
  const probe = { originalCalls: [] as boolean[], admissions: [] as { sameFile: boolean; status: string }[] };
  Object.assign(window, { originalTextProbe: probe });
  const injectedTool: ToolModule<Record<string, unknown>> = {
    ...numberBaseConverter,
    defaults: { ...numberBaseConverter.defaults },
    run(inputs, params, context) {
      probe.originalCalls.push(inputs[0] === original);
      return numberBaseConverter.run(inputs, params as unknown as NumberBaseConverterParams, context);
    },
  };
  function admitted(result: PreloadAdmission) {
    probe.admissions.push({ sameFile: result.file === original, status: result.status });
  }
</script>

<TextInputRunner tool={numberBaseConverter as unknown as SerializedTool} preloadedFile={original} {injectedTool} showChain={false} onPreloadAdmission={admitted} />
