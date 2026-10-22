<script lang="ts">
  import UtilityRunner from '../../src/components/runners/UtilityRunner.svelte';
  import { cronFromText } from '../../../core/src/tools/cron-from-text/index.js';
  import type { ToolModule } from '../../../core/src/types.js';
  import type { PreloadAdmission } from '../../src/components/runners/types';
  const original = new File(['\ufeffevery weekday at 9am\r\n'], 'cron.txt', { type: 'text/plain' });
  const probe = { reads: 0, calls: [] as { inputCount: number; description: unknown }[], admissions: [] as { sameFile: boolean; status: string }[] };
  const slice = original.slice.bind(original);
  original.slice = (start, end, type) => { probe.reads++; return slice(start, end, type); };
  Object.assign(window, { cronPreloadProbe: probe });
  const injectedTool: ToolModule<Record<string, unknown>> = {
    ...cronFromText, defaults: { ...cronFromText.defaults },
    run(inputs, params, context) {
      probe.calls.push({ inputCount: inputs.length, description: params.description });
      return cronFromText.run(inputs, params, context);
    },
  };
  const tool = { ...cronFromText, defaults: injectedTool.defaults };
  function admitted(result: PreloadAdmission) { probe.admissions.push({ sameFile: result.file === original, status: result.status }); }
</script>
<UtilityRunner {tool} preloadedFile={original} {injectedTool} onPreloadAdmission={admitted} />
