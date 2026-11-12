<script lang="ts">
  import TextInputRunner from '../../src/components/runners/TextInputRunner.svelte';
  import { textToSpeechPro } from '../../../core/src/tools/text-to-speech-pro/index.js';
  import type { SerializedTool } from '../../src/components/runners/types';
  const injectedTool = { ...textToSpeechPro, run: async () => new Blob([new Uint8Array([73, 68, 51, 3])], { type: 'audio/mpeg' }) };
  const tool = textToSpeechPro as unknown as SerializedTool;
</script>

<TextInputRunner {tool} {injectedTool} showChain={false} />
