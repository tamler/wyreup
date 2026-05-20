<script lang="ts">
  // ProSignup — inline signup for the /pro page.
  //
  // Flow (lowest-friction path): enter email -> POST /api/account/create
  // -> the server sets the wyreup_session cookie on the browser surface
  // -> hydrateUser() populates $user -> you're signed in. The wk_live_ key
  // is emailed for CLI/MCP use and shown once here for convenience.
  //
  // Returning CLI users (or anyone whose email already has an account)
  // fall back to the "activate a key" path.

  import { onMount } from 'svelte';
  import { user, authReady, hydrateUser, activate } from '../stores/user';

  type Screen = 'email' | 'activate' | 'done';

  let screen: Screen = 'email';
  let emailInput = '';
  let keyInput = '';
  let busy = false;
  let error = '';
  let createdKey = '';
  let keyCopied = false;

  onMount(() => {
    // If the visitor is already signed in, skip straight to the done state.
    hydrateUser();
  });

  $: if ($authReady && $user && screen !== 'done') {
    screen = 'done';
  }

  async function submitEmail() {
    error = '';
    const email = emailInput.trim();
    if (!email) {
      error = 'Enter your email to continue.';
      return;
    }
    busy = true;
    try {
      const res = await fetch('/api/account/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, surface: 'browser' }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        rawKey?: string;
        error?: string;
      };
      if (!res.ok) {
        error = data.error || `Couldn't sign you up (${res.status})`;
        return;
      }
      if (data.status === 'exists') {
        screen = 'activate';
        error =
          'You already have an account. Check your inbox for your key, then paste it below.';
        return;
      }
      // status === 'created' — the session cookie is now set server-side.
      createdKey = data.rawKey ?? '';
      await hydrateUser();
      screen = 'done';
    } catch {
      error = 'Network error — please try again.';
    } finally {
      busy = false;
    }
  }

  async function submitKey() {
    error = '';
    const key = keyInput.trim();
    if (!key) {
      error = 'Paste your wk_live_ key to continue.';
      return;
    }
    busy = true;
    try {
      const res = await activate(key);
      if (res.ok) {
        screen = 'done';
      } else {
        error = res.error;
      }
    } finally {
      busy = false;
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(createdKey);
      keyCopied = true;
      setTimeout(() => (keyCopied = false), 2000);
    } catch {
      /* clipboard blocked — the key is selectable manually */
    }
  }
</script>

<div class="signup" id="signup">
  {#if screen === 'done'}
    <div class="done">
      <div class="done__check" aria-hidden="true">✓</div>
      <h3>You're in{$user ? `, ${$user.email}` : ''}.</h3>
      {#if createdKey}
        <p class="done__sub">
          Your account is ready and you're signed in. Here's your API key —
          you'll need it for the CLI and MCP. We've emailed it too.
        </p>
        <div class="keyrow">
          <code class="key">{createdKey}</code>
          <button type="button" class="btn-ghost" on:click={copyKey}>
            {keyCopied ? 'Copied' : 'Copy'}
          </button>
        </div>
      {:else}
        <p class="done__sub">You're signed in. Pick a pack below to add credits.</p>
      {/if}
      <div class="done__cta">
        <a href="#pricing" class="btn-primary">Choose a credit pack</a>
        <a href="/account" class="btn-ghost">Go to your account</a>
      </div>
    </div>
  {:else if screen === 'activate'}
    <h3>Activate your key</h3>
    <p class="signup__sub">Paste the <code>wk_live_…</code> key from your inbox.</p>
    <form on:submit|preventDefault={submitKey}>
      <div class="field">
        <input
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="wk_live_…"
          bind:value={keyInput}
          disabled={busy}
        />
        <button type="submit" class="btn-primary" disabled={busy || !keyInput.trim()}>
          {busy ? 'Activating…' : 'Activate'}
        </button>
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </form>
    <button type="button" class="switch" on:click={() => { screen = 'email'; error = ''; }}>
      ← Back to sign up
    </button>
  {:else}
    <h3>Create your account</h3>
    <p class="signup__sub">
      One field. No password. You'll be signed in instantly — free tools
      stay free, you only pay when you buy credits.
    </p>
    <form on:submit|preventDefault={submitEmail}>
      <div class="field">
        <input
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          bind:value={emailInput}
          disabled={busy}
        />
        <button type="submit" class="btn-primary" disabled={busy || !emailInput.trim()}>
          {busy ? 'Creating…' : 'Get started'}
        </button>
      </div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </form>
    <button type="button" class="switch" on:click={() => { screen = 'activate'; error = ''; }}>
      Already have a key? Activate it →
    </button>
  {/if}
</div>

<style>
  .signup {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-6);
    max-width: 520px;
    margin: 0 auto;
  }
  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
  }
  .signup__sub,
  .done__sub {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }
  .field {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  input {
    flex: 1;
    min-width: 200px;
    height: 42px;
    padding: 0 var(--space-3);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  input:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 1px;
  }
  .btn-primary {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: 0 var(--space-5);
    height: 42px;
    display: inline-flex;
    align-items: center;
    background: var(--accent);
    color: var(--text-on-accent, #000);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-decoration: none;
    white-space: nowrap;
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-ghost {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: 0 var(--space-4);
    height: 42px;
    display: inline-flex;
    align-items: center;
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-decoration: none;
  }
  .btn-ghost:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .error {
    color: var(--accent-text);
    font-size: var(--text-sm);
    margin: var(--space-3) 0 0;
  }
  .switch {
    margin-top: var(--space-4);
    background: none;
    border: none;
    padding: 0;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .switch:hover {
    color: var(--text-primary);
  }

  .done__check {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--text-on-accent, #000);
    font-size: 20px;
    margin-bottom: var(--space-3);
  }
  .keyrow {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin-bottom: var(--space-4);
  }
  .key {
    flex: 1;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3);
    color: var(--text-primary);
    word-break: break-all;
  }
  .done__cta {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
</style>
