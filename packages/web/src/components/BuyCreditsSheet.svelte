<script lang="ts">
  // BuyCreditsSheet — 3 pack cards → POST /api/credits/checkout → window.open
  // a new tab. The originating page polls /api/account/balance until it sees
  // the webhook land.

  import { createEventDispatcher, onDestroy } from 'svelte';
  import { refreshBalance, user } from '../stores/user';
  import { PACKS as PRICING_PACKS } from '../data/pricing';

  // LS overlay — loaded on demand the first time the user clicks Buy.
  // Avoids paying the script cost on page loads where the user never
  // opens this sheet. Resolves once Lemon.Setup is callable.
  declare global {
    interface Window {
      Lemon?: {
        Setup: (opts: { eventHandler: (e: { event: string }) => void }) => void;
        Url: { Open: (url: string) => void; Close: () => void };
      };
      createLemonSqueezy?: () => void;
    }
  }

  let lemonReady: Promise<void> | null = null;
  function ensureLemonLoaded(): Promise<void> {
    if (lemonReady) return lemonReady;
    lemonReady = new Promise<void>((resolve, reject) => {
      if (window.Lemon) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://assets.lemonsqueezy.com/lemon.js';
      s.defer = true;
      s.onload = () => {
        if (window.Lemon) resolve();
        else reject(new Error('Lemon.js loaded but Lemon global is missing'));
      };
      s.onerror = () => reject(new Error('Could not load Lemon.js'));
      document.head.appendChild(s);
    });
    return lemonReady;
  }

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

  $: hasActiveSubscription = $user?.subscriptionStatus === 'active';

  let busy: Pack | null = null;
  let error = '';
  let polling = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollDeadline = 0;
  // Stop polling after 5 minutes regardless of balance movement. Without
  // this, a user who spends in another tab during checkout (driving the
  // post-purchase balance back below startBalance) would never see the
  // poll resolve.
  const POLL_MAX_MS = 5 * 60 * 1000;
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
        headers: { 'Content-Type': 'application/json', 'X-Wyreup-CSRF': '1' },
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
      try {
        await ensureLemonLoaded();
        // Setup is idempotent — calling it again replaces the handler.
        // We hook Checkout.Success so balance refresh fires the moment
        // the user completes payment, without waiting for the poll.
        window.Lemon!.Setup({
          eventHandler: async (evt) => {
            if (evt.event === 'Checkout.Success') {
              stopPolling();
              await refreshBalance();
              dispatch('success');
              dispatch('close');
            }
          },
        });
        window.Lemon!.Url.Open(data.checkoutUrl);
      } catch {
        // Fall back to a new tab if the overlay script failed to load
        // (CSP misconfig, network drop) so the user can still purchase.
        window.open(data.checkoutUrl, '_blank', 'noopener,noreferrer');
      }
      startPolling();
    } finally {
      busy = null;
    }
  }

  function startPolling() {
    polling = true;
    pollDeadline = Date.now() + POLL_MAX_MS;
    pollTimer = setInterval(async () => {
      if (Date.now() > pollDeadline) {
        stopPolling();
        error =
          "We didn't see the credits land in 5 minutes. Check the LS receipt — if it shows paid, refresh /account; if not, the purchase didn't go through.";
        return;
      }
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
      Pay-as-you-go credits never expire. Payment is processed by Lemon
      Squeezy — we never see your card.
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

    <div class="divider"><span>or subscribe</span></div>

    <button
      type="button"
      class="monthly"
      on:click={() => buy('monthly')}
      disabled={busy !== null || hasActiveSubscription}
      aria-label={hasActiveSubscription
        ? 'You already have an active monthly subscription'
        : 'Subscribe — 440 credits per month for $8'}
    >
      <div class="monthly__main">
        <span class="monthly__title">Monthly · 440 credits</span>
        <span class="monthly__sub">
          440 credits granted each month. Renews automatically; cancel
          anytime in your Lemon Squeezy receipt. If you run out before
          the next grant, buy a pack or wait for the next cycle.
        </span>
      </div>
      <div class="monthly__right">
        <span class="monthly__price">$8<span class="monthly__per">/mo</span></span>
        <span class="cta">
          {#if hasActiveSubscription}
            Active
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
