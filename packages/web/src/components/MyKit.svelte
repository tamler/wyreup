<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getAllChains,
    deleteChain,
    renameChain,
    duplicateChain,
    exportChainsJson,
    importChainsJson,
    type KitChain,
  } from './runners/kitStorage';
  import { encodeChainSteps } from './runners/chainUrl';
  import TriggerRulesSection from './TriggerRulesSection.svelte';

  let chains: KitChain[] = [];
  let loaded = false;

  let renamingId: string | null = null;
  let renameValue = '';

  let importError = '';
  let importSuccess = '';
  let importTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    chains = getAllChains();
    loaded = true;
  });

  function refresh() {
    chains = getAllChains();
  }

  function handleDelete(id: string) {
    deleteChain(id);
    refresh();
  }

  function startRename(chain: KitChain) {
    renamingId = chain.id;
    renameValue = chain.name;
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) {
      renameChain(renamingId, renameValue.trim());
      refresh();
    }
    renamingId = null;
  }

  function handleDuplicate(id: string) {
    duplicateChain(id);
    refresh();
  }

  function chainToUrl(chain: KitChain, page: 'run' | 'build'): string {
    const encoded = encodeChainSteps(chain.steps);
    return `/${page === 'run' ? 'chain/run' : 'chain/build'}?steps=${encoded}`;
  }

  function handleExport() {
    const json = exportChainsJson();
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wyreup-kit-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportClick() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const result = importChainsJson(text);
        importError = result.errors.length > 0 ? result.errors.join(' ') : '';
        importSuccess = result.errors.length === 0
          ? `Imported: ${result.added} added, ${result.updated} updated.`
          : `Partial import: ${result.added} added, ${result.updated} updated. ${result.errors.join(' ')}`;
        if (importTimer) clearTimeout(importTimer);
        importTimer = setTimeout(() => { importSuccess = ''; importError = ''; }, 4000);
        refresh();
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function shareChain(chain: KitChain) {
    const url = `${window.location.origin}${chainToUrl(chain, 'run')}`;
    navigator.clipboard.writeText(url).catch(() => {});
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return iso;
    }
  }
</script>

<div class="my-kit">
  {#if !loaded}
    <p class="loading">Loading...</p>
  {:else if chains.length === 0}
    <div class="empty-state">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18M9 21V9"/>
      </svg>
      <p class="empty-msg">No saved chains yet.</p>
      <p class="empty-hint">Build one at <a href="/chain/build" class="kit-link">/chain/build</a> or save a chain after running it.</p>
    </div>
  {:else}
    <div class="chains-list">
      {#each chains as chain (chain.id)}
        <div class="chain-row">
          <div class="chain-row__info">
            {#if renamingId === chain.id}
              <input
                class="rename-input"
                type="text"
                bind:value={renameValue}
                on:keydown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') renamingId = null;
                }}
                on:blur={commitRename}
              />
            {:else}
              <span class="chain-name">{chain.name}</span>
            {/if}
            <span class="chain-date">{formatDate(chain.updatedAt)}</span>
          </div>

          <!-- Step preview -->
          <div class="step-preview" aria-label="Chain steps">
            {#each chain.steps as step, idx}
              <span class="preview-chip">{step.toolId}</span>
              {#if idx < chain.steps.length - 1}
                <span class="preview-pipe" aria-hidden="true">→</span>
              {/if}
            {/each}
          </div>

          <!-- Actions -->
          <div class="chain-row__actions">
            <a href={chainToUrl(chain, 'run')} class="btn-action">Run</a>
            <a href={chainToUrl(chain, 'build')} class="btn-action">Edit</a>
            <button class="btn-action" type="button" on:click={() => startRename(chain)}>Rename</button>
            <button class="btn-action" type="button" on:click={() => handleDuplicate(chain.id)}>Duplicate</button>
            <button class="btn-action btn-action--danger" type="button" on:click={() => handleDelete(chain.id)}>Delete</button>
            <button class="btn-action" type="button" on:click={() => shareChain(chain)}>Share</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Utility row -->
  <div class="utility-row">
    <button class="btn-secondary" type="button" on:click={handleExport} disabled={chains.length === 0}>
      Export all (JSON)
    </button>
    <button class="btn-secondary" type="button" on:click={handleImportClick}>
      Import (JSON)
    </button>
    {#if importSuccess}
      <span class="import-success" aria-live="polite">{importSuccess}</span>
    {/if}
    {#if importError}
      <span class="import-error" aria-live="polite">{importError}</span>
    {/if}
  </div>

  <hr class="my-kit__divider" />

  <TriggerRulesSection />
</div>

<style>
  .my-kit {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .my-kit__divider {
    margin: var(--space-4) 0 0;
    border: 0;
    border-top: 1px solid var(--border);
  }

  .loading {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-subtle);
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-8) 0;
  }

  .empty-icon {
    color: var(--text-subtle);
    margin-bottom: var(--space-2);
  }

  .empty-msg {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .empty-hint {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    line-height: 1.6;
  }

  .kit-link {
    color: var(--accent-text);
    text-decoration: none;
    font-family: var(--font-mono);
  }

  .kit-link:hover { text-decoration: underline; }

  /* Chains list */
  .chains-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .chain-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border-subtle);
    transition: background var(--duration-fast) var(--ease-sharp);
  }

  .chain-row:last-child { border-bottom: none; }
  .chain-row:hover { background: var(--bg-raised); }

  .chain-row__info {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .chain-name {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
  }

  .chain-date {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .rename-input {
    height: 28px;
    padding: 0 var(--space-2);
    background: var(--bg-raised);
    border: 1px solid var(--accent-hover);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 500;
    min-width: 200px;
  }

  .rename-input:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  /* Step preview */
  .step-preview {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .preview-chip {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 1px var(--space-2);
  }

  .preview-pipe {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  /* Actions */
  .chain-row__actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    align-items: center;
  }

  .btn-action {
    height: 26px;
    padding: 0 var(--space-2);
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    transition:
      color var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp),
      background var(--duration-instant) var(--ease-sharp);
  }

  .btn-action:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
    background: var(--bg-raised);
  }

  .btn-action:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }
  .btn-action--danger:hover { color: var(--danger); border-color: var(--danger); background: rgba(239, 68, 68, 0.08); }

  /* Utility row */
  .utility-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
  }

  .btn-secondary {
    height: 32px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp);
  }

  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-secondary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .import-success {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--success);
  }

  .import-error {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--danger);
  }
</style>
