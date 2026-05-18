<script lang="ts">
  export let balance: number;
</script>

<span class="badge" title="Credit balance">
  <span aria-hidden="true">⚡</span>
  <span>{balance}</span>
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    height: 22px;
    line-height: 1;
  }
</style>
