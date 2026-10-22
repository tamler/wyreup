<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
import { utilityFieldOptions, utilityFieldVisible, type ParamFieldSchema } from '@wyreup/core/execution';
  import { changeUtilityField, parseUtilityArray, utilityEnumToken, utilityEnumValue, utilityFormErrors, type UtilitySchema } from './utilityFormState';

  export let defaults: Record<string, unknown>;
  export let params: Record<string, unknown>;
  export let paramSchema: UtilitySchema;
  const dispatch = createEventDispatcher<{ change: { params: Record<string, unknown>; valid: boolean } }>();
  let parseErrors: Record<string, string> = {};
  let drafts: Record<string, string> = {};
  $: errors = utilityFormErrors(defaults, paramSchema, params, parseErrors);

  function notifyChange() {
    const currentErrors = utilityFormErrors(defaults, paramSchema, params, parseErrors);
    dispatch('change', { params, valid: Object.keys(currentErrors).length === 0 });
  }

  onMount(notifyChange);

  function update(key: string, value: unknown) {
    parseErrors = { ...parseErrors, [key]: '' };
    params = changeUtilityField(paramSchema, params, key, value);
    notifyChange();
  }

  function textValue(value: unknown): string {
    return value === null || value === undefined ? '' : String(value);
  }

  function numberInput(key: string, event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    if (input.validity.badInput) {
      parseErrors = { ...parseErrors, [key]: 'Enter a valid number.' };
      notifyChange();
      return;
    }
    update(key, input.value.trim() === '' ? null : Number(input.value));
  }

  function structuredInput(key: string, field: ParamFieldSchema, event: Event) {
    const raw = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
    drafts = { ...drafts, [key]: raw };
    try {
      update(key, field.type === 'array' ? parseUtilityArray(raw, field.itemType) : JSON.parse(raw));
    } catch (error) {
      parseErrors = { ...parseErrors, [key]: field.type === 'json' ? 'Enter valid JSON.' : error instanceof Error ? error.message : 'Check the list.' };
      notifyChange();
    }
  }

  function multiInput(key: string, value: string, event: Event) {
    const selected = Array.isArray(params[key]) ? params[key] as string[] : [];
    update(key, (event.currentTarget as HTMLInputElement).checked ? [...selected, value] : selected.filter((item) => item !== value));
  }
</script>

<div class="utility-fields">
  {#each Object.entries(paramSchema) as [key, field]}
    {#if utilityFieldVisible(field, params)}
      {@const id = `utility-${key}`}
      {@const helpId = `${id}-help`}
      {@const errorId = `${id}-error`}
      {@const describedBy = [field.help ? helpId : '', errors[key] ? errorId : ''].filter(Boolean).join(' ') || undefined}
      <div class="utility-field">
        {#if field.type === 'multi-enum'}
          <fieldset>
            <legend>{field.label ?? key}</legend>
            {#each field.options as option}
              <label class="choice">
                <input type="checkbox" checked={Array.isArray(params[key]) && (params[key] as string[]).includes(option.value)} aria-describedby={describedBy} on:change={(event) => multiInput(key, option.value, event)} />
                {option.label}
              </label>
            {/each}
          </fieldset>
        {:else}
          <label for={id}>{field.label ?? key}{'unit' in field && field.unit ? ` (${field.unit})` : ''}</label>
          {#if field.type === 'number' || field.type === 'range'}
            <input {id} type={field.type === 'range' ? 'range' : 'number'} min={field.min} max={field.max} step={field.step ?? (field.type === 'range' ? 1 : 'any')} value={textValue(params[key])} aria-invalid={!!errors[key]} aria-describedby={describedBy} on:input={(event) => numberInput(key, event)} />
            {#if field.type === 'range'}<output for={id}>{textValue(params[key])}</output>{/if}
          {:else if field.type === 'boolean'}
            <input {id} type="checkbox" checked={params[key] === true} aria-describedby={describedBy} on:change={(event) => update(key, (event.currentTarget as HTMLInputElement).checked)} />
          {:else if field.type === 'enum'}
            <select {id} value={utilityEnumToken(field, params, key)} aria-invalid={!!errors[key]} aria-describedby={describedBy} on:change={(event) => update(key, utilityEnumValue(field, params, (event.currentTarget as HTMLSelectElement).value))}>
              <option value="">Choose an option</option>
              {#each utilityFieldOptions(field, params) as option, index}<option value={String(index)}>{option.label}</option>{/each}
            </select>
          {:else if field.type === 'json'}
            <textarea {id} rows="5" value={drafts[key] ?? JSON.stringify(params[key], null, 2)} aria-invalid={!!errors[key]} aria-describedby={describedBy} on:input={(event) => structuredInput(key, field, event)}></textarea>
          {:else if field.type === 'array'}
            <input {id} type="text" value={drafts[key] ?? (Array.isArray(params[key]) ? (params[key] as unknown[]).join(', ') : '')} placeholder={field.placeholder ?? 'Comma-separated values'} aria-invalid={!!errors[key]} aria-describedby={describedBy} on:input={(event) => structuredInput(key, field, event)} />
          {:else if field.type === 'string' && field.multiline}
            <textarea {id} rows="4" value={textValue(params[key])} minlength={field.minLength} maxlength={field.maxLength} placeholder={field.placeholder} aria-invalid={!!errors[key]} aria-describedby={describedBy} on:input={(event) => update(key, (event.currentTarget as HTMLTextAreaElement).value)}></textarea>
          {:else if field.type === 'string'}
            <input {id} type="text" value={textValue(params[key])} minlength={field.minLength} maxlength={field.maxLength} placeholder={field.placeholder} aria-invalid={!!errors[key]} aria-describedby={describedBy} on:input={(event) => update(key, (event.currentTarget as HTMLInputElement).value)} />
          {/if}
        {/if}
        {#if field.help}<p id={helpId} class="help">{field.help}</p>{/if}
        {#if errors[key]}<p id={errorId} class="error">{errors[key]}</p>{/if}
      </div>
    {/if}
  {/each}
  {#if errors.$form}<p class="error" role="alert">{errors.$form}</p>{/if}
</div>

<style>
  .utility-fields { display: grid; gap: var(--space-3); }
  .utility-field { display: grid; gap: var(--space-1); }
  label, legend { color: var(--text-primary); font-size: var(--text-sm); }
  input, select, textarea { padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-raised); color: var(--text-primary); font: inherit; min-width: 0; }
  input[type='checkbox'] { justify-self: start; }
  textarea { resize: vertical; }
  input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
  fieldset { border: 1px solid var(--border); }
  .choice { display: flex; gap: var(--space-2); align-items: center; }
  .help, .error { margin: 0; font-size: var(--text-sm); }
  .help { color: var(--text-muted); }
  .error { color: var(--text-primary); }
</style>
