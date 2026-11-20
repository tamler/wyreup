<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { stashChainHandover, clearChainHandover } from './chainStorage';
  import { clearTrail, getTrailHandover, setTrailHandover } from './hopTrail';
  import { fileToolCandidates } from '../../lib/file-tool-candidates';
  import { saveChain, type ToolbeltChainStep } from './toolbeltStorage';
  import { displayName } from '../../data/display-names';

  export let resultBlob: Blob | null = null;
  export let resultName: string = 'result';
  /**
   * Optional id of the tool that produced this result. When set, the
   * chain panel honors that tool's `chainSuggestions` field to filter
   * the next-step list — avoids suggesting wildly off-topic tools just
   * because they accept the same MIME (e.g. color-converter for prose).
   */
  export let sourceToolId: string | undefined = undefined;

  interface NextTool {
    id: string;
    name: string;
    category: string;
    description: string;
  }

  let nextTools: NextTool[] = [];
  let stashFailed = false;
  let stashCleanupFailed = false;
  let saveIntermediate = false;
  let trail: ToolbeltChainStep[] = [];
  let savedChainId: string | null = null;
  let savedChainName = '';
  let savedChainSteps: ToolbeltChainStep[] = [];
  let savedChainCreatedAt = '';
  let savingChain = false;
  let navigating = false;
  let generation = 0;
  let disposed = false;
  const downloadUrls = new Set<string>();
  const downloadTimers = new Set<ReturnType<typeof setTimeout>>();
  onDestroy(() => { disposed = true; generation++; for (const url of downloadUrls) URL.revokeObjectURL(url); for (const timer of downloadTimers) clearTimeout(timer); });

  const STORAGE_KEY = 'wyreup:chain-save-intermediate';

  onMount(() => {
    try {
      saveIntermediate = localStorage.getItem(STORAGE_KEY) === 'true';
    } catch { /* ignore */ }
  });

  function toggleSaveIntermediate() {
    saveIntermediate = !saveIntermediate;
    try {
      localStorage.setItem(STORAGE_KEY, saveIntermediate ? 'true' : 'false');
    } catch { /* ignore */ }
  }

  $: if (resultBlob) {
    loadNextTools(resultBlob, resultName, sourceToolId);
    stashFailed = false;
    stashCleanupFailed = false;
    savedChainId = null;
    savedChainName = '';
    savedChainSteps = [];
    savedChainCreatedAt = '';
  } else {
    generation++;
    nextTools = [];
    trail = [];
  }

  async function loadNextTools(blob: Blob, name: string, sourceId: string | undefined) {
    const attempt = ++generation;
    const { createDefaultRegistry } = await import('../../lib/core-execution');
    if (disposed || attempt !== generation) return;
    const registry = createDefaultRegistry();
    const binding = getTrailHandover();
    trail = binding?.targetToolId === sourceId && binding.steps.every((step) => registry.toolsById.has(step.toolId)) ? binding.steps : [];
    if (binding && binding.targetToolId !== sourceId) clearTrail();
    const file = new File([blob], name, { type: blob.type });
    let pool = fileToolCandidates(registry.tools, file);

    // If the source tool curated its own chain suggestions, restrict
    // the panel to that allowlist (preserving the curated order).
    if (sourceId) {
      const source = registry.toolsById.get(sourceId);
      const suggestions = (source as { chainSuggestions?: string[] } | undefined)
        ?.chainSuggestions;
      if (suggestions !== undefined) {
        const compatibleIds = new Set(pool.map((t) => t.id));
        pool = suggestions
          .filter((id) => compatibleIds.has(id))
          .map((id) => registry.toolsById.get(id))
          .filter((t): t is NonNullable<typeof t> => Boolean(t));
      }
    }

    nextTools = pool.slice(0, 6).map((t) => ({
      id: t.id,
      name: displayName(t.id, t.name),
      category: t.category,
      description: t.description,
    }));
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    downloadUrls.add(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); downloadTimers.delete(timer); }, 1000);
    downloadTimers.add(timer);
  }

  async function navigate(toolId: string) {
    if (!resultBlob || navigating || !nextTools.some((tool) => tool.id === toolId)) return;
    const blob = resultBlob, name = resultName, source = sourceToolId, attempt = generation;
    const steps = [...trail, ...(source ? [{ toolId: source, params: {} }] : [])];
    let locationAssigned = false;
    navigating = true;
    try {
      if (saveIntermediate) {
        downloadBlob(blob, name);
      }
      const file = new File([blob], name, { type: blob.type });
      const result = await stashChainHandover(file, { autoAccept: true, targetToolId: toolId });
      const current = () => !disposed && attempt === generation && blob === resultBlob && source === sourceToolId && name === resultName;
      if (!current()) {
        if (result.stored) await clearChainHandover(result.token);
        return;
      }
      if (!result.stored || !setTrailHandover(steps, result.token, toolId)) {
        const cleared = !result.stored || await clearChainHandover(result.token);
        if (!current()) return;
        // IndexedDB quota or persistence failure — surface the warning and
        // download the file so the user can re-upload manually.
        stashFailed = true;
        stashCleanupFailed = !cleared;
        downloadBlob(blob, name);
        return;
      }
      window.location.href = `/tools/${toolId}`;
      locationAssigned = true;
    } finally {
      if (!locationAssigned) navigating = false;
    }
  }

  async function saveCurrentChain() {
    if (!sourceToolId || savingChain) return;
    savingChain = true;
    try {
      const steps = [...trail, { toolId: sourceToolId, params: {} }];
      const { createDefaultRegistry } = await import('../../lib/core-execution');
      const registry = createDefaultRegistry();
      const name = steps
        .map((step) => displayName(step.toolId, registry.toolsById.get(step.toolId)?.name))
        .join(' → ');
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      saveChain({ id, name, steps, createdAt: now, updatedAt: now });
      savedChainId = id;
      savedChainName = name;
      savedChainSteps = steps;
      savedChainCreatedAt = now;
    } finally {
      savingChain = false;
    }
  }

  function renameSavedChain() {
    const name = savedChainName.trim();
    if (!savedChainId || !name) return;
    saveChain({
      id: savedChainId,
      name,
      steps: savedChainSteps,
      createdAt: savedChainCreatedAt,
      updatedAt: new Date().toISOString(),
    });
    savedChainName = name;
  }
</script>

{#if nextTools.length > 0 || (resultBlob && sourceToolId && trail.length >= 1)}
  <div class="chain-section">
    {#if resultBlob && sourceToolId && trail.length >= 1}
      <div class="chain-save">
        {#if savedChainId}
          <input
            class="chain-save__input"
            type="text"
            aria-label="Chain name"
            bind:value={savedChainName}
            on:keydown={(event) => {
              if (event.key === 'Enter') renameSavedChain();
            }}
            on:blur={renameSavedChain}
          />
          <a class="chain-save__link" href="/toolbelt">View saved chains →</a>
        {:else}
          <span class="chain-save__copy">You chained {trail.length + 1} actions — each result fed the next.</span>
          <button
            class="chain-node chain-save__button"
            type="button"
            disabled={savingChain}
            on:click={saveCurrentChain}
          >Save this chain</button>
        {/if}
      </div>
    {/if}
    {#if nextTools.length > 0}
      <div class="chain-header">
        <span class="chain-label">Use this result in</span>
        {#if stashFailed}
          <span class="chain-notice">Couldn't carry the file over — saved a copy so you can re-upload it.{#if stashCleanupFailed} Shared storage could not confirm deleting this token.{/if}</span>
        {/if}
        <label class="save-intermediate">
          <input
            type="checkbox"
            checked={saveIntermediate}
            on:change={toggleSaveIntermediate}
            aria-label="Also download this step's file before moving on"
            title="Download this step's file too when you send the result into another tool."
          />
          <span class="save-intermediate__copy">
            <span class="save-intermediate__label">Also keep this step's file</span>
            <span class="save-intermediate__helper">Download this step's file too when you send the result into another tool.</span>
          </span>
        </label>
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
    {/if}
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

  .chain-save {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .chain-save__copy,
  .chain-save__link {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .chain-save__copy {
    color: var(--text-muted);
  }

  .chain-save__button {
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .chain-save__button:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .chain-save__input {
    min-width: min(100%, 320px);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .chain-save__input:focus-visible {
    border-color: var(--accent-hover);
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .chain-save__link {
    color: var(--accent-text);
  }

  .chain-save__link:hover {
    color: var(--accent-hover);
  }

  .chain-save__link:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
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

  .save-intermediate {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    cursor: pointer;
    margin-left: auto;
  }

  .save-intermediate input[type="checkbox"] {
    width: 12px;
    height: 12px;
    accent-color: var(--accent);
    cursor: pointer;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .save-intermediate__copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 360px;
  }

  .save-intermediate__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    white-space: nowrap;
    user-select: none;
  }

  .save-intermediate__helper {
    color: var(--text-subtle);
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    line-height: 1.4;
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
    border-color: var(--accent-hover);
    background: var(--accent-dim);
  }

  .chain-node:hover .chain-node__dot {
    background: var(--accent);
    border-color: var(--accent-hover);
  }

  .chain-node:focus-visible {
    outline: 2px solid var(--accent-hover);
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
