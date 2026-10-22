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
  import { get } from 'svelte/store';
  import { user, authReady } from '../stores/user';
  import { tryReserveMediaJob } from '../lib/mediaJobReservation';
  import { summarizePaidChain, assertPaidAccount } from '../lib/chainPaidConsent';
import { createDefaultRegistry, matchRule, runChain, runPreflight, validateChain, type TriggerRule, type Chain } from '@wyreup/core/execution';
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
  let disposed = false;
  const downloadUrls = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function showToast(kind: 'info' | 'success' | 'error', text: string, ttlMs = 4000) {
    toast = { kind, text };
    if (ttlMs > 0) {
      const timer = setTimeout(() => {
        toast = null;
        timers.delete(timer);
      }, ttlMs);
      timers.add(timer);
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

    // G5: chains containing Pro tools send file contents to wyreup.com
    // server-side. The destination is first-party and the user opted into
    // the rule + the chain, but they should SEE the disclosure on every
    // fire — so confirmed-bypass is disabled for any chain with a Pro
    // step. Same pattern as G4 forcing the sheet on high-suspicion files.
    const hasProTool = chain.some((step) => registry.toolsById.get(step.toolId)?.cost === 'credit');

    // G2: confirmed=true skips the sheet, BUT G4 still gets a vote — we
    // run pre-flight first and force the sheet when verdict is 'high'.
    // Spoof gate AND Pro-tool gate also veto the bypass.
    if (rule.confirmed && validation.ok && !hasProTool) {
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
    paidConsent: { fingerprint: string; accountEmail: string | null } | null = null,
  ) {
    const capturedChain = structuredClone(chain);
    const lease = tryReserveMediaJob(capturedChain.map((step) => step.toolId));
    if (!lease) {
      pendingFile = file; pendingRule = rule; pendingChain = capturedChain; pendingChainName = chainName;
      showToast('error', 'Another media job is still running. Original retained; choose Run again after it settles. If it never settles, reload manually.', 8000);
      return;
    }
    // G7: record the fire BEFORE running. The rate limit applies to
    // confirmed intent, not chain-success.
    try {
      if (!registry) registry = createDefaultRegistry();
      const paid = summarizePaidChain(capturedChain, registry);
      const account = get(user);
      assertPaidAccount(paid, get(authReady), account);
      if (paid.steps.length && (!paidConsent || paidConsent.fingerprint !== JSON.stringify(paid) || paidConsent.accountEmail !== account?.email)) throw new Error('Confirm the current paid steps and account for this file before running.');
      if (disposed) return;
      recordFire(rule.id);
      showToast('info', `Running "${chainName}" on ${file.name}…`, 0);
      const ctx = {
        onProgress: () => {},
        signal: new AbortController().signal,
        cache: new Map<string, unknown>(),
        executionId: crypto.randomUUID(),
      };
      const outputs = await runChain(capturedChain, [file], ctx, registry);
      if (disposed) return;
      // G6: download each output via a synthetic anchor click so the
      // browser's save-as flow is the user-visible step.
      outputs.forEach((blob, i) => downloadBlob(blob, suggestOutputName(file.name, chainName, i, outputs.length)));
      showToast('success', `Done. ${outputs.length} file${outputs.length === 1 ? '' : 's'} downloaded.`);
    } catch (err) {
      if (disposed) return;
      const msg = err instanceof Error ? err.message : String(err);
      showToast('error', `Chain failed: ${msg}`, 8000);
      pendingFile = file; pendingRule = rule; pendingChain = capturedChain; pendingChainName = chainName;
    } finally {
      lease.release();
    }
  }

  function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    downloadUrls.add(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); timers.delete(timer); }, 2_000);
    timers.add(timer);
  }

  function suggestOutputName(inputName: string, chainName: string, idx: number, total: number): string {
    const dot = inputName.lastIndexOf('.');
    const base = dot > 0 ? inputName.slice(0, dot) : inputName;
    const tail = total > 1 ? `-${idx + 1}` : '';
    const safeChain = chainName.replace(/[^a-z0-9-]+/gi, '_');
    return `${base}__${safeChain}${tail}`;
  }

  function handleRun(event: CustomEvent<{ dontAskAgain: boolean; file: File; chainFingerprint: string; paidFingerprint: string; accountEmail: string | null }>) {
    if (!pendingFile || !pendingRule || !pendingChain) return;
    if (event.detail.file !== pendingFile || event.detail.chainFingerprint !== JSON.stringify(pendingChain)) return;
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
    void executeChain(file, rule, chain, chainName, { fingerprint: event.detail.paidFingerprint, accountEmail: event.detail.accountEmail });
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
    disposed = true;
    for (const url of downloadUrls) URL.revokeObjectURL(url);
    for (const timer of timers) clearTimeout(timer);
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
