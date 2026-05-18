<script lang="ts">
  // BuyCreditsSheet — 3 pack cards → POST /api/credits/checkout → window.open
  // a new tab. The originating page polls /api/account/balance until it sees
  // the webhook land.

  import { createEventDispatcher, onDestroy } from 'svelte';
  import { refreshBalance } from '../stores/user';

  const dispatch = createEventDispatcher<{ close: void; success: void }>();

  type Pack = 'starter' | 'standard' | 'power';
  const PACKS: { id: Pack; credits: number; price: string; tag?: string }[] = [
    { id: 'starter', credits: 50, price: '$4.99' },
    { id: 'standard', credits: 150, price: '$9.99', tag: 'Best value' },
    { id: 'power', credits: 400, price: '$19.99' },
  ];

  let busy: Pack | null = null;
  let error = '';
  let polling = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let startBalance = 0;

  async function buy(pack: Pack) {
    error = '';
    busy = pack;
    try {
      // Snapshot balance so the poll loop knows when the webhook lands.
      const balRes = await fetch('/api/account/balance', { credentials: 'same-origin' });
      if (balRes.ok) {
        const data = (await balRes.json()) as { balance?: number };
        startBalance = data.balance ?? 0;
      }

      const res = await fetch('/api/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ pack }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        error?: string;
      };
      if (!res.ok || !data.checkoutUrl) {
        error = data.error || `Couldn't start checkout (${res.status})`;
        return;
      }
      window.open(data.checkoutUrl, '_blank', 'noopener');
      startPolling();
    } finally {
      busy = null;
    }
  }

  function startPolling() {
    polling = true;
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch('/api/account/balance', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = (await res.json()) as { balance?: number };
        if ((data.balance ?? 0) > startBalance) {
          stopPolling();
          await refreshBalance();
          dispatch('success');
          dispatch('close');
        }
      } catch {
        /* network blip — keep polling */
      }
    }, 3000);
  }

  function stopPolling() {
    polling = false;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // BuyCreditsSheet only renders client-side (mounted via {#if showBuySheet}
  // in ToolRunner / AccountDashboard) so onDestroy is safe — there is no SSR
  // path that produces a render+destroy pair for this component.
  onDestroy(() => stopPolling());

  function close() {
    stopPolling();
    dispatch('close');
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={onKeyDown} />

<div
  class="overlay"
  role="presentation"
  on:click={(e) => {
    if (e.target === e.currentTarget) close();
  }}
>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="buy-credits-title">
    <button type="button" class="close" aria-label="Close" on:click={close}>×</button>
    <h2 id="buy-credits-title">Buy credits</h2>
    <p class="hint">
      Credits never expire. One-time purchase, no subscription. Payment is processed
      by Lemon Squeezy — we never see your card.
    </p>

    <div class="cards">
      {#each PACKS as p}
        <button
          type="button"
          class="card"
          class:tagged={p.tag}
          on:click={() => buy(p.id)}
          disabled={busy !== null}
        >
          {#if p.tag}
            <span class="tag">{p.tag}</span>
          {/if}
          <span class="credits">{p.credits}</span>
          <span class="credits-label">credits</span>
          <span class="price">{p.price}</span>
          <span class="cta">
            {busy === p.id ? 'Opening…' : 'Buy'}
          </span>
        </button>
      {/each}
    </div>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    {#if polling}
      <p class="polling">
        Waiting for payment confirmation… (this page will update when the credits land)
      </p>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1010;
    padding: var(--space-4);
  }
  .sheet {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: 640px;
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
  h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg);
    font-weight: 600;
  }
  .hint {
    margin: 0 0 var(--space-5);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
  }
  @media (max-width: 540px) {
    .cards {
      grid-template-columns: 1fr;
    }
  }
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: var(--space-5) var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color var(--duration-instant) var(--ease-sharp);
  }
  .card:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .card:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .card.tagged {
    border-color: var(--accent);
  }
  .tag {
    position: absolute;
    top: -10px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent);
    color: var(--text-on-accent, #000);
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    white-space: nowrap;
  }
  .credits {
    font-family: var(--font-mono);
    font-size: var(--text-2xl, 28px);
    font-weight: 600;
    color: var(--text-primary);
  }
  .credits-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .price {
    margin-top: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-md);
    color: var(--text-primary);
  }
  .cta {
    margin-top: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--accent-text);
  }
  .error {
    color: var(--accent-text);
    font-size: var(--text-sm);
    margin: var(--space-3) 0 0;
  }
  .polling {
    margin: var(--space-3) 0 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
</style>
