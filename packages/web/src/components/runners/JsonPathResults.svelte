<script lang="ts">
  export let json = '';
  let page = 0;
  let previous = '';
  function read(text: string): { rows: { path: string; value: unknown }[]; total: number | null; truncated: boolean } {
    try {
      const data: unknown = JSON.parse(text);
      if (!data || typeof data !== 'object' || !('matches' in data) || !Array.isArray(data.matches)) return { rows: [], total: null, truncated: false };
      const rows = data.matches.filter((row): row is { path: string; value: unknown } =>
        row !== null && typeof row === 'object' && 'path' in row && typeof row.path === 'string' && 'value' in row);
      const total = 'totalMatchCount' in data && typeof data.totalMatchCount === 'number' && Number.isInteger(data.totalMatchCount) && data.totalMatchCount >= rows.length ? data.totalMatchCount : null;
      return { rows, total, truncated: 'truncated' in data && data.truncated === true };
    } catch { return { rows: [], total: null, truncated: false }; }
  }
  $: result = read(json);
  $: rows = result.rows;
  $: pages = Math.max(1, Math.ceil(rows.length / 25));
  $: if (json !== previous) { previous = json; page = 0; }
</script>

<section aria-label="JSONPath matches">
  <p>{rows.length.toLocaleString()} returned matches. The full JSON artifact includes all returned values.</p>
  {#if result.truncated && result.total !== null}<p role="status">Limited: {rows.length} of {result.total} matches returned.</p>{/if}
  <div class="table-scroll"><table><thead><tr><th scope="col">Path</th><th scope="col">Value</th></tr></thead><tbody>
    {#each rows.slice(page * 25, (page + 1) * 25) as row}<tr><td><code>{row.path}</code></td><td><pre>{JSON.stringify(row.value, null, 2)}</pre></td></tr>{/each}
  </tbody></table></div>
  <nav aria-label="Match pages"><button type="button" disabled={page === 0} on:click={() => page--}>Previous matches</button><span>Page {page + 1} of {pages}</span><button type="button" disabled={page + 1 >= pages} on:click={() => page++}>Next matches</button></nav>
</section>

<style>
  .table-scroll { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: var(--space-2); border-bottom: 1px solid var(--border); } pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; max-height: 16rem; overflow: auto; } nav { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
</style>
