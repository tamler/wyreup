<script lang="ts">
  import { createUtility } from '@wyreup/core';
  import UtilityRunner from '../../src/components/runners/UtilityRunner.svelte';
  const hostile = '<img src=x onerror=alert(1)> </' + 'script> &';
  let showRunner = true;
  const module = createUtility({
    id: 'acceptance-calculator', name: 'Acceptance calculator', description: 'An injected real calculation for browser acceptance.', category: 'dev', keywords: ['acceptance'],
    defaults: { amount: null, enabled: true, data: { retained: 1 }, mode: 'structured', choice: 1 },
    paramSchema: {
      amount: { type: 'number', label: 'Amount', min: 0, max: 100 },
      enabled: { type: 'boolean', label: 'Include data' },
      data: { type: 'json', label: 'Data', showWhen: { field: 'enabled', equals: true } },
      mode: { type: 'enum', label: 'Result mode', options: [{ value: 'structured', label: 'Structured' }, { value: 'raw', label: 'Raw fallback' }, { value: 'pending', label: 'Pending' }] },
      choice: { type: 'enum', label: 'Typed choice', options: [{ value: 1, label: 'Number one' }, { value: '1', label: 'String one' }, { value: '', label: 'Empty string' }] },
    },
    async calculate(params) {
      if (params.mode === 'pending') await new Promise<void>((resolve, reject) => {
        Object.assign(window, { finishOldRun: resolve, rejectOldRun: () => reject(new Error('stale rejected calculation')) });
      });
      if (params.mode === 'raw') return { complex: [{ deep: { text: hostile } }] };
      return { amount: params.amount as number, enabled: params.enabled as boolean, choice: params.choice as string | number, text: hostile };
    },
  });
</script>

<button type="button" on:click={() => { showRunner = false; }}>Unmount calculator</button>
{#if showRunner}<UtilityRunner tool={module} injectedTool={module} />{/if}
