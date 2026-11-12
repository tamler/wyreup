<script lang="ts">
  import { onMount } from 'svelte';
  import { deleteShareLink, listShareLinks, type ShareSummary } from '../lib/shareLinks';
  import { displayName } from '../data/display-names';

  let shares: ShareSummary[] = [];
  let loading = true;
  let error = '';
  let busyId = '';

  async function load() {
    loading = true;
    error = '';
    try {
      shares = await listShareLinks();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not load links.';
    } finally {
      loading = false;
    }
  }

  async function remove(id: string) {
    busyId = id;
    error = '';
    try {
      await deleteShareLink(id);
      shares = shares.filter((s) => s.id !== id);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not delete the link.';
    } finally {
      busyId = '';
    }
  }

  const when = (ms: number) =>
    new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  onMount(load);
</script>

<h3>Share links</h3>
<p class="muted about">
  Only active links appear here. Deleting a link stops it working right away, but copies people made cannot be
  taken back. Expired links are deleted from Wyreup's database and are not listed.
  <a href="/legal/privacy#share-links">Details</a>
</p>
{#if loading}
  <p class="muted">Loading…</p>
{:else if shares.length === 0}
  <p class="muted">No active links. For an eligible PRO text result, select "Create a share link" below the result.</p>
{:else}
  <ul class="links">
    {#each shares as s (s.id)}
      <li class="link-row">
        <span class="link-tool">{displayName(s.toolId)}</span>
        <a class="link-url" href={s.url} target="_blank" rel="noopener noreferrer">{s.preview || s.url}</a>
        <span class="link-exp">Expires {when(s.expiresAt)}</span>
        <button class="link-del" type="button" on:click={() => remove(s.id)} disabled={busyId === s.id}>
          {busyId === s.id ? 'Deleting…' : 'Delete'}
        </button>
      </li>
    {/each}
  </ul>
{/if}
{#if error}<p class="link-error" role="alert">{error}</p>{/if}

<style>
  h3 { margin: 0 0 var(--space-3); }
  .muted { color: var(--text-muted); margin: 0; }
  .about { margin-bottom: var(--space-3); font-size: var(--text-sm); }
  .about a { color: var(--accent-text); }
  .links { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
  .link-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    font-size: var(--text-sm);
  }
  .link-tool { font-weight: 600; color: var(--text-primary); }
  .link-url {
    flex: 1 1 12rem;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--accent-text);
  }
  .link-exp { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }
  .link-del {
    height: 28px;
    padding: 0 var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .link-del:disabled { opacity: 0.6; cursor: default; }
  .link-del:focus-visible, .link-url:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }
  .link-error { margin: var(--space-2) 0 0; font-size: var(--text-xs); color: var(--danger-text); }
</style>
