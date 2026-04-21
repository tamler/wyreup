<script lang="ts">
  export let stage: string = '';
  export let percent: number | undefined = undefined;
  export let message: string = '';
</script>

<div class="progress-panel" role="status" aria-live="polite">
  <div class="progress-header">
    <span class="progress-label">Processing</span>
    {#if percent !== undefined}
      <span class="progress-pct">{percent}%</span>
    {/if}
  </div>
  <div class="progress-track" aria-hidden="true">
    <div
      class="progress-fill"
      style="width: {percent !== undefined ? percent : 0}%"
    ></div>
  </div>
  {#if message}
    <p class="progress-msg">{message}<span class="cursor" aria-hidden="true">_</span></p>
  {:else}
    <p class="progress-msg">{stage}<span class="cursor" aria-hidden="true">_</span></p>
  {/if}
</div>

<style>
  .progress-panel {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .progress-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .progress-pct {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .progress-track {
    height: 4px;
    background: var(--bg-raised);
    border-radius: 2px;
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  .progress-msg {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }

  .cursor {
    display: inline-block;
    animation: blink 1s step-end infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
</style>
