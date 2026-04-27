<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ParamFieldSchema } from '@wyreup/core';

  export let defaults: Record<string, unknown> = {};
  export let params: Record<string, unknown> = {};
  export let paramSchema: Record<string, ParamFieldSchema> | undefined = undefined;

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
    const raw = (e.target as HTMLTextAreaElement).value;
    try {
      const parsed = JSON.parse(raw);
      handleChange(key, parsed);
      jsonErrors = { ...jsonErrors, [key]: '' };
    } catch {
      jsonErrors = { ...jsonErrors, [key]: 'Invalid JSON' };
    }
  }

  function handleSelect(key: string, e: Event) {
    const v = (e.target as HTMLSelectElement).value;
    const def = defaults[key];
    const newValue: unknown = typeof def === 'number' ? parseFloat(v) : v;
    let next: Record<string, unknown> = { ...params, [key]: newValue };

    // Cascading enums: if any other field's options depend on `key`, and
    // the dependent field's current value is no longer in the new option
    // list, reset it to the first valid option. Keeps the form coherent
    // when the user changes a category-style controller.
    if (paramSchema) {
      for (const [otherKey, otherSchema] of Object.entries(paramSchema)) {
        if (otherKey === key) continue;
        if (otherSchema?.type !== 'enum' || !otherSchema.optionsFrom) continue;
        if (otherSchema.optionsFrom.field !== key) continue;
        const newOpts =
          otherSchema.optionsFrom.map[String(newValue)] ?? otherSchema.options;
        const currentOther = next[otherKey] ?? defaults[otherKey];
        const stillValid = newOpts.some(
          (o) => String(o.value) === String(currentOther),
        );
        if (!stillValid && newOpts.length > 0) {
          next = { ...next, [otherKey]: newOpts[0]!.value };
        }
      }
    }

    params = next;
    dispatch('change', params);
  }

  function effectiveOptions(
    schema: Extract<ParamFieldSchema, { type: 'enum' }>,
    activeParams: Record<string, unknown>,
    activeDefaults: Record<string, unknown>,
  ) {
    if (!schema.optionsFrom) return schema.options;
    const controllingValue = String(
      activeParams[schema.optionsFrom.field] ??
        activeDefaults[schema.optionsFrom.field] ??
        '',
    );
    return schema.optionsFrom.map[controllingValue] ?? schema.options;
  }

  function handleRange(key: string, e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    handleChange(key, isNaN(v) ? defaults[key] : v);
  }

  function handleMultiEnum(key: string, option: string, e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    const current = (params[key] ?? defaults[key]) as string[];
    const next = checked
      ? [...current.filter((v) => v !== option), option]
      : current.filter((v) => v !== option);
    handleChange(key, next);
  }

  function handleArrayInput(key: string, schema: { itemType: 'string' | 'number' }, e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    const parts = raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
    const parsed = schema.itemType === 'number'
      ? parts.map((s) => parseFloat(s)).filter((n) => !isNaN(n))
      : parts;
    handleChange(key, parsed);
  }

  let jsonErrors: Record<string, string> = {};

  $: entries = Object.entries(defaults);

  function getFieldId(key: string) {
    return `param-${key}`;
  }

  function getHelpId(key: string) {
    return `param-help-${key}`;
  }

  function fieldLabel(key: string, schema: ParamFieldSchema | undefined): string {
    return schema?.label ?? key;
  }

  function arrayToString(val: unknown): string {
    if (Array.isArray(val)) return val.join(', ');
    return '';
  }

  function shouldShow(
    schema: ParamFieldSchema | undefined,
    activeParams: Record<string, unknown>,
    activeDefaults: Record<string, unknown>,
  ): boolean {
    const cond = schema && 'showWhen' in schema ? schema.showWhen : undefined;
    if (!cond) return true;
    const value = activeParams[cond.field] ?? activeDefaults[cond.field];
    if (cond.equals !== undefined) return value === cond.equals;
    if (cond.in) return cond.in.includes(value as string | number | boolean);
    return true;
  }
</script>

{#if entries.length > 0}
  <div class="params-form">
    <div class="params-label">Parameters</div>
    <div class="params-fields">
      {#each entries as [key, defaultValue]}
        {@const schema = paramSchema?.[key]}
        {@const current = params[key] ?? defaultValue}
        {@const fieldId = getFieldId(key)}
        {@const helpId = getHelpId(key)}
        {#if shouldShow(schema, params, defaults)}
        <div class="param-row" class:param-row--block={schema?.type === 'json' || (schema?.type === 'string' && schema.multiline) || schema?.type === 'array' || schema?.type === 'multi-enum'}>
          <label class="param-key" for={fieldId}>{fieldLabel(key, schema)}</label>
          <div class="param-control">
            {#if schema?.type === 'enum'}
              {@const opts = effectiveOptions(schema, params, defaults)}
              <select
                id={fieldId}
                class="param-select"
                aria-describedby={schema.help ? helpId : undefined}
                on:change={(e) => handleSelect(key, e)}
              >
                {#each opts as opt}
                  <option value={String(opt.value)} selected={String(current) === String(opt.value)}>{opt.label}</option>
                {/each}
              </select>

            {:else if schema?.type === 'multi-enum'}
              <div class="param-multi-enum" role="group" aria-labelledby={fieldId}>
                {#each schema.options as opt}
                  {@const checked = Array.isArray(current) && current.includes(opt.value)}
                  <label class="multi-enum-chip" class:multi-enum-chip--active={checked}>
                    <input
                      type="checkbox"
                      class="sr-only"
                      value={opt.value}
                      {checked}
                      on:change={(e) => handleMultiEnum(key, opt.value, e)}
                    />
                    {opt.label}
                  </label>
                {/each}
              </div>

            {:else if schema?.type === 'range'}
              <div class="param-range-group">
                <input
                  id={fieldId}
                  class="param-range"
                  type="range"
                  min={schema.min}
                  max={schema.max}
                  step={schema.step ?? 1}
                  value={current}
                  aria-valuenow={Number(current)}
                  aria-valuemin={schema.min}
                  aria-valuemax={schema.max}
                  aria-describedby={schema.help ? helpId : undefined}
                  on:input={(e) => handleRange(key, e)}
                />
                <span class="param-range-value">{current}{schema.unit ? schema.unit : ''}</span>
              </div>

            {:else if schema?.type === 'number'}
              <div class="param-number-group">
                <input
                  id={fieldId}
                  class="param-input param-input--number"
                  type="number"
                  min={schema.min}
                  max={schema.max}
                  step={schema.step ?? 'any'}
                  value={current}
                  aria-describedby={schema.help ? helpId : undefined}
                  on:change={(e) => handleNumber(key, e)}
                />
                {#if schema.unit}
                  <span class="param-unit">{schema.unit}</span>
                {/if}
              </div>

            {:else if schema?.type === 'boolean'}
              <label class="param-toggle">
                <input
                  id={fieldId}
                  type="checkbox"
                  checked={!!current}
                  aria-describedby={schema.help ? helpId : undefined}
                  on:change={(e) => handleBool(key, e)}
                />
                <span class="param-toggle__label">{current ? 'on' : 'off'}</span>
              </label>

            {:else if schema?.type === 'string' && schema.multiline}
              <textarea
                id={fieldId}
                class="param-textarea"
                rows="3"
                placeholder={schema.placeholder ?? ''}
                aria-describedby={schema.help ? helpId : undefined}
                on:input={(e) => handleString(key, e)}
              >{String(current)}</textarea>

            {:else if schema?.type === 'string'}
              <input
                id={fieldId}
                class="param-input"
                type="text"
                value={String(current)}
                placeholder={schema.placeholder ?? ''}
                aria-describedby={schema.help ? helpId : undefined}
                on:input={(e) => handleString(key, e)}
              />

            {:else if schema?.type === 'array'}
              <input
                id={fieldId}
                class="param-input"
                type="text"
                value={arrayToString(current)}
                placeholder={schema.placeholder ?? 'comma-separated values'}
                aria-describedby={schema.help ? helpId : undefined}
                on:change={(e) => handleArrayInput(key, schema, e)}
              />

            {:else if schema?.type === 'json'}
              <textarea
                id={fieldId}
                class="param-textarea"
                rows="3"
                placeholder={schema.placeholder ?? '{}'}
                aria-describedby={schema.help ? helpId : undefined}
                on:change={(e) => handleJson(key, e)}
              >{JSON.stringify(current, null, 2)}</textarea>
              {#if jsonErrors[key]}
                <span class="param-json-error">{jsonErrors[key]}</span>
              {/if}

            {:else}
              <!-- Fallback: infer from typeof defaults[key] -->
              {@const inferredType = inferType(key, defaultValue)}
              {#if inferredType === 'boolean'}
                <label class="param-toggle">
                  <input
                    id={fieldId}
                    type="checkbox"
                    checked={!!current}
                    on:change={(e) => handleBool(key, e)}
                  />
                  <span class="param-toggle__label">{current ? 'on' : 'off'}</span>
                </label>
              {:else if inferredType === 'number'}
                <input
                  id={fieldId}
                  class="param-input param-input--number"
                  type="number"
                  value={current}
                  step="any"
                  on:change={(e) => handleNumber(key, e)}
                />
              {:else if inferredType === 'string'}
                <input
                  id={fieldId}
                  class="param-input"
                  type="text"
                  value={String(current)}
                  on:input={(e) => handleString(key, e)}
                />
              {:else}
                <textarea
                  id={fieldId}
                  class="param-textarea"
                  rows="3"
                  on:change={(e) => handleJson(key, e)}
                >{JSON.stringify(current, null, 2)}</textarea>
              {/if}
            {/if}

            {#if schema?.help}
              <p id={helpId} class="param-help">{schema.help}</p>
            {/if}
          </div>
        </div>
        {/if}
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

  .param-row--block {
    align-items: flex-start;
  }

  .param-row--block .param-key {
    padding-top: 6px;
  }

  .param-key {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    min-width: 140px;
    flex-shrink: 0;
  }

  .param-control {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
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

  /* Select */
  .param-select {
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: border-color var(--duration-instant) var(--ease-sharp);
    max-width: 240px;
  }

  .param-select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  /* Range */
  .param-range-group {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .param-range {
    flex: 1;
    accent-color: var(--accent);
    cursor: pointer;
    max-width: 240px;
  }

  .param-range-value {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    min-width: 48px;
  }

  /* Number with unit */
  .param-number-group {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .param-unit {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  /* Multi-enum chips */
  .param-multi-enum {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .multi-enum-chip {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-muted);
    background: var(--bg-raised);
    transition: border-color var(--duration-instant) var(--ease-sharp),
                color var(--duration-instant) var(--ease-sharp);
    user-select: none;
  }

  .multi-enum-chip:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }

  .multi-enum-chip--active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .multi-enum-chip--active:hover {
    border-color: var(--accent-hover, var(--accent));
    color: var(--accent-hover, var(--accent));
  }

  /* Help text */
  .param-help {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    line-height: 1.4;
    margin: 0;
  }

  /* JSON error */
  .param-json-error {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--error, #f87171);
  }

  /* Screen-reader only */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
