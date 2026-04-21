<script lang="ts">
  import { stashChainFile } from './chainStorage';

  export let resultBlob: Blob | null = null;
  export let resultName: string = 'result';

  interface NextTool {
    id: string;
    name: string;
    category: string;
    description: string;
  }

  let nextTools: NextTool[] = [];
  let tooLarge = false;

  const MAX_CHAIN_BYTES = 10 * 1024 * 1024;

  $: if (resultBlob) {
    loadNextTools(resultBlob);
    tooLarge = resultBlob.size > MAX_CHAIN_BYTES;
  }

  async function loadNextTools(blob: Blob) {
    const { createDefaultRegistry } = await import('@wyreup/core');
    const registry = createDefaultRegistry();
    const file = new File([blob], resultName, { type: blob.type });
    const tools = registry.toolsForFiles([file]);
    nextTools = tools.slice(0, 6).map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
    }));
  }

  async function navigate(toolId: string) {
    if (!resultBlob) return;
    if (!tooLarge) {
      const file = new File([resultBlob], resultName, { type: resultBlob.type });
      await stashChainFile(file);
    }
    window.location.href = `/tools/${toolId}`;
  }
</script>

{#if nextTools.length > 0}
  <div class="chain-section">
    <div class="chain-header">
      <span class="chain-label">Use this result in</span>
      {#if tooLarge}
        <span class="chain-notice">File too large to carry automatically — download and re-upload manually.</span>
      {/if}
    </div>
    <div class="chain-nodes">
      {#each nextTools as tool}
        <button
          class="chain-node"
          on:click={() => navigate(tool.id)}
          type="button"
        >
          <span class="chain-node__dot" aria-hidden="true"></span>
          <div class="chain-node__body">
            <span class="chain-node__name">{tool.name}</span>
            <span class="chain-node__cat">{tool.category}</span>
          </div>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .chain-section {
    border-top: 1px solid var(--border-subtle);
    padding-top: var(--space-4);
    margin-top: var(--space-6);
  }

  .chain-header {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
    flex-wrap: wrap;
  }

  .chain-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .chain-notice {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
  }

  .chain-nodes {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chain-node {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    transition:
      border-color var(--duration-fast) var(--ease-sharp),
      background var(--duration-fast) var(--ease-sharp);
  }

  .chain-node:hover {
    border-color: var(--accent);
    background: var(--accent-dim);
  }

  .chain-node:hover .chain-node__dot {
    background: var(--accent);
    border-color: var(--accent);
  }

  .chain-node:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .chain-node__dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    flex-shrink: 0;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp);
  }

  .chain-node__body {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .chain-node__name {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: 500;
  }

  .chain-node__cat {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
</style>
