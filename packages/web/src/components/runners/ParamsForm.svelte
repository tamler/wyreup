<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let defaults: Record<string, unknown> = {};
  export let params: Record<string, unknown> = {};

  const dispatch = createEventDispatcher<{ change: Record<string, unknown> }>();

  // Initialize params from defaults
  $: {
    if (Object.keys(params).length === 0 && Object.keys(defaults).length > 0) {
      params = { ...defaults };
    }
  }

  function inferType(key: string, value: unknown): 'boolean' | 'number' | 'string' | 'json' {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string') return 'string';
    // arrays or objects => json textarea
    return 'json';
  }

  function handleChange(key: string, value: unknown) {
    params = { ...params, [key]: value };
    dispatch('change', params);
  }

  function handleBool(key: string, e: Event) {
    handleChange(key, (e.target as HTMLInputElement).checked);
  }

  function handleNumber(key: string, e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    handleChange(key, isNaN(v) ? defaults[key] : v);
  }

  function handleString(key: string, e: Event) {
    handleChange(key, (e.target as HTMLInputElement).value);
  }

  function handleJson(key: string, e: Event) {
    try {
      const parsed = JSON.parse((e.target as HTMLTextAreaElement).value);
      handleChange(key, parsed);
    } catch {
      // leave last valid value
    }
  }

  $: entries = Object.entries(defaults);
</script>

{#if entries.length > 0}
  <div class="params-form">
    <div class="params-label">Parameters</div>
    <div class="params-fields">
      {#each entries as [key, defaultValue]}
        {@const type = inferType(key, defaultValue)}
        {@const current = params[key] ?? defaultValue}
        <div class="param-row">
          <label class="param-key" for="param-{key}">{key}</label>
          {#if type === 'boolean'}
            <label class="param-toggle">
              <input
                id="param-{key}"
                type="checkbox"
                checked={!!current}
                on:change={(e) => handleBool(key, e)}
              />
              <span class="param-toggle__label">{current ? 'on' : 'off'}</span>
            </label>
          {:else if type === 'number'}
            <input
              id="param-{key}"
              class="param-input param-input--number"
              type="number"
              value={current}
              step="any"
              on:change={(e) => handleNumber(key, e)}
            />
          {:else if type === 'string'}
            <input
              id="param-{key}"
              class="param-input"
              type="text"
              value={String(current)}
              on:input={(e) => handleString(key, e)}
            />
          {:else}
            <textarea
              id="param-{key}"
              class="param-textarea"
              rows="3"
              on:change={(e) => handleJson(key, e)}
            >{JSON.stringify(current, null, 2)}</textarea>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .params-form {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .params-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 400;
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-raised);
    border-bottom: 1px solid var(--border);
  }

  .params-fields {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    background: var(--bg-elevated);
  }

  .param-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 32px;
  }

  .param-key {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    min-width: 140px;
    flex-shrink: 0;
  }

  .param-input {
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    flex: 1;
    transition: border-color var(--duration-instant) var(--ease-sharp);
  }

  .param-input--number {
    max-width: 120px;
  }

  .param-input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .param-textarea {
    padding: var(--space-2);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    flex: 1;
    resize: vertical;
    min-height: 64px;
    transition: border-color var(--duration-instant) var(--ease-sharp);
  }

  .param-textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .param-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
  }

  .param-toggle input[type="checkbox"] {
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .param-toggle__label {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
</style>
