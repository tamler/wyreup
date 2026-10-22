<script lang="ts">
  import { onDestroy } from 'svelte';
  import FlatJsonResult from './FlatJsonResult.svelte';
  export let json = '';
  let page = 0;
  let previous = '';
  const urls = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  function read(text: string): Record<string, unknown>[] | null {
    try {
      const data: unknown = JSON.parse(text);
      if (!data || typeof data !== 'object' || !('subnets' in data) || !Array.isArray(data.subnets)) return null;
      return data.subnets.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row));
    } catch { return null; }
  }
  function clearUrls() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); for (const timer of timers) clearTimeout(timer); timers.clear(); }
  function download() {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    urls.add(url);
    const link = document.createElement('a'); link.href = url; link.download = 'ipv4-subnets.json'; link.click();
    const timer = setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); timers.delete(timer); }, 1000); timers.add(timer);
  }
  $: rows = read(json);
  $: pages = Math.max(1, Math.ceil((rows?.length ?? 0) / 25));
  $: if (json !== previous) { previous = json; page = 0; clearUrls(); }
  onDestroy(clearUrls);
</script>

{#if rows}
  <section aria-label="Split subnets"><p>{rows.length.toLocaleString()} subnets. Displaying 25 per page.</p>
    <div class="table-scroll"><table><thead><tr><th scope="col">Network</th><th scope="col">Broadcast</th><th scope="col">First usable</th><th scope="col">Last usable</th><th scope="col">Usable count</th></tr></thead><tbody>
      {#each rows.slice(page * 25, (page + 1) * 25) as row}<tr><td>{String(row.network)}/{String(row.prefix)}</td><td>{String(row.broadcast)}</td><td>{String(row.firstUsable)}</td><td>{String(row.lastUsable)}</td><td>{String(row.usableCount)}</td></tr>{/each}
    </tbody></table></div>
    <nav aria-label="Subnet pages"><button type="button" disabled={page === 0} on:click={() => page--}>Previous subnets</button><span>Page {page + 1} of {pages}</span><button type="button" disabled={page + 1 >= pages} on:click={() => page++}>Next subnets</button><button type="button" on:click={download}>Download all subnets</button></nav>
  </section>
{:else}<FlatJsonResult {json} />{/if}

<style>
  .table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: var(--space-2); border-bottom: 1px solid var(--border); } nav { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
</style>
