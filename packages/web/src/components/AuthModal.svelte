<script lang="ts">
  // AuthModal — the global "enter your API key" surface. Two screens:
  //   - "activate": paste a key, hit Activate, server returns { email, balance }
  //   - "create": enter an email, then activate the key delivered to that inbox
  //
  // Mounted in BaseLayout via <AuthModal client:load /> so any component can
  // trigger it by dispatching `window.dispatchEvent(new Event('wyreup:auth-open'))`.

  import { onMount } from 'svelte';
  import { activate } from '../stores/user';

  type Screen = 'closed' | 'activate' | 'create';

  let screen: Screen = 'closed';
  let keyInput = '';
  let emailInput = '';
  let busy = false;
  let error = '';
  let emailSent = false;
  let dialogEl: HTMLDivElement | null = null;
  let firstFocusEl: HTMLInputElement | null = null;
  let previouslyFocused: HTMLElement | null = null;
  let operationGeneration = 0;

  function open() {
    // Default to sign-up — the common case for someone hitting a PRO
    // tool without an account. Returning key-holders use the activate link.
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    operationGeneration++;
    busy = false;
    screen = 'create';
    error = '';
    keyInput = '';
    emailInput = '';
    setTimeout(() => firstFocusEl?.focus(), 30);
  }

  function close() {
    const restoreFocusTo = previouslyFocused;
    operationGeneration++;
    busy = false;
    screen = 'closed';
    error = '';
    keyInput = '';
    emailInput = '';
    emailSent = false;
    previouslyFocused = null;
    setTimeout(() => restoreFocusTo?.focus(), 0);
  }

  function gotoCreate() {
    operationGeneration++;
    busy = false;
    screen = 'create';
    error = '';
    setTimeout(() => firstFocusEl?.focus(), 30);
  }

  function gotoActivate() {
    operationGeneration++;
    busy = false;
    screen = 'activate';
    error = '';
    setTimeout(() => firstFocusEl?.focus(), 30);
  }

  async function onActivate() {
    error = '';
    busy = true;
    const generation = ++operationGeneration;
    try {
      const res = await activate(keyInput.trim());
      if (generation !== operationGeneration) return;
      if (res.ok) {
        close();
      } else {
        error = res.error;
      }
    } catch {
      if (generation === operationGeneration) {
        error = 'Could not reach Wyreup. Check your connection and try again.';
      }
    } finally {
      if (generation === operationGeneration) busy = false;
    }
  }

  async function onCreate() {
    error = '';
    busy = true;
    const generation = ++operationGeneration;
    try {
      const res = await fetch('/api/account/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput.trim(), surface: 'browser' }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
      };
      if (generation !== operationGeneration) return;
      if (!res.ok) {
        error = data.error || `Couldn't create account (${res.status})`;
        return;
      }
      if (data.status !== 'check_email') {
        error = 'Unexpected response. Please try requesting your key again.';
        return;
      }
      emailSent = true;
      screen = 'activate';
      setTimeout(() => firstFocusEl?.focus(), 30);
    } catch {
      if (generation === operationGeneration) {
        error = 'Could not reach Wyreup. Check your connection and try again.';
      }
    } finally {
      if (generation === operationGeneration) busy = false;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (screen === 'closed') return;
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key !== 'Tab' || !dialogEl) return;

    const focusable = Array.from(
      dialogEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
      ),
    ).filter((element) => element.tabIndex !== -1);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialogEl.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialogEl.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  function onOpenEvent() {
    if (screen === 'closed') open();
  }

  onMount(() => {
    window.addEventListener('wyreup:auth-open', onOpenEvent);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('wyreup:auth-open', onOpenEvent);
      document.removeEventListener('keydown', onKeyDown);
    };
  });
</script>

{#if screen !== 'closed'}
  <div
    class="overlay"
    on:click={(e) => {
      if (e.target === e.currentTarget) close();
    }}
    role="presentation"
  >
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      bind:this={dialogEl}
    >
      <button type="button" class="close" aria-label="Close" on:click={close}>×</button>

      {#if screen === 'activate'}
        <h2 id="auth-modal-title">{emailSent ? 'Check your inbox' : 'Enter your key'}</h2>
        <p class="hint">Paste the <code>wk_live_…</code> key from your email to unlock PRO tools.</p>

        <form on:submit|preventDefault={onActivate}>
          <input
            bind:this={firstFocusEl}
            class="key-input"
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder="wk_live_…"
            bind:value={keyInput}
            disabled={busy}
          />
          {#if error}
            <p class="error" role="alert">{error}</p>
          {/if}
          <div class="row">
            <button type="submit" class="primary" disabled={busy || !keyInput.trim()}>
              {busy ? 'Activating…' : 'Activate'}
            </button>
            <button type="button" class="link" on:click={gotoCreate}>Need a new key? Email one →</button>
          </div>
        </form>
      {:else if screen === 'create'}
        <h2 id="auth-modal-title">Get your key</h2>
        <p class="hint">We'll email it to you. Free tools stay free — you only need this for PRO.</p>
        <p class="hint">Packs from $5 — credits never expire. <a href="/pro">See pricing</a></p>

        <form on:submit|preventDefault={onCreate}>
          <input
            bind:this={firstFocusEl}
            class="key-input"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            bind:value={emailInput}
            disabled={busy}
          />
          {#if error}
            <p class="error" role="alert">{error}</p>
          {/if}
          <div class="row">
            <button type="submit" class="primary" disabled={busy || !emailInput.trim()}>
              {busy ? 'Sending…' : 'Email me a key'}
            </button>
            <button type="button" class="link" on:click={gotoActivate}>Already have one? Activate →</button>
          </div>
        </form>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: var(--space-4);
  }

  .dialog {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: 440px;
    padding: var(--space-6);
    position: relative;
  }

  .close {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    background: none;
    border: none;
    font-size: 24px;
    line-height: 1;
    color: var(--text-muted);
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
  }
  .close:hover {
    color: var(--text-primary);
  }

  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .hint {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .key-input {
    width: 100%;
    height: 40px;
    padding: 0 var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .key-input:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 1px;
  }

  .error {
    color: var(--accent-text);
    font-size: var(--text-sm);
    margin: var(--space-2) 0 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-4);
    flex-wrap: wrap;
  }

  .primary {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background var(--duration-instant) var(--ease-sharp);
  }
  .primary {
    background: var(--accent);
    color: var(--text-on-accent, #000);
    border-color: var(--accent);
  }
  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .link {
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0;
    margin-left: auto;
  }
  .link:hover {
    color: var(--text-primary);
  }
</style>
