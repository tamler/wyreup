<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { refreshBalance, user } from '../stores/user';
  import { PACKS as PRICING_PACKS } from '../data/pricing';

  const dispatch = createEventDispatcher<{ close: void; success: void }>();

  type Pack = 'starter' | 'standard' | 'power' | 'monthly';
  // Pack ids are the server checkout contract; credits/prices come from the
  // single pricing source (index order matches: Starter, Best value, Power).
  const PACK_IDS: Pack[] = ['starter', 'standard', 'power'];
  const PACKS: { id: Pack; credits: number; price: string; tag?: string }[] = PRICING_PACKS.map(
    (pack, i) => ({
      id: PACK_IDS[i]!,
      credits: pack.credits,
      price: `$${pack.usd}`,
      tag: pack.featured ? pack.label : undefined,
    }),
  );

  $: hasSubscription = $user?.monthlyCheckoutBlocked ?? ($user?.subscriptionStatus === 'active');

  let busy: Pack | null = null;
  let payment: { url: string; id: string } | null = null;
  let error = '';
  let polling = false;
  let operation: AbortController | null = null;
  let preparation: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  async function buy(pack: Pack) {
    stop();
    payment = null;
    error = '';
    busy = pack;
    const current = new AbortController();
    operation = current;
    preparation = setTimeout(() => {
      error = 'Checkout is taking longer than expected. Try again to resume it.';
      current.abort();
    }, 30_000);
    try {
      const res = await fetch('/api/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wyreup-CSRF': '1' },
        credentials: 'same-origin',
        body: JSON.stringify({ pack }),
        signal: current.signal,
      });
      const data = (await res.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        transactionId?: string;
        error?: string;
      };
      if (current.signal.aborted) return;
      if (!res.ok || !data.checkoutUrl || !data.transactionId) {
        error = data.error || `Couldn't start checkout (${res.status})`;
        return;
      }
      const url = new URL(data.checkoutUrl);
      if (url.origin !== window.location.origin || url.pathname !== '/checkout'
        || url.username || url.password || url.hash || url.searchParams.size !== 1
        || !/^txn_[a-z0-9]{26}$/.test(data.transactionId)
        || url.searchParams.get('_ptxn') !== data.transactionId) {
        error = 'Checkout returned an invalid payment link.';
        return;
      }
      payment = { url: url.href, id: data.transactionId };
    } catch {
      if (!current.signal.aborted) error = 'Could not start checkout. Try again.';
    } finally {
      if (operation === current) {
        clearTimeout(preparation);
        operation = null;
        busy = null;
      }
    }
  }

  function startPolling() {
    if (polling || !payment) return;
    const id = payment.id;
    const current = new AbortController();
    operation = current;
    error = '';
    polling = true;
    deadline = setTimeout(() => {
      stop();
      error = 'Payment is still unconfirmed. Check your Paddle receipt and account balance before trying again.';
    }, 5 * 60 * 1000);
    async function poll() {
      try {
        const res = await fetch(`/api/credits/status?transactionId=${encodeURIComponent(id)}`, {
          credentials: 'same-origin', signal: current.signal,
        });
        const data = res.ok ? (await res.json()) as { state?: string } : {};
        if (current.signal.aborted) return;
        if (data.state === 'fulfilled') {
          stop();
          payment = null;
          void refreshBalance();
          dispatch('success');
          dispatch('close');
          return;
        }
        if (data.state === 'cancelled' || data.state === 'blocked' || res.status === 401 || res.status === 404) {
          stop();
          payment = null;
          error = data.state === 'cancelled' ? 'Checkout was cancelled. Pick a pack to start again.'
            : 'Could not confirm this checkout. Check your account and receipt.';
          return;
        }
      } catch {
        // Keep waiting through temporary network errors.
      }
      if (!current.signal.aborted) pollTimer = setTimeout(poll, 3000);
    }
    void poll();
  }

  function stop() {
    operation?.abort();
    operation = null;
    polling = false;
    clearTimeout(preparation);
    clearTimeout(pollTimer);
    clearTimeout(deadline);
  }

  onDestroy(stop);

  function close() {
    stop();
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
      Pay-as-you-go credits never expire. Paddle processes your payment and handles your card details.
    </p>

    <div class="cards">
      {#each PACKS as p}
        <button
          type="button"
          class="card"
          class:tagged={p.tag}
          on:click={() => buy(p.id)}
          disabled={busy !== null || polling}
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

    <div class="divider"><span>or subscribe</span></div>

    <button
      type="button"
      class="monthly"
      on:click={() => buy('monthly')}
      disabled={busy !== null || polling || hasSubscription}
      aria-label={hasSubscription
        ? 'You already have a monthly subscription'
        : 'Subscribe — 440 credits per month for $8'}
    >
      <div class="monthly__main">
        <span class="monthly__title">Monthly · 440 credits</span>
        <span class="monthly__sub">
          440 credits each paid month. Renews automatically. Manage your subscription
          in your account or from your payment receipt.
        </span>
      </div>
      <div class="monthly__right">
        <span class="monthly__price">$8<span class="monthly__per">/mo</span></span>
        <span class="cta">
          {#if hasSubscription}
            Subscribed
          {:else if busy === 'monthly'}
            Opening…
          {:else}
            Subscribe
          {/if}
        </span>
      </div>
    </button>

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    {#if payment}
      <p class="polling">
        <a href={payment.url} target="_blank" rel="noopener noreferrer" on:click={startPolling}>
          Continue to Paddle checkout
        </a>
        (opens in a new tab)
      </p>
    {/if}

    {#if polling}
      <p class="polling" role="status">Waiting for payment confirmation…</p>
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
  .divider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-5) 0 var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .monthly {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-4) var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    transition: border-color var(--duration-instant) var(--ease-sharp);
  }
  .monthly:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .monthly:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .monthly__main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .monthly__title {
    font-family: var(--font-mono);
    font-size: var(--text-md);
    color: var(--text-primary);
    font-weight: 600;
  }
  .monthly__sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1.4;
  }
  .monthly__right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    flex-shrink: 0;
  }
  .monthly__price {
    font-family: var(--font-mono);
    font-size: var(--text-2xl, 28px);
    font-weight: 600;
    color: var(--text-primary);
  }
  .monthly__per {
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-weight: 400;
  }
</style>
