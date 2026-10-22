<script lang="ts">
  import UtilityRunner from '../../src/components/runners/UtilityRunner.svelte';
  import { cronFromText } from '../../../core/src/tools/cron-from-text';
  import type { ToolModule } from '../../../core/src/types';
  const injectedTool = cronFromText as unknown as ToolModule<Record<string, unknown>>;
  const tool = { ...cronFromText, slug: cronFromText.id, defaults: injectedTool.defaults };
</script>
<UtilityRunner {tool} {injectedTool} />
