<script lang="ts">
  // Trigger rules runtime — the glue that ties the matcher + preview sheet
  // + chain executor together. Lives globally in BaseLayout so it sees
  // every dropped file that wasn't already handled by a specific tool.
  //
  // Security contract from docs/triggers-security.md:
  //  - G1: Preview before run (this component is the only path to chain
  //    execution from a trigger; no other code calls runChain off a
  //    matched rule).
  //  - G2: confirmed=true bypasses the sheet ONLY for that rule. The
  //    sheet still shows for high-severity pre-flight (G4 below).
  //  - G4: Suspicious pre-flight runs before the sheet renders Run.
  //  - G6: Output blobs are downloaded via the browser's standard
  //    save-as flow — never written to a server-shaped path.
  //  - G7: Fire history is recorded BEFORE the chain runs (so the rate
  //    limit applies to the user's CONFIRMED intent, not to whether
  //    the chain happened to succeed).

  import { onMount, onDestroy } from 'svelte';
  import { createDefaultRegistry, matchRule, runChain, runPreflight, validateChain, type TriggerRule, type Chain } from '@wyreup/core';
  import TriggerPreviewSheet from './TriggerPreviewSheet.svelte';
  import { getAllRules, getFires, recordFire, updateRule } from './runners/triggerStorage';
  import { getChain, type ToolbeltChain } from './runners/toolbeltStorage';

  // Reactive state for the currently-open sheet, if any.
  let pendingFile: File | null = null;
  let pendingRule: TriggerRule | null = null;
  let pendingChain: Chain | null = null;
  let pendingChainName = '';

  // Toast state (lightweight progress / result feedback).
  let toast: { kind: 'info' | 'success' | 'error'; text: string } | null = null;

  let registry: ReturnType<typeof createDefaultRegistry> | null = null;

  function showToast(kind: 'info' | 'success' | 'error', text: string, ttlMs = 4000) {
    toast = { kind, text };
    if (ttlMs > 0) {
      setTimeout(() => {
        toast = null;
      }, ttlMs);
    }
  }

  function toolbeltChainToChain(kc: ToolbeltChain): Chain {
    return kc.steps.map((s) => ({ toolId: s.toolId, params: s.params }));
  }

  async function handleDrop(event: Event) {
    const ce = event as CustomEvent<{ files: FileList }>;
    const files = ce.detail?.files;
    if (!files || files.length === 0) return;
    const file = files[0]!;

    const rules = getAllRules();
    const fires = getFires();
    const outcome = matchRule(file.type, rules, fires);

    if (outcome.kind === 'no-match') return;

    // We're claiming this file. Tell every other listener (HeroDrop,
    // ToolFilter, DropZone, share-receive's post-dispatch navigation)
    // to back off so we don't double-handle. Must be called synchronously
    // before any await per the dispatcher's contract.
    event.preventDefault();

    if (outcome.kind === 'rate-limited') {
      showToast(
        'error',
        `Rule "${outcome.rule.name}" rate-limited: ${outcome.recentFires} matches in ${Math.round(outcome.windowMs / 1000)}s. Drop again later.`,
        6000,
      );
      return;
    }

    const rule = outcome.rule;
    const savedChain = getChain(rule.chainId);
    if (!savedChain) {
      showToast(
        'error',
        `Rule "${rule.name}" points at a deleted chain. Edit it in /toolbelt.`,
        6000,
      );
      return;
    }

    const chain = toolbeltChainToChain(savedChain);

    // Spoof gate: if the saved chain references tool IDs that aren't in
    // the built-in registry, force the preview sheet open so the user
    // sees the "unknown tool" error before anything runs. confirmed=true
    // is bypassed only for VALID chains.
    if (!registry) registry = createDefaultRegistry();
    const validation = validateChain(chain, registry);

    // G2: confirmed=true skips the sheet, BUT G4 still gets a vote — we
    // run pre-flight first and force the sheet when verdict is 'high'.
    // Spoof gate also vetoes the bypass.
    if (rule.confirmed && validation.ok) {
      const verdict = await runPreflight(file).catch(() => ({ verdict: 'clean' as const }));
      if (verdict.verdict !== 'high') {
        await executeChain(file, rule, chain, savedChain.name);
        return;
      }
      // verdict 'high' — fall through to the preview sheet.
    }

    pendingFile = file;
    pendingRule = rule;
    pendingChain = chain;
    pendingChainName = savedChain.name;
  }

  async function executeChain(
    file: File,
    rule: TriggerRule,
    chain: Chain,
    chainName: string,
  ) {
    // G7: record the fire BEFORE running. The rate limit applies to
    // confirmed intent, not chain-success.
    recordFire(rule.id);

    showToast('info', `Running "${chainName}" on ${file.name}…`, 0);
    try {
      if (!registry) registry = createDefaultRegistry();
      const ctx = {
        onProgress: () => {},
        signal: new AbortController().signal,
        cache: new Map<string, unknown>(),
        executionId: crypto.randomUUID(),
      };
      const outputs = await runChain(chain, [file], ctx, registry);
      // G6: download each output via a synthetic anchor click so the
      // browser's save-as flow is the user-visible step.
      outputs.forEach((blob, i) => downloadBlob(blob, suggestOutputName(file.name, chainName, i, outputs.length)));
      showToast('success', `Done. ${outputs.length} file${outputs.length === 1 ? '' : 's'} downloaded.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `Chain failed: ${msg}`, 8000);
    }
  }

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }

  function suggestOutputName(inputName: string, chainName: string, idx: number, total: number): string {
    const dot = inputName.lastIndexOf('.');
    const base = dot > 0 ? inputName.slice(0, dot) : inputName;
    const tail = total > 1 ? `-${idx + 1}` : '';
    const safeChain = chainName.replace(/[^a-z0-9-]+/gi, '_');
    return `${base}__${safeChain}${tail}`;
  }

  function handleRun(event: CustomEvent<{ dontAskAgain: boolean }>) {
    if (!pendingFile || !pendingRule || !pendingChain) return;
    const { dontAskAgain } = event.detail;
    const file = pendingFile;
    const rule = pendingRule;
    const chain = pendingChain;
    const chainName = pendingChainName;

    // G2: only the per-rule "confirmed" flag is mutated, and only via
    // the updateRule path that hits coreUpdate (which itself enforces
    // the meaningful-edit invariant).
    if (dontAskAgain && !rule.confirmed) {
      updateRule(rule.id, { confirmed: true });
    }

    pendingFile = null;
    pendingRule = null;
    pendingChain = null;
    void executeChain(file, rule, chain, chainName);
  }

  function handleSkip() {
    pendingFile = null;
    pendingRule = null;
    pendingChain = null;
  }

  function handleDisable() {
    if (!pendingRule) return;
    updateRule(pendingRule.id, { enabled: false });
    showToast('info', `Disabled rule "${pendingRule.name}".`);
    pendingFile = null;
    pendingRule = null;
    pendingChain = null;
  }

  onMount(() => {
    document.addEventListener('wyreup:filedrop', handleDrop as EventListener);
  });

  onDestroy(() => {
    if (typeof document === 'undefined') return;
    document.removeEventListener('wyreup:filedrop', handleDrop as EventListener);
  });
</script>

{#if pendingFile && pendingRule && pendingChain}
  <TriggerPreviewSheet
    file={pendingFile}
    rule={pendingRule}
    chain={pendingChain}
    on:run={handleRun}
    on:skip={handleSkip}
    on:disable={handleDisable}
  />
{/if}

{#if toast}
  <div class="trigger-toast trigger-toast--{toast.kind}" role="status" aria-live="polite">
    {toast.text}
  </div>
{/if}

<style>
  .trigger-toast {
    position: fixed;
    bottom: var(--space-4);
    left: 50%;
    transform: translateX(-50%);
    z-index: 1100;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-left-width: 4px;
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    max-width: 480px;
  }
  .trigger-toast--info { border-left-color: var(--accent); }
  .trigger-toast--success { border-left-color: #2a5; }
  .trigger-toast--error { border-left-color: var(--danger, #d22); }
</style>
