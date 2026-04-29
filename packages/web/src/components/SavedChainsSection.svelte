<script lang="ts">
  import { onMount } from 'svelte';
  import { getAllChains, deleteChain, type KitChain } from './runners/kitStorage';
  import { encodeChainSteps } from './runners/chainUrl';

  // Surfaces a user's saved chains (from localStorage) at the top of
  // /tools so they're discoverable alongside built-in tools. The card
  // routes to /chain/run?steps=<encoded>; the existing ChainRunner handles
  // file drop + auto-run consent.

  let chains: KitChain[] = [];
  let menuOpenId: string | null = null;
  let copiedId: string | null = null;

  onMount(() => {
    refresh();
    // localStorage doesn't fire 'storage' for same-tab writes, so listen
    // for a custom event when ChainBuilder/ChainRunner saves.
    const handler = () => refresh();
    window.addEventListener('wyreup:chains-changed', handler);
    return () => window.removeEventListener('wyreup:chains-changed', handler);
  });

  function refresh() {
    chains = getAllChains().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function chainHref(chain: KitChain): string {
    const encoded = encodeChainSteps(chain.steps);
    return `/chain/run?steps=${encodeURIComponent(encoded)}`;
  }

  function fmtSteps(chain: KitChain): string {
    return chain.steps.map((s) => s.toolId).join(' → ');
  }

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function toggleMenu(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    menuOpenId = menuOpenId === id ? null : id;
  }

  function closeMenu() {
    menuOpenId = null;
  }

  function handleDelete(e: MouseEvent, chain: KitChain) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete chain "${chain.name}"? This can't be undone.`)) return;
    deleteChain(chain.id);
    menuOpenId = null;
    // Refresh happens via the wyreup:chains-changed event dispatched by
    // kitStorage's saveAll; no manual call needed here.
  }

  function shareUrl(chain: KitChain): string {
    const encoded = encodeChainSteps(chain.steps);
    const params = new URLSearchParams();
    params.set('steps', encoded);
    params.set('name', chain.name);
    return `${window.location.origin}/chain/run?${params.toString()}`;
  }

  async function handleCopyShare(e: MouseEvent, chain: KitChain) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(shareUrl(chain));
      copiedId = chain.id;
      setTimeout(() => { if (copiedId === chain.id) copiedId = null; }, 1500);
    } catch {
      // Fallback: show a prompt with the URL the user can copy manually
      window.prompt('Copy this link', shareUrl(chain));
    }
    menuOpenId = null;
  }
</script>

<svelte:window on:click={closeMenu} />

{#if chains.length > 0}
  <section class="saved-chains" aria-labelledby="saved-chains-heading">
    <header class="saved-chains__header">
      <h2 id="saved-chains-heading" class="saved-chains__title">Your chains</h2>
      <a href="/chain/build" class="saved-chains__add">+ New chain</a>
    </header>

    <div class="chain-grid" role="list">
      {#each chains as chain (chain.id)}
        <a href={chainHref(chain)} class="chain-card brackets" role="listitem" aria-label="Chain: {chain.name}">
          <div class="brackets-inner" aria-hidden="true"></div>
          <div class="chain-card__inner">
            <div class="chain-card__header">
              <span class="chain-card__icon" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
              </span>
              <div class="chain-card__head-text">
                <div class="chain-card__name">{chain.name}</div>
                <div class="chain-card__meta">{chain.steps.length} step{chain.steps.length === 1 ? '' : 's'} · saved {fmtDate(chain.updatedAt)}</div>
              </div>
              <div class="chain-card__badges">
                <span class="badge badge--chain" title="Saved chain">Chain</span>
              </div>
              <button
                class="chain-card__menu-btn"
                aria-label="Chain options"
                aria-expanded={menuOpenId === chain.id}
                on:click={(e) => toggleMenu(e, chain.id)}
                type="button"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="5" r="1"/>
                  <circle cx="12" cy="12" r="1"/>
                  <circle cx="12" cy="19" r="1"/>
                </svg>
              </button>
              {#if menuOpenId === chain.id}
                <div class="chain-card__menu" role="menu" on:click|stopPropagation>
                  <a href="/chain/build?steps={encodeURIComponent(encodeChainSteps(chain.steps))}" class="chain-card__menu-item" role="menuitem">Edit</a>
                  <button class="chain-card__menu-item" on:click={(e) => handleCopyShare(e, chain)} type="button" role="menuitem">
                    {copiedId === chain.id ? 'Link copied' : 'Copy share link'}
                  </button>
                  <button class="chain-card__menu-item chain-card__menu-item--danger" on:click={(e) => handleDelete(e, chain)} type="button" role="menuitem">Delete</button>
                </div>
              {/if}
            </div>
            <div class="chain-card__divider" aria-hidden="true"></div>
            <p class="chain-card__steps">{fmtSteps(chain)}</p>
          </div>
        </a>
      {/each}
    </div>
  </section>
{/if}

<style>
  .saved-chains {
    margin-bottom: var(--space-8);
  }

  .saved-chains__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .saved-chains__title {
    font-family: var(--font-sans);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .saved-chains__add {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--accent);
    text-decoration: none;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .saved-chains__add:hover {
    color: var(--accent-hover);
  }

  .chain-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-3);
  }

  .chain-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
    text-decoration: none;
    color: inherit;
    transition: transform var(--duration-instant) var(--ease-sharp), border-color var(--duration-instant) var(--ease-sharp);
  }

  .chain-card:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }

  .chain-card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .chain-card__inner {
    background: var(--bg-raised);
    border: 1px solid var(--border-subtle);
    border-radius: calc(var(--radius-md) - 1px);
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
  }

  .chain-card__header {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: var(--space-2);
    align-items: center;
  }

  .chain-card__icon {
    color: var(--accent);
    display: inline-flex;
  }

  .chain-card__head-text {
    min-width: 0;
  }

  .chain-card__name {
    font-family: var(--font-sans);
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chain-card__meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    margin-top: 2px;
  }

  .chain-card__badges {
    display: inline-flex;
    gap: var(--space-1);
  }

  .badge {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    line-height: 1;
  }

  .badge--chain {
    color: var(--accent);
    border: 1px solid var(--accent);
    background: var(--accent-dim, transparent);
  }

  .chain-card__menu-btn {
    background: none;
    border: none;
    color: var(--text-subtle);
    cursor: pointer;
    padding: var(--space-1);
    display: inline-flex;
    align-items: center;
    border-radius: var(--radius-sm);
    transition: color var(--duration-instant) var(--ease-sharp), background var(--duration-instant) var(--ease-sharp);
  }

  .chain-card__menu-btn:hover {
    color: var(--text-primary);
    background: var(--bg-elevated);
  }

  .chain-card__menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-width: 120px;
    padding: var(--space-1);
  }

  .chain-card__menu-item {
    background: none;
    border: none;
    color: var(--text-primary);
    text-decoration: none;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    text-align: left;
    padding: var(--space-2) var(--space-3);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .chain-card__menu-item:hover {
    background: var(--bg-elevated);
  }

  .chain-card__menu-item--danger {
    color: var(--danger);
  }

  .chain-card__divider {
    height: 1px;
    background: var(--border-subtle);
  }

  .chain-card__steps {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }

  .brackets::before, .brackets::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }
  .brackets::before { top: -5px; left: -5px; border-top: 1px solid var(--accent); border-left: 1px solid var(--accent); }
  .brackets::after { bottom: -5px; right: -5px; border-bottom: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner { position: absolute; inset: 0; pointer-events: none; }
  .brackets-inner::before, .brackets-inner::after { content: ''; position: absolute; width: 8px; height: 8px; pointer-events: none; }
  .brackets-inner::before { top: -5px; right: -5px; border-top: 1px solid var(--accent); border-right: 1px solid var(--accent); }
  .brackets-inner::after { bottom: -5px; left: -5px; border-bottom: 1px solid var(--accent); border-left: 1px solid var(--accent); }
</style>
