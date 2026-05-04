<script lang="ts">
  export let toolName: string;
  export let toolDescription: string;

  let confirmVisible = false;
  let confirmTimer: ReturnType<typeof setTimeout> | null = null;

  async function share() {
    const url = window.location.href;

    if (navigator.share && location.protocol === 'https:') {
      try {
        await navigator.share({ title: toolName, text: toolDescription, url });
        return;
      } catch (err) {
        // User cancelled or share failed — fall through to clipboard
        if ((err as Error).name === 'AbortError') return;
      }
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(url);
      showConfirm();
    } catch {
      // clipboard write failed (e.g. no permission)
    }
  }

  function showConfirm() {
    confirmVisible = true;
    if (confirmTimer) clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      confirmVisible = false;
    }, 1500);
  }
</script>

<div class="share-wrap">
  <button class="share-btn" on:click={share} aria-label="Share this tool">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3"/>
      <circle cx="6" cy="12" r="3"/>
      <circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
    Share
  </button>
  {#if confirmVisible}
    <span class="share-confirm" aria-live="polite">Link copied.</span>
  {/if}
</div>

<style>
  .share-wrap {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .share-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    background: none;
    border: none;
    padding: var(--space-1) 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    cursor: pointer;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .share-btn:hover {
    color: var(--accent-text);
  }

  .share-confirm {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--accent-text);
    animation: fade-out 1.5s ease forwards;
  }

  @keyframes fade-out {
    0%, 70% { opacity: 1; }
    100% { opacity: 0; }
  }
</style>
