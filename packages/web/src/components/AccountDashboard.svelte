<script lang="ts">
  import { onMount } from 'svelte';
  import { user, authReady, hydrateUser, refreshBalance } from '../stores/user';
  import BuyCreditsSheet from './BuyCreditsSheet.svelte';

  interface ApiKey {
    id: string;
    name: string;
    last_used: number | null;
    created_at: number;
  }

  interface RunEntry {
    tool_id: string;
    credits_used: number;
    file_name: string | null;
    ran_at: number;
  }

  let keys: ApiKey[] = [];
  let history: RunEntry[] = [];
  let loadingKeys = true;
  let loadingHistory = true;

  let showBuySheet = false;

  let newKeyName = '';
  let newKeyBusy = false;
  let newKeyError = '';
  let createdKey = '';
  let createdKeyCopied = false;

  async function fetchKeys() {
    loadingKeys = true;
    try {
      const res = await fetch('/api/account/keys', { credentials: 'same-origin' });
      if (res.ok) {
        const data = (await res.json()) as { keys: ApiKey[] };
        keys = data.keys;
      }
    } finally {
      loadingKeys = false;
    }
  }

  async function fetchHistory() {
    loadingHistory = true;
    try {
      const res = await fetch('/api/account/history', { credentials: 'same-origin' });
      if (res.ok) {
        const data = (await res.json()) as { runs: RunEntry[] };
        history = data.runs;
      }
    } finally {
      loadingHistory = false;
    }
  }

  async function createKey() {
    newKeyError = '';
    if (!newKeyName.trim()) {
      newKeyError = 'Give the key a name first.';
      return;
    }
    newKeyBusy = true;
    try {
      const res = await fetch('/api/account/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        rawKey?: string;
        error?: string;
      };
      if (!res.ok || !data.rawKey) {
        newKeyError = data.error || `Couldn't create key (${res.status})`;
        return;
      }
      createdKey = data.rawKey;
      newKeyName = '';
      await fetchKeys();
    } finally {
      newKeyBusy = false;
    }
  }

  async function revokeKey(kid: string) {
    if (!confirm('Revoke this key? CLI/MCP installs using it will stop working immediately.')) return;
    const res = await fetch('/api/account/keys/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ kid }),
    });
    if (res.ok) await fetchKeys();
  }

  async function copyCreatedKey() {
    try {
      await navigator.clipboard.writeText(createdKey);
      createdKeyCopied = true;
      setTimeout(() => (createdKeyCopied = false), 2000);
    } catch {
      /* ignore */
    }
  }

  function dismissCreatedKey() {
    createdKey = '';
    createdKeyCopied = false;
  }

  function ago(t: number | null): string {
    if (!t) return 'never';
    const diff = Date.now() - t;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  onMount(async () => {
    await hydrateUser();
    if ($user) {
      await Promise.all([fetchKeys(), fetchHistory(), refreshBalance()]);
    }
  });

  // Refresh after a successful credit purchase
  function onPurchaseSuccess() {
    refreshBalance();
  }
</script>

{#if !$authReady}
  <p class="loading">Loading…</p>
{:else if !$user}
  <div class="signin">
    <h2>Sign in</h2>
    <p>
      Paste your API key (top-right "Get PRO" button) to view your account.
      Don't have one? You can create one from the same modal.
    </p>
  </div>
{:else}
  <header class="acct-header">
    <div class="balance">
      <span class="balance__num">{$user.balance}</span>
      <span class="balance__label">credits</span>
    </div>
    <div class="acct-header__meta">
      <div class="email">{$user.email}</div>
      {#if $user.subscriptionStatus === 'active'}
        <span class="sub-badge sub-badge--active">Monthly · active</span>
      {:else if $user.subscriptionStatus === 'cancelled'}
        <span class="sub-badge">Monthly · cancelled (runs until period end)</span>
      {:else if $user.subscriptionStatus === 'paused'}
        <span class="sub-badge">Monthly · paused</span>
      {:else if $user.subscriptionStatus === 'expired'}
        <span class="sub-badge">Monthly · expired</span>
      {/if}
      <button type="button" class="primary" on:click={() => (showBuySheet = true)}>
        {$user.subscriptionStatus === 'active' ? 'Buy more credits' : 'Buy credits / subscribe'}
      </button>
    </div>
  </header>

  <!-- API Keys --------------------------------------------------------- -->
  <section class="card">
    <h3>API keys</h3>
    {#if loadingKeys}
      <p class="muted">Loading…</p>
    {:else}
      <ul class="keys">
        {#each keys as k}
          <li class="key-row">
            <div class="key-row__main">
              <span class="key-row__name">{k.name}</span>
              <span class="key-row__meta">Last used: {ago(k.last_used)}</span>
            </div>
            <button type="button" class="ghost" on:click={() => revokeKey(k.id)}>Revoke</button>
          </li>
        {/each}
      </ul>
    {/if}

    <form class="new-key" on:submit|preventDefault={createKey}>
      <input
        type="text"
        placeholder="Name (e.g. MacBook CLI)"
        bind:value={newKeyName}
        disabled={newKeyBusy}
      />
      <button type="submit" class="primary-sm" disabled={newKeyBusy || !newKeyName.trim()}>
        {newKeyBusy ? 'Creating…' : '+ New key'}
      </button>
    </form>
    {#if newKeyError}
      <p class="error">{newKeyError}</p>
    {/if}

    {#if createdKey}
      <div class="new-key-display">
        <div class="muted">Save this key — it won't be shown again.</div>
        <code class="key-display-code">{createdKey}</code>
        <div class="new-key-actions">
          <button type="button" class="primary-sm" on:click={copyCreatedKey}>
            {createdKeyCopied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" class="ghost" on:click={dismissCreatedKey}>Done</button>
        </div>
      </div>
    {/if}
  </section>

  <!-- Run history ------------------------------------------------------- -->
  <section class="card">
    <h3>Run history</h3>
    {#if loadingHistory}
      <p class="muted">Loading…</p>
    {:else if history.length === 0}
      <p class="muted">No PRO runs yet.</p>
    {:else}
      <ul class="history">
        {#each history as r}
          <li class="hist-row">
            <span class="hist-tool">{r.tool_id}</span>
            <span class="hist-file">{r.file_name ?? '—'}</span>
            <span class="hist-credits">−{r.credits_used}</span>
            <span class="hist-time">{ago(r.ran_at)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

{#if showBuySheet}
  <BuyCreditsSheet
    on:close={() => (showBuySheet = false)}
    on:success={onPurchaseSuccess}
  />
{/if}

<style>
  .loading {
    padding: var(--space-6);
    color: var(--text-muted);
    text-align: center;
  }
  .signin {
    padding: var(--space-8) var(--space-4);
    text-align: center;
  }
  .signin h2 {
    margin: 0 0 var(--space-2);
  }
  .signin p {
    color: var(--text-muted);
    max-width: 480px;
    margin: 0 auto;
  }

  .acct-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-6) 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: var(--space-6);
    flex-wrap: wrap;
  }
  .balance {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .balance__num {
    font-family: var(--font-mono);
    font-size: 48px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1;
  }
  .balance__label {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .acct-header__meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-2);
  }
  .email {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .sub-badge {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    letter-spacing: 0.04em;
  }
  .sub-badge--active {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .card {
    padding: var(--space-5);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-5);
  }
  .card h3 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-md);
    font-weight: 600;
  }

  .muted {
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin: 0;
  }

  .keys {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--space-3);
  }
  .key-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border-subtle);
  }
  .key-row:last-child {
    border-bottom: none;
  }
  .key-row__main {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .key-row__name {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }
  .key-row__meta {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .new-key {
    display: flex;
    gap: var(--space-2);
  }
  .new-key input {
    flex: 1;
    height: 32px;
    padding: 0 var(--space-3);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .new-key-display {
    margin-top: var(--space-3);
    padding: var(--space-3);
    background: var(--bg);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .key-display-code {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    word-break: break-all;
  }
  .new-key-actions {
    display: flex;
    gap: var(--space-2);
  }

  .history {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .hist-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto auto;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    align-items: center;
  }
  .hist-row:last-child {
    border-bottom: none;
  }
  .hist-tool {
    color: var(--text-primary);
  }
  .hist-file {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hist-credits {
    color: var(--accent-text);
    font-weight: 500;
  }
  .hist-time {
    color: var(--text-subtle);
    font-size: var(--text-xs);
  }

  .primary,
  .primary-sm {
    background: var(--accent);
    color: var(--text-on-accent, #000);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-family: var(--font-mono);
  }
  .primary {
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    height: 36px;
  }
  .primary-sm {
    padding: 0 var(--space-3);
    font-size: var(--text-xs);
    height: 32px;
  }
  .primary:hover,
  .primary-sm:hover {
    background: var(--accent-hover);
  }
  .primary:disabled,
  .primary-sm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .ghost:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .error {
    margin: var(--space-2) 0 0;
    color: var(--accent-text);
    font-size: var(--text-sm);
  }
</style>
