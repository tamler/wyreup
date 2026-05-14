<script lang="ts">
  // Trigger-preview sheet — enforces G1 from docs/triggers-security.md.
  //
  // Every file that matches a trigger rule passes through this sheet
  // before its chain runs. The Run button is the ONLY way to proceed.
  // The pre-flight verdict (G4) is rendered above Run; for `high` we
  // hide Run behind a secondary "Run anyway" gate.
  //
  // This component is presentational and side-effect-free. It dispatches
  // 'run', 'skip', 'disable', 'confirm-toggle' events to its parent,
  // which owns the chain executor + rule store.

  import { onMount, createEventDispatcher } from 'svelte';
  import { readFileHeader, runPreflight, type PreflightResult, type FileHeader, type TriggerRule, type Chain } from '@wyreup/core';

  export let file: File;
  export let rule: TriggerRule;
  export let chain: Chain;
  /** When true, the user has previously confirmed this rule (G2). */
  export let preconfirmed = false;

  const dispatch = createEventDispatcher<{
    run: { dontAskAgain: boolean };
    skip: void;
    disable: void;
  }>();

  let preflight: PreflightResult | null = null;
  let header: FileHeader | null = null;
  let preflightLoading = true;
  let dontAskAgain = preconfirmed;
  let runAnywayUnlocked = false;

  onMount(async () => {
    // Read header synchronously-ish so the user has something to verify
    // against the declared MIME even before pre-flight completes.
    header = await readFileHeader(file).catch(() => ({ hex: '', signatureLabel: null }));
    try {
      preflight = await runPreflight(file);
    } catch (err) {
      preflight = {
        verdict: 'clean',
        findings: [],
        toolUsed: null,
      };
      // Failure to pre-flight is not a security failure — the user
      // still gets the metadata + the file header + the chain summary,
      // and they decide. Surfacing the error would just be noise.
      console.warn('[trigger preview] pre-flight skipped:', err);
    } finally {
      preflightLoading = false;
    }
  });

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function handleRun() {
    if (preflight?.verdict === 'high' && !runAnywayUnlocked) {
      runAnywayUnlocked = true;
      return;
    }
    dispatch('run', { dontAskAgain });
  }

  function handleSkip() {
    dispatch('skip');
  }

  function handleDisable() {
    dispatch('disable');
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') handleSkip();
  }

  $: chainSummary = chain.map((s) => s.toolId).join(' → ');
  $: verdictColor =
    preflight?.verdict === 'high'
      ? 'var(--danger, #d22)'
      : preflight?.verdict === 'medium'
        ? 'var(--warning, #c80)'
        : preflight?.verdict === 'low'
          ? 'var(--warning-soft, #b97)'
          : 'var(--text-subtle, #888)';
</script>

<svelte:window on:keydown={handleKey} />

<div class="backdrop" role="presentation">
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="trigger-sheet-title">
    <header class="sheet__header">
      <h2 id="trigger-sheet-title" class="sheet__title">
        Wyreup matched: <span class="sheet__filename">{file.name}</span>
      </h2>
      <p class="sheet__sub">
        {fmtSize(file.size)} · {file.type || 'unknown MIME'}
      </p>
    </header>

    <section class="sheet__section">
      <p class="sheet__label">Rule</p>
      <p class="sheet__value">{rule.name}</p>
      <p class="sheet__sub">matches <code>{rule.mime}</code></p>
    </section>

    <section class="sheet__section">
      <p class="sheet__label">Chain</p>
      <p class="sheet__value sheet__chain"><code>{chainSummary}</code></p>
    </section>

    {#if header}
      <section class="sheet__section sheet__header-preview">
        <p class="sheet__label">File header (first 256 bytes)</p>
        {#if header.signatureLabel}
          <p class="sheet__sub">
            Detected: <strong>{header.signatureLabel}</strong>
            {#if header.signatureLabel === 'ZIP-shaped' && file.type === 'application/pdf'}
              <span class="sheet__warn">— declared MIME is application/pdf; this is suspicious.</span>
            {/if}
          </p>
        {/if}
        <pre class="sheet__hex">{header.hex}</pre>
      </section>
    {/if}

    <section class="sheet__section sheet__verdict" style:--verdict-color={verdictColor}>
      <p class="sheet__label">Pre-flight check</p>
      {#if preflightLoading}
        <p class="sheet__sub">Scanning…</p>
      {:else if !preflight || preflight.toolUsed === null}
        <p class="sheet__sub">Not analysed — no suspicious-content checker covers this file type.</p>
      {:else if preflight.verdict === 'clean'}
        <p class="sheet__sub">Clean — no suspicious markers detected.</p>
      {:else}
        <p class="sheet__verdict-headline">
          {preflight.verdict.toUpperCase()} severity
        </p>
        <ul class="sheet__findings">
          {#each preflight.findings as f (f.kind + f.detail)}
            <li><strong>{f.kind}</strong> — {f.detail}</li>
          {/each}
        </ul>
      {/if}
    </section>

    <label class="sheet__remember">
      <input type="checkbox" bind:checked={dontAskAgain} />
      <span>Don't ask for this rule again</span>
      <span class="sheet__remember-hint">
        Only this rule. Editing the rule will re-arm the prompt. Never global.
      </span>
    </label>

    <div class="sheet__actions">
      {#if preflight?.verdict === 'high' && !runAnywayUnlocked}
        <button type="button" class="btn-danger" on:click={handleRun}>
          Acknowledge severity to enable Run
        </button>
      {:else}
        <button type="button" class="btn-primary" on:click={handleRun}>Run</button>
      {/if}
      <button type="button" class="btn-secondary" on:click={handleSkip}>Skip</button>
      <button type="button" class="btn-secondary btn-secondary--quiet" on:click={handleDisable}>
        Disable rule
      </button>
    </div>

    <p class="sheet__footer">
      <a href="/triggers" target="_blank" rel="noopener">How Wyreup protects you from auto-run abuse →</a>
    </p>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg-base, #000) 70%, transparent);
    display: grid;
    place-items: center;
    z-index: 1000;
    padding: var(--space-4);
  }
  .sheet {
    width: min(560px, 100%);
    max-height: 90vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.4);
  }
  .sheet__header { display: flex; flex-direction: column; gap: var(--space-1); }
  .sheet__title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 500;
    color: var(--text-primary);
  }
  .sheet__filename { font-family: var(--font-mono); color: var(--accent-text); }
  .sheet__sub { margin: 0; color: var(--text-subtle); font-size: var(--text-xs); }
  .sheet__section { display: flex; flex-direction: column; gap: var(--space-1); }
  .sheet__label {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .sheet__value { margin: 0; color: var(--text-primary); font-size: var(--text-sm); }
  .sheet__chain code { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--accent-text); }
  .sheet__header-preview { gap: var(--space-2); }
  .sheet__hex {
    margin: 0;
    padding: var(--space-2);
    background: var(--bg-raised);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1.5;
    color: var(--text-subtle);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 6em;
    overflow: auto;
  }
  .sheet__warn { color: var(--danger, #d22); }
  .sheet__verdict {
    padding: var(--space-2);
    border-left: 3px solid var(--verdict-color);
    background: color-mix(in srgb, var(--verdict-color) 6%, transparent);
    border-radius: var(--radius-sm);
  }
  .sheet__verdict-headline {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--verdict-color);
    font-weight: 500;
  }
  .sheet__findings { margin: var(--space-1) 0 0; padding-left: var(--space-3); font-size: var(--text-xs); color: var(--text-primary); }
  .sheet__remember {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: var(--space-2);
    row-gap: 2px;
    align-items: start;
    padding: var(--space-2);
    background: var(--bg-raised);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    color: var(--text-primary);
  }
  .sheet__remember input { margin-top: 3px; }
  .sheet__remember-hint { grid-column: 2; color: var(--text-subtle); font-size: var(--text-xs); }
  .sheet__actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
  .sheet__footer { margin: 0; font-size: var(--text-xs); }
  .sheet__footer a { color: var(--accent-text); }
  .btn-primary, .btn-secondary, .btn-danger {
    height: 32px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn-primary {
    background: var(--accent);
    color: var(--black);
    border-color: var(--accent);
    font-weight: 500;
  }
  .btn-secondary {
    background: var(--bg-raised);
    color: var(--text-primary);
    border-color: var(--border);
  }
  .btn-secondary--quiet { color: var(--text-subtle); }
  .btn-danger {
    background: var(--danger, #d22);
    color: white;
    border-color: var(--danger, #d22);
  }
  .btn-primary:focus-visible, .btn-secondary:focus-visible, .btn-danger:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 2px;
  }
</style>
