<script lang="ts">
  import { createShareLink } from '../../lib/shareLinks';

  export let toolId: string;
  export let text: string;

  let state: 'idle' | 'busy' | 'done' | 'error' = 'idle';
  let url = '';
  let expiresAt = 0;
  let message = '';
  let copied = false;

  // A new result invalidates any link made for the previous one.
  $: text, reset();

  function reset() {
    state = 'idle';
    url = '';
    message = '';
    copied = false;
  }

  async function create() {
    state = 'busy';
    message = '';
    try {
      const link = await createShareLink(toolId, text);
      url = link.url;
      expiresAt = link.expiresAt;
      state = 'done';
    } catch (err) {
      message = err instanceof Error ? err.message : 'Could not create a link.';
      state = 'error';
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      message = 'Copy failed. Select the link and copy it by hand.';
    }
  }

  const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
</script>

<div class="share">
  {#if state === 'done'}
    <label class="share__label" for="share-url">Share link</label>
    <div class="share__row">
      <input id="share-url" class="share__url" type="text" readonly value={url} on:focus={(e) => e.currentTarget.select()} />
      <button class="btn-secondary" type="button" on:click={copy}>{copied ? 'Copied' : 'Copy link'}</button>
    </div>
    <p class="share__note">Anyone with this link can read the text until {day(expiresAt)}. Delete it any time from your account page.</p>
  {:else}
    <button class="btn-secondary" type="button" on:click={create} disabled={state === 'busy'}>
      {state === 'busy' ? 'Creating link…' : 'Create a share link'}
    </button>
    <p class="share__note">
      Saves this text on Wyreup so anyone with the link can read it for 30 days. Nothing is stored unless you click.
    </p>
  {/if}
  {#if message}<p class="share__error" role="alert">{message}</p>{/if}
</div>

<style>
  .share { display: grid; gap: var(--space-2); margin-top: var(--space-4); }
  .share__label { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); }
  .share__row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .share__url {
    flex: 1 1 16rem;
    min-width: 0;
    height: 32px;
    padding: 0 var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .share__note, .share__error { margin: 0; font-size: var(--text-xs); color: var(--text-muted); line-height: 1.5; }
  .share__error { color: var(--danger-text); }
  .btn-secondary {
    justify-self: start;
    height: 32px;
    padding: 0 var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .btn-secondary:hover:not(:disabled) { background: var(--bg-raised); border-color: var(--text-muted); }
  .btn-secondary:disabled { opacity: 0.6; cursor: default; }
  .btn-secondary:focus-visible, .share__url:focus-visible { outline: 2px solid var(--accent-hover); outline-offset: 2px; }
</style>
