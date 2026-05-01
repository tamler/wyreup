<script lang="ts">
  import DropZone from './DropZone.svelte';
  import ProgressBar from './ProgressBar.svelte';
  import { buildDownloadName } from './naming';
  import { markToolUsed } from '../../lib/toolUsage';
  import type { SerializedTool } from './types';
  import type { ToolProgress } from '@wyreup/core';

  // zip-info renders the JSON output as a navigable file tree with
  // expandable folders, per-entry sizes, compression ratio, and
  // a summary card. Beats reading the raw JSON.

  export let tool: SerializedTool;
  export let preloadedFile: File | null = null;

  interface ZipEntry {
    path: string;
    size: number;
    compressedSize: number;
    modified: string;
    isDirectory: boolean;
  }

  interface ZipResult {
    entries: number;
    totalUncompressed: number;
    totalCompressed: number;
    compressionRatio: number;
    files: ZipEntry[];
  }

  interface TreeNode {
    name: string;
    fullPath: string;
    children: TreeNode[];
    isDir: boolean;
    size: number;
    compressedSize: number;
    modified: string | null;
  }

  let files: File[] = preloadedFile ? [preloadedFile] : [];
  let dropError = '';
  type State = 'idle' | 'running' | 'done' | 'error';
  let state: State = 'idle';
  let progress: ToolProgress = { stage: 'processing', percent: 0, message: '' };
  let errorMsg = '';
  let result: ZipResult | null = null;
  let resultBlob: Blob | null = null;
  let tree: TreeNode | null = null;
  let expanded = new Set<string>();

  $: if (preloadedFile && files.length === 0) files = [preloadedFile];
  $: canRun = files.length >= 1 && state !== 'running';

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function fmtDate(s: string | null): string {
    if (!s) return '';
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString();
  }

  function buildTree(entries: ZipEntry[]): TreeNode {
    const root: TreeNode = {
      name: '',
      fullPath: '',
      children: [],
      isDir: true,
      size: 0,
      compressedSize: 0,
      modified: null,
    };
    const lookup = new Map<string, TreeNode>();
    lookup.set('', root);

    // Sort so directories with shorter paths appear first; ensures parents
    // get created before children.
    const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
    for (const entry of sorted) {
      const parts = entry.path.split('/').filter(Boolean);
      if (parts.length === 0) continue;
      let cur = root;
      for (let i = 0; i < parts.length; i++) {
        const name = parts[i] ?? '';
        const isLast = i === parts.length - 1;
        const fullPath = parts.slice(0, i + 1).join('/');
        let next = lookup.get(fullPath);
        if (!next) {
          next = {
            name,
            fullPath,
            children: [],
            isDir: !isLast || entry.isDirectory,
            size: 0,
            compressedSize: 0,
            modified: null,
          };
          lookup.set(fullPath, next);
          cur.children.push(next);
        }
        if (isLast && !entry.isDirectory) {
          next.isDir = false;
          next.size = entry.size;
          next.compressedSize = entry.compressedSize;
          next.modified = entry.modified;
        }
        cur = next;
      }
    }

    const summarize = (n: TreeNode): { size: number; compressed: number } => {
      if (!n.isDir) return { size: n.size, compressed: n.compressedSize };
      let s = 0;
      let c = 0;
      for (const child of n.children) {
        const r = summarize(child);
        s += r.size;
        c += r.compressed;
      }
      n.size = s;
      n.compressedSize = c;
      // Sort children: directories first, then files, alpha within each.
      n.children.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return { size: s, compressed: c };
    };
    summarize(root);
    return root;
  }

  function toggle(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expanded = next;
  }

  function onFiles(e: CustomEvent<File[]>) {
    files = e.detail;
    dropError = '';
    state = 'idle';
    result = null;
    resultBlob = null;
    tree = null;
    expanded = new Set();
  }

  async function run() {
    if (!canRun) return;
    state = 'running';
    errorMsg = '';
    try {
      const { createDefaultRegistry } = await import('@wyreup/core');
      const registry = createDefaultRegistry();
      const toolModule = registry.toolsById.get(tool.id);
      if (!toolModule) throw new Error(`Tool "${tool.id}" not found in registry.`);
      const blobs = await toolModule.run(
        files,
        {},
        {
          onProgress: (p) => {
            progress = p;
          },
          signal: new AbortController().signal,
          cache: new Map(),
          executionId: crypto.randomUUID(),
        },
      );
      const blob = Array.isArray(blobs) ? blobs[0] : blobs;
      if (!blob) throw new Error('No output produced.');
      resultBlob = blob;
      result = JSON.parse(await blob.text()) as ZipResult;
      tree = buildTree(result.files);
      // Auto-expand the first level so the contents are visible without a click.
      expanded = new Set(tree.children.filter((c) => c.isDir).map((c) => c.fullPath));
      markToolUsed(tool.id);
      state = 'done';
    } catch (err) {
      state = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function reset() {
    state = 'idle';
    errorMsg = '';
    result = null;
    resultBlob = null;
    tree = null;
    expanded = new Set();
  }

  function downloadJson() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    a.download = buildDownloadName(files[0]?.name, tool.id, 'json');
    a.click();
  }

  function expandAll() {
    if (!tree) return;
    const all = new Set<string>();
    const visit = (n: TreeNode) => {
      if (n.isDir && n.fullPath) all.add(n.fullPath);
      for (const c of n.children) visit(c);
    };
    visit(tree);
    expanded = all;
  }

  function collapseAll() {
    expanded = new Set();
  }

  // Flatten the (visible portion of the) tree to a row list. Avoids template
  // recursion, which Svelte 4 doesn't support cleanly without a separate
  // self-importing component file.
  $: rows = tree ? flattenVisible(tree, expanded) : [];

  function flattenVisible(
    root: TreeNode,
    open: Set<string>,
  ): { node: TreeNode; depth: number }[] {
    const out: { node: TreeNode; depth: number }[] = [];
    const walk = (n: TreeNode, depth: number) => {
      if (n !== root) out.push({ node: n, depth });
      if (n === root || (n.isDir && open.has(n.fullPath))) {
        for (const c of n.children) walk(c, depth + 1);
      }
    };
    walk(root, -1);
    return out;
  }
</script>

<div class="runner">
  <DropZone
    accept={tool.input.accept}
    multiple={false}
    bind:files
    bind:error={dropError}
    on:files={onFiles}
  />

  {#if state !== 'running'}
    <button class="btn-primary" on:click={run} disabled={!canRun} type="button">
      {state === 'done' ? `Run ${tool.name} again` : `Run ${tool.name}`}
    </button>
  {/if}

  {#if state === 'running'}
    <ProgressBar stage={progress.stage} percent={progress.percent} message={progress.message} />
  {/if}

  {#if state === 'error'}
    <div class="error-panel" role="alert">
      <div class="panel-header">
        <span class="panel-label error-label">Error</span>
      </div>
      <div class="panel-divider"></div>
      <p class="error-msg">{errorMsg}</p>
      <div class="panel-divider"></div>
      <button class="btn-secondary" on:click={reset} type="button">Try again</button>
    </div>
  {/if}

  {#if state === 'done' && result && tree}
    <div class="result-panel brackets">
      <div class="brackets-inner" aria-hidden="true"></div>
      <div class="result-panel__inner">
        <div class="panel-header">
          <span class="panel-label">Archive contents</span>
        </div>
        <div class="panel-divider"></div>

        <div class="stat-grid">
          <div class="stat-cell">
            <span class="stat-label">Entries</span>
            <span class="stat-val">{result.entries.toLocaleString()}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">Uncompressed</span>
            <span class="stat-val">{fmtBytes(result.totalUncompressed)}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">Compressed</span>
            <span class="stat-val">{fmtBytes(result.totalCompressed)}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">Ratio</span>
            <span class="stat-val">{result.compressionRatio.toFixed(1)}%</span>
          </div>
        </div>

        <div class="panel-divider"></div>

        <div class="tree-controls">
          <span class="panel-label">Files</span>
          <div class="tree-control-actions">
            <button class="btn-tiny" type="button" on:click={expandAll}>Expand all</button>
            <button class="btn-tiny" type="button" on:click={collapseAll}>Collapse all</button>
          </div>
        </div>

        <div class="tree" role="tree">
          <ul class="tree-list" role="group">
            {#each rows as row (row.node.fullPath)}
              <li
                class="tree-row"
                class:tree-row--dir={row.node.isDir}
                style="--depth: {row.depth}"
                role="treeitem"
                aria-expanded={row.node.isDir ? expanded.has(row.node.fullPath) : undefined}
              >
                {#if row.node.isDir}
                  <button
                    class="tree-toggle"
                    type="button"
                    on:click={() => toggle(row.node.fullPath)}
                    aria-label={expanded.has(row.node.fullPath) ? 'Collapse' : 'Expand'}
                  >
                    <span
                      class="tree-chevron"
                      class:tree-chevron--open={expanded.has(row.node.fullPath)}
                    >›</span>
                    <span class="tree-name">{row.node.name}/</span>
                    <span class="tree-meta">
                      {row.node.children.length} item{row.node.children.length === 1 ? '' : 's'}
                    </span>
                    <span class="tree-size">{fmtBytes(row.node.size)}</span>
                  </button>
                {:else}
                  <div class="tree-leaf">
                    <span class="tree-spacer" aria-hidden="true"></span>
                    <span class="tree-name">{row.node.name}</span>
                    {#if row.node.modified}
                      <span class="tree-meta tree-meta--date">{fmtDate(row.node.modified)}</span>
                    {/if}
                    <span class="tree-size">{fmtBytes(row.node.size)}</span>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </div>

        <div class="panel-divider"></div>
        <div class="result-actions">
          <button class="btn-secondary" on:click={downloadJson} type="button">
            Download JSON
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .runner {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

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
    align-self: flex-start;
    transition:
      background var(--duration-instant) var(--ease-sharp),
      transform var(--duration-instant) var(--ease-sharp);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .btn-primary:active:not(:disabled) {
    transform: scale(0.98);
  }
  .btn-primary:disabled {
    background: var(--bg-raised);
    color: var(--text-subtle);
    cursor: not-allowed;
  }
  .btn-primary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

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
    align-self: flex-start;
  }

  .btn-secondary:hover {
    background: var(--bg-raised);
    border-color: var(--text-muted);
  }

  .btn-tiny {
    height: 22px;
    padding: 0 var(--space-2);
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }

  .btn-tiny:hover {
    background: var(--bg-raised);
    color: var(--text-primary);
  }

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

  .error-label {
    color: var(--danger);
  }
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

  .result-panel {
    position: relative;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1px;
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

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-3);
  }

  .stat-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
  }

  .stat-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle);
  }

  .stat-val {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .tree-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .tree-control-actions {
    display: flex;
    gap: var(--space-2);
  }

  .tree {
    max-height: 480px;
    overflow-y: auto;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    padding: var(--space-2);
  }

  .tree-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .tree-row {
    --indent: calc(var(--depth, 0) * 16px);
  }

  .tree-toggle,
  .tree-leaf {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 4px var(--space-2) 4px calc(var(--indent) + var(--space-2));
    background: transparent;
    border: none;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
  }

  .tree-toggle {
    cursor: pointer;
  }

  .tree-toggle:hover {
    background: var(--bg-raised);
  }

  .tree-toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .tree-chevron {
    display: inline-block;
    width: 12px;
    color: var(--text-subtle);
    transition: transform var(--duration-instant) var(--ease-sharp);
  }

  .tree-chevron--open {
    transform: rotate(90deg);
  }

  .tree-spacer {
    width: 12px;
    flex-shrink: 0;
  }

  .tree-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-meta {
    color: var(--text-subtle);
    font-size: var(--text-xs);
    flex-shrink: 0;
  }

  .tree-meta--date {
    min-width: 80px;
    text-align: right;
  }

  .tree-size {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    min-width: 70px;
    text-align: right;
    flex-shrink: 0;
  }

  .tree-row--dir > .tree-toggle .tree-name {
    color: var(--text-primary);
  }

  .result-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

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
    border-top: 1px solid var(--accent);
    border-left: 1px solid var(--accent);
  }
  .brackets::after {
    bottom: -5px;
    right: -5px;
    border-bottom: 1px solid var(--accent);
    border-right: 1px solid var(--accent);
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
    border-top: 1px solid var(--accent);
    border-right: 1px solid var(--accent);
  }
  .brackets-inner::after {
    bottom: -5px;
    left: -5px;
    border-bottom: 1px solid var(--accent);
    border-right: 1px solid var(--accent);
  }
</style>
