<script lang="ts">
  export let cost: number | undefined = undefined;
</script>

<span class="pro" title={cost != null ? `PRO — ${cost} credits` : 'PRO'}>
  <span>PRO</span>
  {#if cost != null}
    <span class="cost">{cost}</span>
  {/if}
</span>

<style>
  .pro {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--text-on-accent, #000);
    background: var(--accent);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
    line-height: 1;
    text-transform: uppercase;
  }
  .cost {
    font-weight: 500;
    opacity: 0.85;
  }
</style>
