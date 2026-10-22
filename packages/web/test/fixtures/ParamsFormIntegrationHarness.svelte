<script lang="ts">
  import type { ParamFieldSchema } from '@wyreup/core';
  import ParamsForm from '../../src/components/runners/ParamsForm.svelte';

  const typed = new URLSearchParams(location.search).get('scenario') === 'typed';
  const schema: Record<string, ParamFieldSchema> = {
    choice: {
      type: 'enum',
      label: 'Choice',
      options: typed
        ? [{ value: 1, label: 'One' }, { value: '1', label: 'String one' }, { value: 2, label: 'Two' }, { value: '', label: 'Empty string' }]
        : [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }],
    },
    passphrase: { type: 'string', label: 'Passphrase', secret: true },
    ...(typed ? {
      category: {
        type: 'enum' as const,
        label: 'Category',
        options: [{ value: 'numeric', label: 'Numeric category' }, { value: 'string', label: 'String category' }],
      },
      dependent: {
        type: 'enum' as const,
        label: 'Dependent choice',
        options: [{ value: 1, label: 'Numeric dependent' }],
        optionsFrom: {
          field: 'category',
          map: {
            numeric: [{ value: 1, label: 'Numeric dependent' }],
            string: [{ value: '1', label: 'String dependent' }],
          },
        },
      },
      levels: { type: 'array' as const, itemType: 'number' as const, label: 'Levels' },
      note: { type: 'string' as const, label: 'Note' },
    } : {}),
  };
  let params: Record<string, unknown> = typed
    ? { choice: 1, passphrase: '', category: 'numeric', dependent: 1, levels: [0, 1.5, -2], note: '' }
    : {};
  let changes: Record<string, unknown>[] = [];
</script>

<ParamsForm defaults={{}} paramSchema={schema} bind:params on:change={(event) => { changes = [...changes, structuredClone(event.detail)]; }} />
<output aria-label="Current parameters">{JSON.stringify(params)}</output>
<output aria-label="Change count">{changes.length}</output>
<output aria-label="Last change">{JSON.stringify(changes.at(-1) ?? null)}</output>
{#if typed}
  <button on:click={() => { params = { choice: 1, passphrase: '', category: 'numeric', dependent: 1, levels: [9, 10], note: '' }; }}>Reset parameters externally</button>
{/if}
