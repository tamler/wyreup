<script lang="ts">
  // AccountMenu — the header-right widget. Two states:
  //   signed-out → "Get PRO" button → dispatches wyreup:auth-open
  //   signed-in  → ⚡ balance badge + dropdown with email, /account, sign out
  //
  // Mount once globally in BaseLayout; it hydrates on load.

  import { onMount } from 'svelte';
  import { user, authReady, hydrateUser, signOut } from '../stores/user';
  import CreditBadge from './CreditBadge.svelte';

  let menuOpen = false;
  let rootEl: HTMLDivElement | null = null;

  function openAuth() {
    window.dispatchEvent(new Event('wyreup:auth-open'));
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  async function doSignOut() {
    await signOut();
    closeMenu();
  }

  function onDocClick(e: MouseEvent) {
    if (rootEl && !rootEl.contains(e.target as Node)) closeMenu();
  }

  onMount(() => {
    hydrateUser();
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  });
</script>

<div class="root" bind:this={rootEl}>
  {#if !$authReady}
    <!-- Reserve space; avoid header-shift between SSR and hydrate -->
    <span class="placeholder" aria-hidden="true" />
  {:else if $user}
    <button
      type="button"
      class="trigger"
      on:click={toggleMenu}
      aria-haspopup="true"
      aria-expanded={menuOpen}
      title={$user.email}
    >
      <CreditBadge balance={$user.balance} />
      <span class="caret" aria-hidden="true">▾</span>
    </button>
    {#if menuOpen}
      <div class="dropdown" role="menu">
        <div class="email">{$user.email}</div>
        <a href="/account" class="item" role="menuitem">Account</a>
        <button type="button" class="item" role="menuitem" on:click={doSignOut}>Sign out</button>
      </div>
    {/if}
  {:else}
    <button type="button" class="get-pro" on:click={openAuth}>Get PRO</button>
  {/if}
</div>

<style>
  .root {
    position: relative;
    display: flex;
    align-items: center;
  }

  .placeholder {
    display: inline-block;
    width: 64px;
    height: 22px;
  }

  .get-pro {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    cursor: pointer;
    transition: border-color var(--duration-instant) var(--ease-sharp);
    line-height: 1;
    height: 26px;
  }
  .get-pro:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
  .trigger:hover {
    color: var(--text-primary);
  }
  .caret {
    font-size: 10px;
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 180px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-1) 0;
    z-index: 60;
  }

  .email {
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    border-bottom: 1px solid var(--border-subtle);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-decoration: none;
    cursor: pointer;
  }
  .item:hover {
    color: var(--text-primary);
    background: var(--bg-raised);
  }
</style>
