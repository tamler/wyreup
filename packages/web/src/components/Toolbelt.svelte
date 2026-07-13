<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getAllChains,
    deleteChain,
    renameChain,
    duplicateChain,
    exportChainsJson,
    importChainsJson,
    type ToolbeltChain,
  } from './runners/toolbeltStorage';
  import { encodeChainSteps } from './runners/chainUrl';
  import TriggerRulesSection from './TriggerRulesSection.svelte';

  interface RecentTool {
    id: string;
    name: string;
    ts: number;
  }

  let chains: ToolbeltChain[] = [];
  let recentTools: RecentTool[] = [];
  let loaded = false;

  let renamingId: string | null = null;
  let renameValue = '';

  let importError = '';
  let importSuccess = '';
  let importTimer: ReturnType<typeof setTimeout> | null = null;

  function loadRecentTools(): RecentTool[] {
    try {
      const raw = localStorage.getItem('wyreup:recent-tools');
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const out: RecentTool[] = [];
      for (const item of parsed) {
        if (
          item != null &&
          typeof item === 'object' &&
          typeof (item as RecentTool).id === 'string' &&
          typeof (item as RecentTool).name === 'string' &&
          typeof (item as RecentTool).ts === 'number'
        ) {
          out.push({
            id: (item as RecentTool).id,
            name: (item as RecentTool).name,
            ts: (item as RecentTool).ts,
          });
        }
        if (out.length >= 8) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Relative timestamp for recent tools (e.g. "2h ago"). */
  function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  onMount(() => {
    chains = getAllChains();
    recentTools = loadRecentTools();
    loaded = true;
  });

  function refresh() {
    chains = getAllChains();
  }

  function handleDelete(id: string) {
    deleteChain(id);
    refresh();
  }

  function startRename(chain: ToolbeltChain) {
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

  function chainToUrl(chain: ToolbeltChain, page: 'run' | 'build'): string {
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

  function shareChain(chain: ToolbeltChain) {
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

  $: isFullyEmpty = loaded && chains.length === 0 && recentTools.length === 0;
</script>

<div class="toolbelt">
  {#if !loaded}
    <p class="loading">Loading...</p>
  {:else if isFullyEmpty}
    <div class="empty-state">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18M9 21V9"/>
      </svg>
      <h2 class="empty-msg">Nothing saved yet.</h2>
      <p class="empty-hint">Run any tool and it shows up here. Chain a few actions together and save the chain — it becomes a one-click workflow you can rerun, export, or hand to the CLI.</p>
      <div class="empty-actions">
        <a href="/tools" class="btn-secondary">Browse tools</a>
        <a href="/chain/build" class="btn-secondary">Build a chain</a>
      </div>
    </div>
  {:else}
    {#if recentTools.length > 0}
      <section class="toolbelt-section" aria-labelledby="recent-tools-heading">
        <h2 id="recent-tools-heading" class="section-heading">Recent tools</h2>
        <ul class="recent-list">
          {#each recentTools as tool (tool.id)}
            <li class="recent-row">
              <a href={`/tools/${tool.id}`} class="recent-link">
                <span class="recent-name">{tool.name}</span>
                <span class="recent-time">{relativeTime(tool.ts)}</span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="toolbelt-section" aria-labelledby="saved-chains-heading">
      <h2 id="saved-chains-heading" class="section-heading">Saved chains</h2>
      {#if chains.length === 0}
        <p class="section-empty">No saved chains of actions yet. Build one after you run a few tools.</p>
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
              <div class="step-preview" aria-label="Steps in this chain of actions">
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
    </section>
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

  <hr class="toolbelt__divider" />

  <section class="triggers-section" aria-labelledby="triggers-heading">
    <h2 id="triggers-heading" class="section-heading">Advanced: trigger rules</h2>
    <div class="triggers-section__body">
      <TriggerRulesSection />
    </div>
  </section>
</div>

<style>
  .toolbelt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .toolbelt__divider {
    margin: var(--space-4) 0 0;
    border: 0;
    border-top: 1px solid var(--border);
  }

  .toolbelt-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .section-heading {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .section-empty {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    line-height: 1.5;
  }

  .loading {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-subtle);
  }

  /* Recent tools */
  .recent-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .recent-row {
    border-bottom: 1px solid var(--border-subtle);
  }

  .recent-row:last-child { border-bottom: none; }

  .recent-link {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--bg-elevated);
    text-decoration: none;
    transition: background var(--duration-fast) var(--ease-sharp);
  }

  .recent-link:hover { background: var(--bg-raised); }
  .recent-link:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: -2px; }

  .recent-name {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
  }

  .recent-time {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    flex-shrink: 0;
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
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-muted);
  }

  .empty-hint {
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-subtle);
    line-height: 1.6;
    max-width: 36rem;
  }

  .empty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

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
    text-decoration: none;
    display: inline-flex;
    align-items: center;
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

  /* Advanced trigger rules — retitle; hide nested component title */
  .triggers-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .triggers-section__body :global(.rules__title) {
    display: none;
  }
</style>
