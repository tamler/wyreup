<script lang="ts">
  import { onDestroy } from 'svelte';
import { validatePlanningSnapshot, type SeatingPlan, type ToolModule } from '@wyreup/core/execution';
  import type { PreloadAdmission, SerializedTool } from './types';
  import { emptySeatingPlan, editSeatingPlan, assignSeat, removeSeatingItem } from './seatingState';
  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;
  export let onPreloadAdmission: ((result: PreloadAdmission) => void) | undefined = undefined;
  export let injectedTool: ToolModule<Record<string, unknown>> | undefined = undefined;
  let plan: SeatingPlan = emptySeatingPlan(); let guestName = ''; let tableName = ''; let capacity = 8; let importNames = '';
  let error = ''; let notice = ''; let destroyed = false; let generation = 0; let controller: AbortController | null = null;
  const urls = new Set<string>();
  let observedPreload: File | null = null;
  let restoreFile: File | null = null;
  const attemptedPreloads = new WeakSet<File>();
  $: if (preloadedFile !== observedPreload) stagePreload(preloadedFile);
  function report(file: File, status: 'admitted' | 'refused') {
    if (!destroyed && file === preloadedFile)
      onPreloadAdmission?.(status === 'admitted' ? { file, status } : { file, status, message: 'Seating plan was not restored.' });
  }
  function invalidateAsync() {
    if (restoreFile) report(restoreFile, 'refused');
    restoreFile = null; generation++; controller?.abort(); controller = null;
    for (const url of urls) URL.revokeObjectURL(url); urls.clear();
  }
  function stagePreload(file: File | null) {
    observedPreload = file; invalidateAsync();
    if (file && !attemptedPreloads.has(file)) { attemptedPreloads.add(file); void restoreSnapshot(file, true); }
  }
  function edit(change: (draft: SeatingPlan) => void) { invalidateAsync(); try { plan = editSeatingPlan(plan, change); error = ''; notice = ''; } catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid edit.'; plan = { ...plan }; } }
  function addGuest() { invalidateAsync(); if (!guestName.trim()) { error = 'Enter a guest name.'; return; } edit(draft => draft.guests.push({ id: crypto.randomUUID(), name: guestName.trim() })); if (!error) guestName = ''; }
  function addTable() { invalidateAsync(); if (!tableName.trim()) { error = 'Enter a table name.'; return; } edit(draft => draft.tables.push({ id: crypto.randomUUID(), name: tableName.trim(), capacity })); if (!error) tableName = ''; }
  function importGuests() {
    invalidateAsync();
    if (new TextEncoder().encode(importNames).length > 102400) { error = 'Guest import exceeds 100 KiB.'; return; }
    const names = importNames.split(/\r?\n/).map(name => name.trim()).filter(Boolean);
    if (!names.length) { error = 'Enter one guest name per line.'; return; }
    edit(draft => draft.guests.push(...names.map(name => ({ id: crypto.randomUUID(), name })))); if (!error) importNames = '';
  }
  function assigned(guestId: string) { return plan.assignments.find(a => a.guestId === guestId)?.tableId ?? ''; }
  function occupants(tableId: string) { const ids = new Set(plan.assignments.filter(a => a.tableId === tableId).map(a => a.guestId)); return plan.guests.filter(g => ids.has(g.id)); }
  function move(guestId: string, event: Event) { invalidateAsync(); const input = event.currentTarget as HTMLSelectElement; try { plan = assignSeat(plan, guestId, input.value); error = ''; } catch (cause) { error = cause instanceof Error ? cause.message : 'Assignment failed.'; input.value = assigned(guestId); } }
  function remove(id: string, kind: 'guest' | 'table') { invalidateAsync(); const affected = plan.assignments.filter(a => kind === 'guest' ? a.guestId === id : a.tableId === id).length; plan = removeSeatingItem(plan, id, kind); error = ''; notice = `Removed ${kind}; ${affected} related assignments removed.`; }
  function save(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); urls.add(url); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); urls.delete(url); }
  async function exportPlan(csv: boolean) {
    invalidateAsync();
    controller?.abort(); const own = ++generation; const current = new AbortController(); controller = current;
    try {
      const snapshot = validatePlanningSnapshot(plan, 'seating'); const json = JSON.stringify(snapshot, null, 2);
      if (!csv) { save(new Blob([json], { type: 'application/json' }), 'seating-plan.json'); return; }
      const module = injectedTool ?? (await import('../../lib/core-execution')).createDefaultRegistry().toolsById.get(tool.id); if (!module) throw new Error('Tool unavailable.');
      const output = await module.run([new File([json], 'seating-plan.json', { type: 'application/json' })], {}, { signal: current.signal, executionId: crypto.randomUUID(), cache: new Map(), onProgress: () => {} }); const blobs = Array.isArray(output) ? output : [output];
      if (blobs.length !== 1 || blobs[0]!.type !== 'text/csv' || blobs[0]!.size > 1048576) throw new Error('Invalid CSV result.');
      if (!destroyed && own === generation) save(blobs[0]!, 'seating-plan.csv');
    } catch (cause) { if (!destroyed && own === generation) error = cause instanceof Error ? cause.message : 'Export failed.'; }
  }
  async function restore(event: Event) {
    const input = event.currentTarget as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return;
    await restoreSnapshot(file);
  }
  async function restoreSnapshot(file: File, preload = false) {
    invalidateAsync(); const own = generation, ownTool = tool;
    const current = new AbortController(); controller = current;
    if (preload) restoreFile = file;
    try {
      if (file.size > 1048576) throw new Error('Plan exceeds 1 MiB.');
      const bytes = await file.slice(0, 1048577).arrayBuffer();
      if (destroyed || own !== generation || ownTool !== tool || current.signal.aborted || (preload && preloadedFile !== file)) return;
      if (bytes.byteLength > 1048576) throw new Error('Plan exceeds 1 MiB.');
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const parsed = validatePlanningSnapshot(JSON.parse(raw) as unknown, 'seating');
      if (parsed.kind !== 'seating') throw new Error('Expected a seating plan.');
      plan = parsed; error = ''; notice = 'Plan imported.';
      if (preload) report(file, 'admitted');
    } catch (cause) { if (!destroyed && own === generation && ownTool === tool) { error = cause instanceof Error ? cause.message : 'Invalid plan.'; if (preload) report(file, 'refused'); } }
    finally { if (!destroyed && own === generation && ownTool === tool) { restoreFile = null; controller = null; } }
  }
  onDestroy(() => { destroyed = true; generation++; controller?.abort(); for (const url of urls) URL.revokeObjectURL(url); });
</script>

<div class="seating">
  <div class="editor">
    <p>Assign guests to named tables. Duplicate names are allowed; each guest has a separate ID. Your plan stays in this tab until you save it.</p>
    <div class="actions"><label>New guest name <input bind:value={guestName} maxlength="240" on:input={invalidateAsync} /></label><button type="button" on:click={addGuest}>Add guest</button></div>
    <label>Guest names, one per line <textarea bind:value={importNames} rows="4" on:input={invalidateAsync}></textarea></label><button type="button" on:click={importGuests}>Import guest names</button>
    <div class="actions"><label>New table name <input bind:value={tableName} maxlength="240" on:input={invalidateAsync} /></label><label>New table capacity <input type="number" min="1" max="100" step="1" bind:value={capacity} on:input={invalidateAsync} /></label><button type="button" on:click={addTable}>Add table</button></div>
    <h3>Tables</h3>
    {#each plan.tables as table (table.id)}
      <div class="actions"><label>Table name {table.id}<input value={table.name} on:input={invalidateAsync} on:change={event => edit(draft => { draft.tables.find(t => t.id === table.id)!.name = event.currentTarget.value; })} /></label><label>Capacity for {table.name}<input type="number" min="1" max="100" step="1" value={table.capacity} on:input={invalidateAsync} on:change={event => edit(draft => { draft.tables.find(t => t.id === table.id)!.capacity = Number(event.currentTarget.value); })} /></label><span>{table.capacity - occupants(table.id).length} open seats</span><button type="button" on:click={() => remove(table.id, 'table')}>Remove table {table.name} and {occupants(table.id).length} assignments</button></div>
    {/each}
    <h3>Guests</h3>
    {#each plan.guests as guest (guest.id)}
      <div class="actions"><label>Guest name {guest.id}<input value={guest.name} on:input={invalidateAsync} on:change={event => edit(draft => { draft.guests.find(g => g.id === guest.id)!.name = event.currentTarget.value; })} /></label><label>Assign {guest.name} ({guest.id})<select value={assigned(guest.id)} on:change={event => move(guest.id, event)}><option value="">Unassigned</option>{#each plan.tables as table}<option value={table.id}>{table.name} ({table.capacity - occupants(table.id).length} open)</option>{/each}</select></label><button type="button" on:click={() => remove(guest.id, 'guest')}>Remove guest {guest.name}</button></div>
    {/each}
    <div class="actions"><button type="button" on:click={() => exportPlan(true)}>Export seating CSV</button><button type="button" on:click={() => exportPlan(false)}>Save plan JSON</button><label>Import plan JSON<input type="file" accept="application/json,.json" on:change={restore} /></label><button type="button" on:click={() => window.print()}>Print seating chart</button></div>
    <p>CSV text beginning with spreadsheet formulas receives an apostrophe prefix. JSON preserves the original text. Imported plans replace the current plan only after validation.</p>
    {#if error}<p role="alert">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
  </div>
  <section class="chart" aria-label="Seating chart preview"><h3>Seating chart</h3>{#each plan.tables as table}<section><h4>{table.name} — {occupants(table.id).length}/{table.capacity}</h4><ul>{#each occupants(table.id) as guest}<li>{guest.name}</li>{/each}</ul></section>{/each}<h4>Unassigned</h4><ul>{#each plan.guests.filter(g => !assigned(g.id)) as guest}<li>{guest.name}</li>{/each}</ul></section>
</div>
<style>
  .seating, .editor { display: grid; gap: var(--space-3); } .actions { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-2); } label { display: grid; gap: var(--space-1); }
  button, input, select, textarea { font: inherit; color: var(--text-primary); background: var(--bg-raised); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-2); }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
  .chart { border: 1px solid var(--border); padding: var(--space-3); } .chart section { break-inside: avoid; }
  @media print { .editor { display: none; } .chart { border: none; color: black; background: white; } }
</style>
