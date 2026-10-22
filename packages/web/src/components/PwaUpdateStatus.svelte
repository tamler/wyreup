<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { observePwaUpdate, type PwaUpdateStatus } from '../lib/pwaUpdate';

  let status: PwaUpdateStatus | null = null;
  let observer: ReturnType<typeof observePwaUpdate> | null = null;
  onMount(() => {
    observer = observePwaUpdate((value) => { status = value; });
  });
  onDestroy(() => observer?.dispose());
</script>

<section aria-label="Update check">
  <p role="status" aria-live="polite">{status?.message ?? 'Checking is available after this page loads.'}</p>
  <button type="button" disabled={!observer || status?.checking} on:click={() => { void observer?.check(); }}>Check for update</button>
</section>

<style>
  section { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid currentColor; }
  button { padding: .6rem 1rem; font: inherit; cursor: pointer; }
  button:disabled { cursor: default; }
</style>
