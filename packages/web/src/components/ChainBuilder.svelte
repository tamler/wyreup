<script lang="ts">
  import { onMount, tick } from 'svelte';
  import DropZone from './runners/DropZone.svelte';
  import ParamsForm from './runners/ParamsForm.svelte';
  import ProgressBar from './runners/ProgressBar.svelte';
  import { encodeChainSteps, decodeChainSteps } from './runners/chainUrl';
  import { saveChain } from './runners/toolbeltStorage';
  import { upsertRule, nextOrder } from './runners/triggerStorage';
  import { capabilities, showUnrunnable, filterRunnable } from '../stores/capabilities';
  import { couldFlowTo, DEFAULT_RATE_LIMIT } from '@wyreup/core';
  import type { ToolProgress, ParamFieldSchema, ToolRequires } from '@wyreup/core';

  interface ToolSummary {
    id: string;
    name: string;
    description: string;
    category?: string;
    keywords?: string[];
    inputAccept: string[];
    inputMin: number;
    outputMime: string;
    defaults: Record<string, unknown>;
    paramSchema?: Record<string, ParamFieldSchema>;
    requires?: ToolRequires;
  }

  export let tools: ToolSummary[] = [];

  // Available tools the device can actually run. Direct chain URLs
  // (`/chain/run?steps=...`) bypass this filter — the chain builder
  // is just for composing new chains, where suggesting tools that
  // can't run is unhelpful.
  $: visibleTools = filterRunnable(tools, $capabilities.caps, $showUnrunnable).runnable;

  // Chain state: each step has a toolId + params
  interface BuildStep {
    toolId: string;
    params: Record<string, unknown>;
    expanded: boolean;
  }

  let steps: BuildStep[] = [];
  let inputFiles: File[] = [];
  let dropError = '';

  interface ToolPickerGroup {
    category: string;
    tools: ToolSummary[];
  }

  interface ToolPickerResults {
    compatibleGroups: ToolPickerGroup[];
    otherGroups: ToolPickerGroup[];
    ordered: ToolSummary[];
    hasCompatibilityContext: boolean;
  }

  let pickerOpenIdx: number | null = null;
  let pickerQuery = '';
  let activeOptionIdx = 0;
  let toolMetadata = new Map<string, { category: string; keywords: string[] }>();

  $: inputFile = inputFiles[0] ?? null;

  type RunState = 'idle' | 'running' | 'done' | 'error';
  let runState: RunState = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0 };
  let stepStatuses: Array<'pending' | 'running' | 'done' | 'error'> = [];
  let errorMsg = '';

  let resultBlob: Blob | null = null;
  let resultUrl: string | null = null;

  let shareConfirm = false;
  let shareTimer: ReturnType<typeof setTimeout> | null = null;
  let saveConfirm = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let saveName = '';
  let showSaveDialog = false;
  // Post-run inline save prompt
  let showEndOfRunPrompt = false;
  let endOfRunSaved = false;

  // Trigger-register state (G2: any rule registered here lands with
  // confirmed=false — the user explicitly opts in to the preview-skip
  // later, per-rule, in /toolbelt).
  let registerAsTrigger = false;
  let triggerMime = '';

  // Auto-suggest a MIME pattern from the chain's first step. We pick a
  // concrete accept entry when there's exactly one; otherwise fall back
  // to the first one (the user can edit before saving).
  $: triggerMimeSuggestion = (() => {
    const first = chainSpec[0];
    if (!first) return '';
    const tool = tools.find((t) => t.id === first.toolId);
    if (!tool || tool.inputAccept.length === 0) return '';
    return tool.inputAccept[0]!;
  })();

  // Keep the editable triggerMime in sync with the suggestion when the
  // user hasn't customised it yet (empty string).
  $: if (registerAsTrigger && !triggerMime) triggerMime = triggerMimeSuggestion;

  function registerTriggerForChain(chainId: string, chainName: string) {
    const mime = triggerMime.trim();
    if (!mime) return;
    // Defensive: refuse bare wildcards. The core parser will reject
    // these too, but better to surface early than to throw inside save.
    if (mime === '*' || mime === '*/*' || !mime.includes('/')) return;
    const now = Date.now();
    upsertRule({
      id: crypto.randomUUID(),
      name: chainName,
      mime,
      chainId,
      order: nextOrder(),
      confirmed: false,
      enabled: true,
      rateLimit: { ...DEFAULT_RATE_LIMIT },
      createdAt: now,
      updatedAt: now,
    });
  }

  function getOutputMime(toolId: string): string | null {
    const t = tools.find((x) => x.id === toolId);
    return t?.outputMime ?? null;
  }

  function getDefaults(toolId: string): Record<string, unknown> {
    const t = tools.find((x) => x.id === toolId);
    return t?.defaults ?? {};
  }

  function getParamSchema(toolId: string): Record<string, ParamFieldSchema> | undefined {
    const t = tools.find((x) => x.id === toolId);
    return t?.paramSchema;
  }

  function prevOutputMime(idx: number): string | null {
    if (idx === 0) return inputFile ? inputFile.type : null;
    const prev = steps[idx - 1];
    if (!prev || !prev.toolId) return null;
    return getOutputMime(prev.toolId);
  }

  function getToolCategory(tool: ToolSummary): string {
    return tool.category ?? toolMetadata.get(tool.id)?.category ?? 'other';
  }

  function getToolKeywords(tool: ToolSummary): string[] {
    return tool.keywords ?? toolMetadata.get(tool.id)?.keywords ?? [];
  }

  function isCompatible(tool: ToolSummary, mime: string): boolean {
    if (tool.inputMin === 0) return false;
    return couldFlowTo(mime, tool.inputAccept);
  }

  function groupTools(toolsToGroup: ToolSummary[]): ToolPickerGroup[] {
    const groups = new Map<string, ToolSummary[]>();
    for (const tool of toolsToGroup) {
      const category = getToolCategory(tool);
      const group = groups.get(category) ?? [];
      group.push(tool);
      groups.set(category, group);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, grouped]) => ({
        category,
        tools: grouped.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  }

  // Reactive state (query, open picker, dropped file) is passed as arguments
  // so template {@const} expressions re-evaluate when any of them change —
  // Svelte 4 only tracks identifiers referenced in the expression itself.
  function buildPickerResults(
    idx: number,
    query_: string = pickerQuery,
    openIdx: number | null = pickerOpenIdx,
  ): ToolPickerResults {
    const query = openIdx === idx ? query_.trim().toLowerCase() : '';
    const filtered = visibleTools.filter((tool) => {
      if (!query) return true;
      return [
        tool.name,
        tool.id,
        tool.description,
        getToolCategory(tool),
        ...getToolKeywords(tool),
      ].some((value) => value.toLowerCase().includes(query));
    });
    const mime = prevOutputMime(idx);

    if (!mime) {
      const compatibleGroups = groupTools(filtered);
      return {
        compatibleGroups,
        otherGroups: [],
        ordered: compatibleGroups.flatMap((group) => group.tools),
        hasCompatibilityContext: false,
      };
    }

    const compatibleGroups = groupTools(filtered.filter((tool) => isCompatible(tool, mime)));
    const otherGroups = groupTools(filtered.filter((tool) => !isCompatible(tool, mime)));
    return {
      compatibleGroups,
      otherGroups,
      // Only compatible tools are selectable: a chain edge the engine will
      // reject must not be buildable from the picker (a failing step after
      // credit-metered steps have already run is the worst outcome).
      ordered: compatibleGroups.flatMap((group) => group.tools),
      hasCompatibilityContext: true,
    };
  }

  function selectedToolName(toolId: string): string {
    return tools.find((tool) => tool.id === toolId)?.name ?? '';
  }

  function pickerInputValue(idx: number, toolId: string): string {
    return pickerOpenIdx === idx ? pickerQuery : selectedToolName(toolId);
  }

  function pickerOptionId(idx: number, toolId: string): string {
    return `chain-tool-${idx}-${toolId}`;
  }

  function activePickerOptionId(idx: number, ordered: ToolSummary[]): string | undefined {
    const active = ordered[activeOptionIdx];
    return active ? pickerOptionId(idx, active.id) : undefined;
  }

  async function scrollActiveOption(idx: number, ordered: ToolSummary[]) {
    const active = ordered[activeOptionIdx];
    if (!active) return;
    await tick();
    document.getElementById(pickerOptionId(idx, active.id))?.scrollIntoView({ block: 'nearest' });
  }

  async function openPicker(idx: number, input: HTMLInputElement) {
    pickerOpenIdx = idx;
    pickerQuery = '';
    const selectedId = steps[idx]?.toolId;
    const selectedIdx = buildPickerResults(idx).ordered.findIndex((tool) => tool.id === selectedId);
    activeOptionIdx = selectedIdx >= 0 ? selectedIdx : 0;
    await tick();
    input.select();
    void scrollActiveOption(idx, buildPickerResults(idx).ordered);
  }

  function closePicker(idx: number) {
    if (pickerOpenIdx !== idx) return;
    pickerOpenIdx = null;
    pickerQuery = '';
    activeOptionIdx = 0;
  }

  function onPickerFocusOut(idx: number, event: FocusEvent) {
    const next = event.relatedTarget;
    if (next instanceof Node && (event.currentTarget as HTMLElement).contains(next)) return;
    closePicker(idx);
  }

  function onPickerInput(idx: number, event: Event) {
    pickerOpenIdx = idx;
    pickerQuery = (event.currentTarget as HTMLInputElement).value;
    activeOptionIdx = 0;
  }

  function choosePickerTool(idx: number, tool: ToolSummary) {
    closePicker(idx);
    selectTool(idx, tool.id);
  }

  function onPickerKeydown(idx: number, event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (pickerOpenIdx === idx) {
        event.preventDefault();
        closePicker(idx);
      }
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;

    const input = event.currentTarget as HTMLInputElement;
    if (pickerOpenIdx !== idx) {
      if (event.key === 'Enter') return;
      event.preventDefault();
      void openPicker(idx, input);
      return;
    }

    const results = buildPickerResults(idx);
    if (results.ordered.length === 0) return;
    event.preventDefault();

    if (event.key === 'Enter') {
      const active = results.ordered[activeOptionIdx];
      if (active) choosePickerTool(idx, active);
      return;
    }

    const offset = event.key === 'ArrowDown' ? 1 : -1;
    activeOptionIdx = (activeOptionIdx + offset + results.ordered.length) % results.ordered.length;
    void scrollActiveOption(idx, results.ordered);
  }

  function addStep() {
    steps = [...steps, { toolId: '', params: {}, expanded: false }];
    stepStatuses = [...stepStatuses, 'pending'];
  }

  function removeStep(idx: number) {
    closePicker(idx);
    steps = steps.filter((_, i) => i !== idx);
    stepStatuses = stepStatuses.filter((_, i) => i !== idx);
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    closePicker(idx);
    const arr = [...steps];
    [arr[idx - 1], arr[idx]] = [arr[idx]!, arr[idx - 1]!];
    steps = arr;
  }

  function moveDown(idx: number) {
    if (idx === steps.length - 1) return;
    closePicker(idx);
    const arr = [...steps];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1]!, arr[idx]!];
    steps = arr;
  }

  function selectTool(idx: number, toolId: string) {
    const s = [...steps];
    s[idx] = { ...s[idx]!, toolId, params: getDefaults(toolId), expanded: false };
    steps = s;
    updateUrl();
  }

  function updateParams(idx: number, params: Record<string, unknown>) {
    const s = [...steps];
    s[idx] = { ...s[idx]!, params };
    steps = s;
    updateUrl();
  }

  function toggleExpand(idx: number) {
    const s = [...steps];
    s[idx] = { ...s[idx]!, expanded: !s[idx]!.expanded };
    steps = s;
  }

  $: validSteps = steps.filter((s) => s.toolId);
  $: canRun = validSteps.length > 0 && inputFile !== null && runState !== 'running';
  $: chainSpec = validSteps.map((s) => ({ toolId: s.toolId, params: s.params }));

  function updateUrl() {
    if (typeof window === 'undefined') return;
    const encoded = encodeChainSteps(chainSpec);
    const url = new URL(window.location.href);
    if (encoded) {
      url.searchParams.set('steps', encoded);
    } else {
      url.searchParams.delete('steps');
    }
    window.history.replaceState({}, '', url.toString());
  }

  onMount(() => {
    const url = new URL(window.location.href);
    const stepsParam = url.searchParams.get('steps');
    if (stepsParam) {
      const decoded = decodeChainSteps(stepsParam);
      if (decoded) {
        steps = decoded.map((d) => ({
          toolId: d.toolId,
          params: { ...getDefaults(d.toolId), ...d.params },
          expanded: false,
        }));
        stepStatuses = decoded.map(() => 'pending' as const);
      }
    }
  });

  onMount(() => {
    void import('@wyreup/core').then(({ createDefaultRegistry }) => {
      const registry = createDefaultRegistry();
      toolMetadata = new Map(Array.from(registry.toolsById.values()).map((tool) => [
        tool.id,
        { category: tool.category, keywords: tool.keywords },
      ]));
    }).catch(() => {
      // The picker remains usable with names and descriptions if metadata loading fails.
    });
  });

  async function run() {
    if (!canRun || !inputFile) return;
    runState = 'running';
    errorMsg = '';
    resultBlob = null;
    showEndOfRunPrompt = false;
    endOfRunSaved = false;
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
    stepStatuses = validSteps.map(() => 'pending' as const);

    try {
      const { runChain, createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const ac = new AbortController();
      const cache = new Map<string, unknown>();

      let currentStepIdx = 0;
      const chain = chainSpec;

      const result = await runChain(
        chain,
        [inputFile],
        {
          onProgress: (p) => {
            progress = p;
            const s = [...stepStatuses];
            s[currentStepIdx] = 'running';
            stepStatuses = s;
          },
          signal: ac.signal,
          cache,
          executionId: crypto.randomUUID(),
        },
        registry,
      );

      // Mark each step done sequentially after the run completes
      // (runChain is synchronous per-step so we mark all done)
      stepStatuses = validSteps.map(() => 'done' as const);

      const blobs = Array.isArray(result) ? result : [result];
      const blob = blobs[0];
      if (!blob) throw new Error('No output produced.');

      resultBlob = blob;
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = URL.createObjectURL(blob);
      runState = 'done';
      // Auto-show save prompt after successful run
      saveName = validSteps.map((s) => s.toolId).join('-');
      showEndOfRunPrompt = true;
    } catch (err) {
      runState = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function confirmEndOfRunSave() {
    if (!saveName.trim()) return;
    const now = new Date().toISOString();
    const chainId = crypto.randomUUID();
    saveChain({
      id: chainId,
      name: saveName.trim(),
      steps: chainSpec,
      createdAt: now,
      updatedAt: now,
    });
    if (registerAsTrigger) registerTriggerForChain(chainId, saveName.trim());
    endOfRunSaved = true;
    showEndOfRunPrompt = false;
  }

  function dismissEndOfRunPrompt() {
    showEndOfRunPrompt = false;
  }

  function reset() {
    runState = 'idle';
    errorMsg = '';
    resultBlob = null;
    if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
  }

  function download() {
    if (!resultUrl || !resultBlob) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    const ext = resultBlob.type.split('/')[1] ?? 'bin';
    a.download = `chain-result.${ext}`;
    a.click();
  }

  function shareChain() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      shareConfirm = true;
      if (shareTimer) clearTimeout(shareTimer);
      shareTimer = setTimeout(() => { shareConfirm = false; }, 1500);
    }).catch(() => {});
  }

  function openSaveDialog() {
    saveName = validSteps.map((s) => s.toolId).join(' → ');
    showSaveDialog = true;
  }

  function confirmSave() {
    if (!saveName.trim()) return;
    const now = new Date().toISOString();
    const chainId = crypto.randomUUID();
    saveChain({
      id: chainId,
      name: saveName.trim(),
      steps: chainSpec,
      createdAt: now,
      updatedAt: now,
    });
    if (registerAsTrigger) registerTriggerForChain(chainId, saveName.trim());
    showSaveDialog = false;
    saveConfirm = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveConfirm = false; }, 1500);
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }
</script>

<div class="chain-builder">
  <!-- Drop zone at top -->
  <DropZone
    accept={['*/*']}
    multiple={false}
    bind:files={inputFiles}
    bind:error={dropError}
    label="Drop input file or click to browse"
    on:files={(e) => {
      inputFiles = e.detail;
      dropError = '';
      reset();
    }}
  />

  <!-- Steps -->
  <div class="steps-stack">
    {#each steps as step, idx}
      {@const pickerResults = buildPickerResults(idx, pickerQuery, pickerOpenIdx)}
      <div class="step-card" class:step-card--error={stepStatuses[idx] === 'error'} class:step-card--done={stepStatuses[idx] === 'done'}>
        <div class="step-header">
          <span class="step-num">{String(idx + 1).padStart(2, '0')}</span>

          <!-- Tool selector -->
          <div class="tool-picker" on:focusout={(event) => onPickerFocusOut(idx, event)}>
            <input
              class="tool-picker__input"
              type="text"
              role="combobox"
              aria-label={`Search for a tool for step ${idx + 1}`}
              aria-autocomplete="list"
              aria-expanded={pickerOpenIdx === idx}
              aria-controls={`chain-tool-list-${idx}`}
              aria-activedescendant={pickerOpenIdx === idx
                ? activePickerOptionId(idx, pickerResults.ordered)
                : undefined}
              autocomplete="off"
              placeholder="Search tools…"
              value={pickerInputValue(idx, step.toolId)}
              on:focus={(event) => { void openPicker(idx, event.currentTarget); }}
              on:click={(event) => { if (pickerOpenIdx !== idx) void openPicker(idx, event.currentTarget); }}
              on:input={(event) => onPickerInput(idx, event)}
              on:keydown={(event) => onPickerKeydown(idx, event)}
            />

            {#if pickerOpenIdx === idx}
              <div class="tool-picker__dropdown" id={`chain-tool-list-${idx}`} role="listbox" aria-label={`Tools for step ${idx + 1}`}>
                {#if pickerResults.ordered.length === 0}
                  <p class="tool-picker__empty">No tools match “{pickerQuery}”.</p>
                {:else}
                  {#if pickerResults.hasCompatibilityContext && pickerResults.compatibleGroups.length > 0}
                    <div class="tool-picker__section-label">Compatible tools</div>
                  {/if}
                  {#each pickerResults.compatibleGroups as group}
                    <div class="tool-picker__group" role="group" aria-label={group.category}>
                      <div class="tool-picker__category">{group.category}</div>
                      {#each group.tools as tool}
                        <button
                          class="tool-picker__option"
                          class:tool-picker__option--active={pickerResults.ordered[activeOptionIdx]?.id === tool.id}
                          id={pickerOptionId(idx, tool.id)}
                          type="button"
                          role="option"
                          aria-selected={step.toolId === tool.id}
                          tabindex="-1"
                          on:mouseenter={() => { activeOptionIdx = pickerResults.ordered.findIndex((item) => item.id === tool.id); }}
                          on:mousedown|preventDefault
                          on:click={() => choosePickerTool(idx, tool)}
                        >
                          <span class="tool-picker__option-name">{tool.name}</span>
                          <span class="tool-picker__option-category">{getToolCategory(tool)}</span>
                        </button>
                      {/each}
                    </div>
                  {/each}

                  {#if pickerResults.otherGroups.length > 0}
                    <div class="tool-picker__divider" role="separator"><span>Won't accept this step's input</span></div>
                    {#each pickerResults.otherGroups as group}
                      <div class="tool-picker__group" role="group" aria-label={group.category}>
                        <div class="tool-picker__category">{group.category}</div>
                        {#each group.tools as tool}
                          <button
                            class="tool-picker__option tool-picker__option--incompatible"
                            id={pickerOptionId(idx, tool.id)}
                            type="button"
                            role="option"
                            aria-selected="false"
                            aria-disabled="true"
                            disabled
                            tabindex="-1"
                          >
                            <span class="tool-picker__option-name">{tool.name}</span>
                            <span class="tool-picker__option-category">{getToolCategory(tool)}</span>
                          </button>
                        {/each}
                      </div>
                    {/each}
                  {/if}
                {/if}
              </div>
            {/if}
          </div>

          <!-- Step status indicator -->
          {#if stepStatuses[idx] === 'done'}
            <span class="step-status step-status--done">done</span>
          {:else if stepStatuses[idx] === 'running'}
            <span class="step-status step-status--running">running</span>
          {/if}

          <div class="step-actions">
            {#if step.toolId && Object.keys(getDefaults(step.toolId)).length > 0}
              <button class="btn-ghost-sm" type="button" on:click={() => toggleExpand(idx)}>
                {step.expanded ? 'hide params' : 'params'}
              </button>
            {/if}
            <button class="btn-ghost-sm" type="button" on:click={() => moveUp(idx)} disabled={idx === 0} aria-label="Move step up">↑</button>
            <button class="btn-ghost-sm" type="button" on:click={() => moveDown(idx)} disabled={idx === steps.length - 1} aria-label="Move step down">↓</button>
            <button class="btn-ghost-sm btn-ghost-sm--danger" type="button" on:click={() => removeStep(idx)} aria-label="Remove step">×</button>
          </div>
        </div>

        <!-- Output type indicator -->
        {#if step.toolId}
          {@const mime = getOutputMime(step.toolId)}
          {#if mime}
            <div class="step-output-mime">
              <span class="solder-key">output</span>
              <span class="solder-rule" aria-hidden="true"></span>
              <span class="solder-pad" aria-hidden="true"></span>
              <span class="solder-val">{mime}</span>
            </div>
          {/if}
        {/if}

        <!-- Params form (collapsed by default) -->
        {#if step.expanded && step.toolId}
          <div class="step-params">
            <ParamsForm
              defaults={getDefaults(step.toolId)}
              paramSchema={getParamSchema(step.toolId)}
              params={step.params}
              on:change={(e) => updateParams(idx, e.detail)}
            />
          </div>
        {/if}
      </div>

      <!-- Connector between steps -->
      {#if idx < steps.length - 1}
        <div class="step-connector" aria-hidden="true">
          <span class="connector-line"></span>
          <span class="connector-node"></span>
          <span class="connector-line"></span>
        </div>
      {/if}
    {/each}

    <button class="btn-add-step" type="button" on:click={addStep}>
      + Add step
    </button>
  </div>

  <!-- Run button -->
  {#if steps.length > 0}
    <div class="run-row">
      <button
        class="btn-primary"
        type="button"
        on:click={run}
        disabled={!canRun}
      >
        {runState === 'running' ? 'Running...' : 'Run chain'}
      </button>

      {#if validSteps.length > 0}
        <button class="btn-secondary" type="button" on:click={shareChain}>
          Share
        </button>
        {#if shareConfirm}
          <span class="confirm-msg" aria-live="polite">Chain URL copied.</span>
        {/if}

        <button class="btn-secondary" type="button" on:click={openSaveDialog}>
          Save to Chains
        </button>
        {#if saveConfirm}
          <span class="confirm-msg" aria-live="polite">Saved.</span>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- Save dialog (manual trigger from run row) -->
  {#if showSaveDialog}
    <div class="save-dialog" role="dialog" aria-modal="true" aria-label="Save chain">
      <p class="save-dialog__label">Chain name</p>
      <input
        class="save-dialog__input"
        type="text"
        bind:value={saveName}
        placeholder="My chain"
        on:keydown={(e) => { if (e.key === 'Enter') confirmSave(); if (e.key === 'Escape') showSaveDialog = false; }}
      />

      <label class="trigger-toggle">
        <input type="checkbox" bind:checked={registerAsTrigger} />
        <span>Also register as a trigger rule</span>
      </label>
      {#if registerAsTrigger}
        <div class="trigger-fields">
          <p class="save-dialog__label">MIME pattern</p>
          <input
            class="save-dialog__input"
            type="text"
            bind:value={triggerMime}
            placeholder={triggerMimeSuggestion || 'application/pdf or image/*'}
          />
          <p class="trigger-hint">
            When a file of this type lands anywhere on Wyreup, the preview sheet will offer to run this chain. Preview-before-run is on by default — you can mark the rule "trusted" later in /toolbelt.
          </p>
        </div>
      {/if}

      <div class="save-dialog__actions">
        <button class="btn-primary" type="button" on:click={confirmSave} disabled={!saveName.trim() || (registerAsTrigger && !triggerMime.trim())}>Save</button>
        <button class="btn-ghost-sm" type="button" on:click={() => showSaveDialog = false}>Cancel</button>
      </div>
    </div>
  {/if}

  <!-- Progress -->
  {#if runState === 'running'}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
  {/if}

  <!-- Error -->
  {#if runState === 'error'}
    <div class="error-panel" role="alert">
      <span class="panel-label error-label">Error</span>
      <div class="panel-divider"></div>
      <p class="error-msg">{errorMsg}</p>
      <div class="panel-divider"></div>
      <button class="btn-secondary" type="button" on:click={reset}>Try again</button>
    </div>
  {/if}

  <!-- Result -->
  {#if runState === 'done' && resultBlob && resultUrl}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Result</span>
        </div>
        <div class="panel-divider"></div>

        {#if resultBlob.type.startsWith('image/')}
          <img class="result-img" src={resultUrl} alt="Chain result" />
        {:else}
          <div class="solder-row">
            <span class="solder-key">Output</span>
            <span class="solder-rule" aria-hidden="true"></span>
            <span class="solder-pad" aria-hidden="true"></span>
            <span class="solder-val">{resultBlob.type}</span>
          </div>
        {/if}

        <div class="solder-row">
          <span class="solder-key">Size</span>
          <span class="solder-rule" aria-hidden="true"></span>
          <span class="solder-pad" aria-hidden="true"></span>
          <span class="solder-val">{formatBytes(resultBlob.size)}</span>
        </div>

        <div class="panel-divider"></div>
        <div class="result-actions">
          <button class="btn-primary" type="button" on:click={download}>Download result</button>
          <button class="btn-secondary" type="button" on:click={openSaveDialog}>Save to Chains</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- End-of-run save prompt -->
  {#if showEndOfRunPrompt}
    <div class="end-save-prompt" role="region" aria-label="Save this chain">
      <p class="end-save-prompt__label">Save this chain to your toolbelt?</p>
      <div class="end-save-prompt__row">
        <input
          class="end-save-prompt__input"
          type="text"
          bind:value={saveName}
          placeholder="Chain name"
          aria-label="Chain name"
          on:keydown={(e) => { if (e.key === 'Enter') confirmEndOfRunSave(); if (e.key === 'Escape') dismissEndOfRunPrompt(); }}
        />
        <button class="btn-primary" type="button" on:click={confirmEndOfRunSave} disabled={!saveName.trim() || (registerAsTrigger && !triggerMime.trim())}>Save chain</button>
        <button class="btn-ghost-sm" type="button" on:click={dismissEndOfRunPrompt}>Skip</button>
      </div>

      <label class="trigger-toggle">
        <input type="checkbox" bind:checked={registerAsTrigger} />
        <span>Also register as a trigger rule</span>
      </label>
      {#if registerAsTrigger}
        <div class="trigger-fields">
          <p class="end-save-prompt__label">MIME pattern</p>
          <input
            class="end-save-prompt__input"
            type="text"
            bind:value={triggerMime}
            placeholder={triggerMimeSuggestion || 'application/pdf or image/*'}
          />
          <p class="trigger-hint">
            When a file of this type lands anywhere on Wyreup, the preview sheet will offer to run this chain. Preview-before-run is on by default.
          </p>
        </div>
      {/if}
    </div>
  {/if}

  {#if endOfRunSaved}
    <p class="end-save-confirm" aria-live="polite">Saved to your toolbelt. <a href="/toolbelt" class="end-save-link">View toolbelt</a></p>
  {/if}
</div>

<style>
  .chain-builder {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .steps-stack {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* Step card */
  .step-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    transition: border-color var(--duration-fast) var(--ease-sharp);
  }

  .step-card--done {
    border-color: var(--success);
  }

  .step-card--error {
    border-color: var(--danger);
  }

  .step-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .step-num {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--accent-text);
    font-weight: 700;
    letter-spacing: 0.08em;
    flex-shrink: 0;
    min-width: 24px;
  }

  .tool-picker {
    position: relative;
    flex: 1;
    min-width: 160px;
  }

  .tool-picker__input {
    width: 100%;
    height: 32px;
    box-sizing: border-box;
    padding: 0 var(--space-2);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    transition: border-color var(--duration-instant) var(--ease-sharp);
  }

  .tool-picker__input::placeholder {
    color: var(--text-subtle);
  }

  .tool-picker__input:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .tool-picker__dropdown {
    position: absolute;
    z-index: 20;
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
    max-height: 320px;
    overflow-y: auto;
    padding: var(--space-2);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  }

  .tool-picker__section-label,
  .tool-picker__category,
  .tool-picker__divider span {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .tool-picker__section-label {
    padding: var(--space-1) var(--space-2) var(--space-2);
    color: var(--text-subtle);
  }

  .tool-picker__group + .tool-picker__group {
    margin-top: var(--space-2);
  }

  .tool-picker__category {
    padding: var(--space-1) var(--space-2);
    color: var(--accent-text);
  }

  .tool-picker__option {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    width: 100%;
    min-height: 34px;
    padding: var(--space-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }

  .tool-picker__option:hover:not(:disabled),
  .tool-picker__option--active {
    background: var(--accent-dim);
  }

  .tool-picker__option--incompatible {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .tool-picker__option:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: -2px;
  }

  .tool-picker__option-name {
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-picker__option-category {
    flex-shrink: 0;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .tool-picker__divider {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-3) 0 var(--space-2);
    color: var(--text-subtle);
  }

  .tool-picker__divider::before,
  .tool-picker__divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border-subtle);
  }

  .tool-picker__empty {
    margin: 0;
    padding: var(--space-3);
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    text-align: center;
  }

  .step-status {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }

  .step-status--done { color: var(--success); }
  .step-status--running { color: var(--accent-text); }

  .step-actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin-left: auto;
    flex-shrink: 0;
  }

  .step-output-mime {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-left: 36px;
  }

  .step-params {
    padding-left: 36px;
  }

  /* Step connector */
  .step-connector {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    gap: 0;
  }

  .connector-line {
    display: block;
    width: 1px;
    height: 8px;
    background: var(--border);
  }

  .connector-node {
    display: block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-elevated);
    flex-shrink: 0;
  }

  /* Add step button */
  .btn-add-step {
    margin-top: var(--space-3);
    align-self: flex-start;
    background: none;
    border: 1px dashed var(--border);
    border-radius: var(--radius-md);
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    transition:
      color var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp);
  }

  .btn-add-step:hover {
    color: var(--text-muted);
    border-color: var(--text-subtle);
  }

  .btn-add-step:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  /* Run row */
  .run-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .confirm-msg {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--accent-text);
  }

  /* Save dialog */
  .save-dialog {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .save-dialog__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .save-dialog__input {
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .save-dialog__input:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .save-dialog__actions {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .trigger-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    cursor: pointer;
  }

  .trigger-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--bg-raised);
    border-radius: var(--radius-sm);
  }

  .trigger-hint {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    line-height: 1.5;
  }

  /* Buttons */
  .btn-primary {
    height: 32px;
    padding: 0 var(--space-3);
    background: var(--accent);
    color: var(--black);
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      transform var(--duration-instant) var(--ease-sharp);
  }

  .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn-primary:active:not(:disabled) { transform: scale(0.98); }
  .btn-primary:disabled {
    background: var(--bg-raised);
    color: var(--text-subtle);
    cursor: not-allowed;
  }
  .btn-primary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .btn-secondary {
    height: 32px;
    padding: 0 var(--space-3);
    background: transparent;
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      border-color var(--duration-instant) var(--ease-sharp);
  }

  .btn-secondary:hover { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }

  .btn-ghost-sm {
    background: none;
    border: none;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 0 var(--space-1);
    min-height: 24px;
    transition: color var(--duration-instant) var(--ease-sharp);
  }

  .btn-ghost-sm:hover { color: var(--text-muted); }
  .btn-ghost-sm:disabled { opacity: 0.3; cursor: not-allowed; }
  .btn-ghost-sm:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }
  .btn-ghost-sm--danger:hover { color: var(--danger); }

  /* Error panel */
  .error-panel {
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .panel-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .error-label { color: var(--danger); }

  .error-msg {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: 1.5;
  }

  .panel-divider {
    height: 1px;
    background: var(--border-subtle);
  }

  /* Result panel */
  .result-panel {
    position: relative;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
    overflow: visible;
  }

  .result-panel__inner {
    background: var(--bg-raised);
    border: 1px solid var(--border-subtle);
    border-radius: calc(var(--radius-md) - 1px);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .result-img {
    max-width: 100%;
    max-height: 400px;
    object-fit: contain;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    background: var(--bg);
    align-self: flex-start;
  }

  .result-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  /* Solder rows */
  .solder-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 20px;
  }

  .solder-key {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    min-width: 60px;
    flex-shrink: 0;
  }

  .solder-rule {
    flex: 1;
    height: 1px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .solder-pad {
    width: 3px;
    height: 3px;
    background: var(--border);
    flex-shrink: 0;
  }

  .solder-val {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: 500;
  }

  /* End-of-run save prompt */
  .end-save-prompt {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .end-save-prompt__label {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
  }

  .end-save-prompt__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .end-save-prompt__input {
    flex: 1;
    min-width: 160px;
    height: 32px;
    padding: 0 var(--space-2);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  .end-save-prompt__input:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }

  .end-save-confirm {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
  }

  .end-save-link {
    color: var(--accent-text);
    text-decoration: none;
  }

  .end-save-link:hover {
    text-decoration: underline;
  }

  /* Corner bracket motif */
  .brackets::before,
  .brackets::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }

  .brackets::before {
    top: -5px;
    left: -5px;
    border-top: 1px solid var(--accent-hover);
    border-left: 1px solid var(--accent-hover);
  }

  .brackets::after {
    bottom: -5px;
    right: -5px;
    border-bottom: 1px solid var(--accent-hover);
    border-right: 1px solid var(--accent-hover);
  }

  .brackets-inner {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .brackets-inner::before,
  .brackets-inner::after {
    content: '';
    position: absolute;
    width: 8px;
    height: 8px;
    pointer-events: none;
  }

  .brackets-inner::before {
    top: -5px;
    right: -5px;
    border-top: 1px solid var(--accent-hover);
    border-right: 1px solid var(--accent-hover);
  }

  .brackets-inner::after {
    bottom: -5px;
    left: -5px;
    border-bottom: 1px solid var(--accent-hover);
    border-left: 1px solid var(--accent-hover);
  }
</style>
