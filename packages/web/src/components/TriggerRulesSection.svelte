<script lang="ts">
  // Trigger rules management UI — slots into /my-kit alongside saved chains.
  //
  // Every "edit" path here goes through coreUpdate (updateRule()), which
  // enforces G2: any meaningful field change re-arms confirmed=false. The
  // user can toggle confirmed manually but cannot edit a rule without
  // resetting the prompt.

  import { onMount } from 'svelte';
  import {
    getAllRules,
    updateRule,
    upsertRule,
    deleteRule,
    reorderRule,
    nextOrder,
  } from './runners/triggerStorage';
  import { getAllChains, type KitChain } from './runners/kitStorage';
  import type { TriggerRule } from '@wyreup/core';
  import { DEFAULT_RATE_LIMIT } from '@wyreup/core';

  let rules: TriggerRule[] = [];
  let chains: KitChain[] = [];
  let loaded = false;

  // Edit form state
  let editingId: string | null = null;
  let editName = '';
  let editMime = '';
  let editChainId = '';

  // Create form state
  let showCreate = false;
  let newName = '';
  let newMime = 'application/pdf';
  let newChainId = '';

  function refresh() {
    rules = getAllRules().sort((a, b) => a.order - b.order);
    chains = getAllChains();
  }

  onMount(() => {
    refresh();
    loaded = true;
    const handler = () => refresh();
    window.addEventListener('wyreup:trigger-rules-changed', handler);
    window.addEventListener('wyreup:chains-changed', handler);
    return () => {
      window.removeEventListener('wyreup:trigger-rules-changed', handler);
      window.removeEventListener('wyreup:chains-changed', handler);
    };
  });

  function chainName(id: string): string {
    const c = chains.find((x) => x.id === id);
    return c?.name ?? '[deleted chain]';
  }

  function chainExists(id: string): boolean {
    return chains.some((x) => x.id === id);
  }

  function startEdit(r: TriggerRule) {
    editingId = r.id;
    editName = r.name;
    editMime = r.mime;
    editChainId = r.chainId;
  }

  function cancelEdit() {
    editingId = null;
  }

  function commitEdit() {
    if (!editingId) return;
    const patch: Partial<TriggerRule> = {};
    const original = rules.find((r) => r.id === editingId);
    if (!original) return;
    if (editName.trim() && editName !== original.name) patch.name = editName.trim();
    if (editMime.trim() && editMime !== original.mime) patch.mime = editMime.trim();
    if (editChainId && editChainId !== original.chainId) patch.chainId = editChainId;
    if (Object.keys(patch).length > 0) updateRule(editingId, patch);
    editingId = null;
    refresh();
  }

  function toggleEnabled(r: TriggerRule) {
    updateRule(r.id, { enabled: !r.enabled });
    refresh();
  }

  function toggleConfirmed(r: TriggerRule) {
    // Toggle confirmed in isolation — G2 lets this be the one allowed
    // "no other change" path through updateTriggerRule.
    updateRule(r.id, { confirmed: !r.confirmed });
    refresh();
  }

  function move(r: TriggerRule, dir: 'up' | 'down') {
    reorderRule(r.id, dir);
    refresh();
  }

  function handleDelete(r: TriggerRule) {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    deleteRule(r.id);
    refresh();
  }

  function createRule() {
    const name = newName.trim();
    const mime = newMime.trim();
    if (!name || !mime || !newChainId) return;
    const now = Date.now();
    upsertRule({
      id: crypto.randomUUID(),
      name,
      mime,
      chainId: newChainId,
      order: nextOrder(),
      confirmed: false,
      enabled: true,
      rateLimit: { ...DEFAULT_RATE_LIMIT },
      createdAt: now,
      updatedAt: now,
    });
    newName = '';
    newChainId = '';
    showCreate = false;
    refresh();
  }
</script>

<section class="rules" aria-label="Trigger rules">
  <header class="rules__header">
    <div>
      <h2 class="rules__title">Trigger rules</h2>
      <p class="rules__sub">
        When a matching file arrives, Wyreup proposes its chain.
        <a href="/triggers">Preview-before-run is always on.</a>
      </p>
    </div>
    {#if !showCreate}
      <button type="button" class="btn btn-primary" on:click={() => (showCreate = true)}>
        New rule
      </button>
    {/if}
  </header>

  {#if showCreate}
    <div class="rules__form" role="region" aria-label="Create rule">
      <label class="field">
        <span class="field__label">Name</span>
        <input type="text" bind:value={newName} placeholder="e.g. Clean PDFs" />
      </label>
      <label class="field">
        <span class="field__label">MIME pattern</span>
        <input type="text" bind:value={newMime} placeholder="application/pdf or image/*" />
        <span class="field__hint">
          Exact ("application/pdf") or wildcard ("image/*"). Bare "*" is rejected.
        </span>
      </label>
      <label class="field">
        <span class="field__label">Chain</span>
        <select bind:value={newChainId}>
          <option value="" disabled selected>— select a saved chain —</option>
          {#each chains as c (c.id)}
            <option value={c.id}>{c.name}</option>
          {/each}
        </select>
        {#if chains.length === 0}
          <span class="field__hint">No saved chains yet. <a href="/chain/build">Build one →</a></span>
        {/if}
      </label>
      <div class="form__actions">
        <button type="button" class="btn btn-primary" on:click={createRule} disabled={!newName || !newMime || !newChainId}>
          Create
        </button>
        <button type="button" class="btn btn-secondary" on:click={() => (showCreate = false)}>
          Cancel
        </button>
      </div>
    </div>
  {/if}

  {#if loaded && rules.length === 0 && !showCreate}
    <div class="rules__empty">
      <p>No trigger rules yet.</p>
      <p class="rules__empty-sub">A rule maps a file type to a saved chain. When a matching file arrives, Wyreup proposes to run the chain — never silently.</p>
    </div>
  {/if}

  <ol class="rules__list">
    {#each rules as r, i (r.id)}
      <li class="rule" class:rule--disabled={!r.enabled}>
        {#if editingId === r.id}
          <div class="rule__edit">
            <input type="text" bind:value={editName} placeholder="Name" />
            <input type="text" bind:value={editMime} placeholder="MIME" />
            <select bind:value={editChainId}>
              {#each chains as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
            <div class="rule__edit-actions">
              <button type="button" class="btn btn-primary" on:click={commitEdit}>Save</button>
              <button type="button" class="btn btn-secondary" on:click={cancelEdit}>Cancel</button>
            </div>
            <p class="rule__edit-hint">
              Editing any field will re-arm the preview prompt for this rule.
            </p>
          </div>
        {:else}
          <div class="rule__main">
            <div class="rule__head">
              <span class="rule__name">{r.name}</span>
              <div class="rule__badges">
                {#if !r.enabled}
                  <span class="badge badge--off">disabled</span>
                {/if}
                {#if r.confirmed}
                  <span class="badge badge--confirmed">no prompt</span>
                {:else}
                  <span class="badge badge--prompt">previews on</span>
                {/if}
                {#if !chainExists(r.chainId)}
                  <span class="badge badge--error">orphaned</span>
                {/if}
              </div>
            </div>
            <div class="rule__meta">
              <code>{r.mime}</code>
              <span class="rule__arrow">→</span>
              <span class="rule__chain">{chainName(r.chainId)}</span>
            </div>
          </div>
          <div class="rule__actions">
            <button type="button" class="btn btn-quiet" on:click={() => move(r, 'up')} disabled={i === 0} aria-label="Move up">↑</button>
            <button type="button" class="btn btn-quiet" on:click={() => move(r, 'down')} disabled={i === rules.length - 1} aria-label="Move down">↓</button>
            <button type="button" class="btn btn-quiet" on:click={() => toggleEnabled(r)}>
              {r.enabled ? 'Disable' : 'Enable'}
            </button>
            <button type="button" class="btn btn-quiet" on:click={() => toggleConfirmed(r)}>
              {r.confirmed ? 'Re-arm prompt' : 'Trust this rule'}
            </button>
            <button type="button" class="btn btn-quiet" on:click={() => startEdit(r)}>Edit</button>
            <button type="button" class="btn btn-quiet btn-danger" on:click={() => handleDelete(r)}>Delete</button>
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</section>

<style>
  .rules { display: flex; flex-direction: column; gap: var(--space-3); }
  .rules__header { display: flex; align-items: start; justify-content: space-between; gap: var(--space-3); }
  .rules__title { margin: 0; font-size: var(--text-lg); }
  .rules__sub { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--text-subtle); }
  .rules__sub a { color: var(--accent-text); }

  .rules__form {
    display: flex; flex-direction: column; gap: var(--space-3);
    padding: var(--space-3); background: var(--bg-raised); border-radius: var(--radius-md);
  }
  .field { display: flex; flex-direction: column; gap: var(--space-1); }
  .field__label { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); text-transform: uppercase; letter-spacing: 0.08em; }
  .field__hint { font-size: var(--text-xs); color: var(--text-subtle); }
  .field input, .field select { height: 32px; padding: 0 var(--space-2); background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--text-sm); }

  .rules__empty { padding: var(--space-4); background: var(--bg-raised); border-radius: var(--radius-md); color: var(--text-subtle); font-size: var(--text-sm); }
  .rules__empty-sub { margin: var(--space-1) 0 0; font-size: var(--text-xs); }

  .rules__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .rule { display: flex; gap: var(--space-3); padding: var(--space-3); background: var(--bg-raised); border-radius: var(--radius-md); align-items: center; }
  .rule--disabled { opacity: 0.6; }
  .rule__main { flex: 1; display: flex; flex-direction: column; gap: var(--space-1); }
  .rule__head { display: flex; align-items: baseline; gap: var(--space-2); flex-wrap: wrap; }
  .rule__name { font-weight: 500; color: var(--text-primary); }
  .rule__badges { display: inline-flex; gap: var(--space-1); }
  .badge { font-family: var(--font-mono); font-size: 10px; padding: 1px 6px; border-radius: var(--radius-sm); text-transform: uppercase; letter-spacing: 0.08em; }
  .badge--off { background: var(--bg-elevated); color: var(--text-subtle); }
  .badge--confirmed { background: color-mix(in srgb, var(--accent) 20%, transparent); color: var(--accent-text); }
  .badge--prompt { background: color-mix(in srgb, #2a5 20%, transparent); color: #2a5; }
  .badge--error { background: color-mix(in srgb, var(--danger, #d22) 20%, transparent); color: var(--danger, #d22); }
  .rule__meta { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-subtle); }
  .rule__meta code { font-family: var(--font-mono); color: var(--accent-text); }
  .rule__chain { color: var(--text-primary); }
  .rule__arrow { color: var(--text-subtle); }
  .rule__actions { display: flex; gap: var(--space-1); flex-wrap: wrap; align-items: center; }
  .rule__edit { display: flex; flex-direction: column; gap: var(--space-2); flex: 1; }
  .rule__edit input, .rule__edit select { height: 32px; padding: 0 var(--space-2); background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--text-sm); }
  .rule__edit-actions { display: flex; gap: var(--space-2); }
  .rule__edit-hint { margin: 0; font-size: var(--text-xs); color: var(--text-subtle); }

  .form__actions { display: flex; gap: var(--space-2); }
  .btn { height: 28px; padding: 0 var(--space-3); border-radius: var(--radius-md); font-family: var(--font-mono); font-size: var(--text-sm); cursor: pointer; border: 1px solid transparent; }
  .btn-primary { background: var(--accent); color: var(--black); border-color: var(--accent); font-weight: 500; }
  .btn-secondary { background: var(--bg-elevated); color: var(--text-primary); border-color: var(--border); }
  .btn-quiet { background: transparent; color: var(--text-subtle); border-color: var(--border); }
  .btn-danger { color: var(--danger, #d22); }
  .btn[disabled] { opacity: 0.4; cursor: not-allowed; }
  .btn:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }
</style>
