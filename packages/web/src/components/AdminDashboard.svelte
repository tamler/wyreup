<script lang="ts">
  // AdminDashboard — operator-only view at /admin.
  // Server is the gate; if /api/admin/stats returns 403 we show a
  // friendly "not authorized" message instead of empty cards.

  import { onMount } from 'svelte';
  import { user, authReady, hydrateUser } from '../stores/user';

  interface Stats {
    users: { total: number; signups7d: number; active7d: number };
    credits: {
      purchased: number;
      spent: number;
      bonus: number;
      refundCount: number;
      balanceOutstanding: number;
    };
    refundsByTool: Array<{ tool_id: string; runs: number; refunds: number }>;
    recentSignups: Array<{ id: string; email: string; created_at: number }>;
  }

  interface AccountRow {
    id: string;
    email: string;
    created_at: number;
    last_seen: number | null;
    balance: number;
    purchased: number;
    spent: number;
    bonus: number;
  }

  interface RunRow {
    id: string;
    tool_id: string;
    credits_used: number;
    file_name: string | null;
    ran_at: number;
    email: string;
  }

  let stats: Stats | null = null;
  let accounts: AccountRow[] = [];
  let runs: RunRow[] = [];
  let loading = true;
  let forbidden = false;
  let error = '';

  let searchQ = '';
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Grant modal state
  let grantOpen: AccountRow | null = null;
  let grantAmount = 0;
  let grantNote = '';
  let grantBusy = false;
  let grantError = '';

  async function fetchAll() {
    loading = true;
    error = '';
    try {
      const [s, u, r] = await Promise.all([
        fetch('/api/admin/stats', { credentials: 'same-origin' }),
        fetch(
          `/api/admin/users?limit=50${searchQ ? `&q=${encodeURIComponent(searchQ)}` : ''}`,
          { credentials: 'same-origin' },
        ),
        fetch('/api/admin/runs?limit=30', { credentials: 'same-origin' }),
      ]);
      if (s.status === 403) {
        forbidden = true;
        return;
      }
      if (!s.ok) {
        error = `Stats ${s.status}`;
        return;
      }
      stats = (await s.json()) as Stats;
      accounts = ((await u.json()) as { users: AccountRow[] }).users;
      runs = ((await r.json()) as { runs: RunRow[] }).runs;
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }

  function onSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(fetchAll, 250);
  }

  function openGrant(row: AccountRow) {
    grantOpen = row;
    grantAmount = 0;
    grantNote = '';
    grantError = '';
  }

  function closeGrant() {
    grantOpen = null;
  }

  async function submitGrant() {
    if (!grantOpen) return;
    grantError = '';
    if (!Number.isFinite(grantAmount) || grantAmount === 0) {
      grantError = 'Amount must be a non-zero integer (negative = debit).';
      return;
    }
    // Second-look for anything outside a low-risk "tip" range — mis-clicks
    // can't be undone except by a compensating grant, so confirm first.
    if (grantAmount < 0 || grantAmount > 100) {
      const verb = grantAmount < 0 ? 'debit' : 'grant';
      const amt = Math.abs(grantAmount);
      const ok = confirm(
        `About to ${verb} ${amt} credits ${grantAmount < 0 ? 'from' : 'to'} ${grantOpen.email}.\n\nThis writes to the ledger and can only be undone by a compensating grant. Continue?`,
      );
      if (!ok) return;
    }
    grantBusy = true;
    try {
      const res = await fetch('/api/admin/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Wyreup-CSRF': '1' },
        credentials: 'same-origin',
        body: JSON.stringify({
          userId: grantOpen.id,
          amount: Math.trunc(grantAmount),
          note: grantNote.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        grantError = data.error || `Grant failed (${res.status})`;
        return;
      }
      closeGrant();
      await fetchAll();
    } finally {
      grantBusy = false;
    }
  }

  function ago(t: number | null): string {
    if (!t) return 'never';
    const diff = Date.now() - t;
    const m = Math.floor(diff / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  }

  function fmtDate(t: number): string {
    return new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  }

  function refundRate(r: { runs: number; refunds: number }): string {
    if (r.runs === 0) return '—';
    return `${((r.refunds / r.runs) * 100).toFixed(1)}%`;
  }

  onMount(async () => {
    await hydrateUser();
    if ($user) await fetchAll();
  });
</script>

{#if !$authReady}
  <p class="muted">Loading…</p>
{:else if !$user}
  <div class="card center">
    <h2>Sign in</h2>
    <p class="muted">Paste your admin API key (top-right "Get PRO" button) to view this dashboard.</p>
  </div>
{:else if forbidden}
  <div class="card center">
    <h2>Not authorized</h2>
    <p class="muted">Your account is signed in but not on the admin allowlist. Add the email to <code>ADMIN_EMAILS</code> on the Pages project.</p>
  </div>
{:else if loading && !stats}
  <p class="muted">Loading…</p>
{:else if error}
  <p class="error">{error}</p>
{:else if stats}
  <section class="metrics">
    <div class="metric">
      <div class="metric__label">Users</div>
      <div class="metric__num">{stats.users.total}</div>
      <div class="metric__sub">+{stats.users.signups7d} last 7d</div>
    </div>
    <div class="metric">
      <div class="metric__label">Active 7d</div>
      <div class="metric__num">{stats.users.active7d}</div>
      <div class="metric__sub">ran a PRO tool</div>
    </div>
    <div class="metric">
      <div class="metric__label">Credits purchased</div>
      <div class="metric__num">{stats.credits.purchased}</div>
      <div class="metric__sub">lifetime</div>
    </div>
    <div class="metric">
      <div class="metric__label">Credits in flight</div>
      <div class="metric__num">{stats.credits.balanceOutstanding}</div>
      <div class="metric__sub">across all balances</div>
    </div>
    <div class="metric">
      <div class="metric__label">Credits spent</div>
      <div class="metric__num">{stats.credits.spent}</div>
      <div class="metric__sub">lifetime</div>
    </div>
    <div class="metric">
      <div class="metric__label">Refund events</div>
      <div class="metric__num">{stats.credits.refundCount}</div>
      <div class="metric__sub">all time</div>
    </div>
  </section>

  {#if stats.recentSignups.length > 0}
    <section class="card">
      <h3>Latest signups</h3>
      <ul class="signups">
        {#each stats.recentSignups as s}
          <li>
            <span class="signups__email">{s.email}</span>
            <span class="signups__time">{ago(s.created_at)}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="card">
    <div class="card__head">
      <h3>Accounts</h3>
      <input
        class="search"
        type="search"
        placeholder="Search email…"
        bind:value={searchQ}
        on:input={onSearch}
      />
    </div>
    {#if accounts.length === 0}
      <p class="muted">No accounts match.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Balance</th>
            <th>Spent</th>
            <th>Purchased</th>
            <th>Bonus</th>
            <th>Joined</th>
            <th>Last seen</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each accounts as a}
            <tr>
              <td class="email">{a.email}</td>
              <td class="num">{a.balance}</td>
              <td class="num">{a.spent}</td>
              <td class="num">{a.purchased}</td>
              <td class="num">{a.bonus}</td>
              <td class="time">{fmtDate(a.created_at)}</td>
              <td class="time">{ago(a.last_seen)}</td>
              <td><button type="button" class="ghost" on:click={() => openGrant(a)}>Grant</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section class="card">
    <h3>Recent PRO runs</h3>
    {#if runs.length === 0}
      <p class="muted">No runs yet.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Email</th>
            <th>Tool</th>
            <th>Credits</th>
            <th>File</th>
          </tr>
        </thead>
        <tbody>
          {#each runs as r}
            <tr>
              <td class="time">{ago(r.ran_at)}</td>
              <td class="email">{r.email}</td>
              <td>{r.tool_id}</td>
              <td class="num">{r.credits_used}</td>
              <td class="email">{r.file_name ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  {#if stats.refundsByTool.length > 0}
    <section class="card">
      <h3>Refund rate by tool (last 7d)</h3>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Runs</th>
            <th>Refunds</th>
            <th>Rate</th>
          </tr>
        </thead>
        <tbody>
          {#each stats.refundsByTool as t}
            <tr>
              <td>{t.tool_id}</td>
              <td class="num">{t.runs}</td>
              <td class="num">{t.refunds}</td>
              <td class="num">{refundRate(t)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}
{/if}

{#if grantOpen}
  <div
    class="modal"
    role="presentation"
    on:click={(e) => {
      if (e.target === e.currentTarget) closeGrant();
    }}
  >
    <div class="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="grant-title">
      <h3 id="grant-title">Grant credits</h3>
      <p class="muted">{grantOpen.email} — current balance {grantOpen.balance}</p>
      <form on:submit|preventDefault={submitGrant}>
        <label>
          Amount (credits — negative to debit)
          <input type="number" bind:value={grantAmount} step="1" min="-10000" max="10000" required disabled={grantBusy} />
        </label>
        <label>
          Note (optional, shows in ledger)
          <input type="text" bind:value={grantNote} maxlength="240" disabled={grantBusy} />
        </label>
        {#if grantError}
          <p class="error">{grantError}</p>
        {/if}
        <div class="modal__actions">
          <button type="button" class="ghost" on:click={closeGrant} disabled={grantBusy}>Cancel</button>
          <button type="submit" class="primary" disabled={grantBusy || !grantAmount}>
            {grantBusy ? 'Saving…' : 'Apply'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }
  .error {
    color: var(--accent-text);
    font-size: var(--text-sm);
  }
  .center {
    text-align: center;
    padding: var(--space-8) var(--space-4);
  }

  .metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-5);
  }
  @media (max-width: 700px) {
    .metrics {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  .metric {
    padding: var(--space-4);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
  .metric__label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: var(--space-2);
  }
  .metric__num {
    font-family: var(--font-mono);
    font-size: 28px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1;
  }
  .metric__sub {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-subtle);
    margin-top: var(--space-2);
  }

  .card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    margin-bottom: var(--space-4);
  }
  .card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
    flex-wrap: wrap;
  }
  .card h3 {
    margin: 0 0 var(--space-3);
    font-size: var(--text-md);
    font-weight: 600;
  }
  .card__head h3 {
    margin: 0;
  }

  .signups {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .signups li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border-subtle);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .signups li:last-child {
    border-bottom: none;
  }
  .signups__email {
    color: var(--text-primary);
  }
  .signups__time {
    color: var(--text-subtle);
    font-size: var(--text-xs);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  th,
  td {
    text-align: left;
    padding: var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
  }
  th {
    color: var(--text-muted);
    font-weight: 500;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  td.num {
    text-align: right;
    color: var(--text-primary);
  }
  td.time {
    color: var(--text-subtle);
    font-size: var(--text-xs);
  }
  td.email {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search {
    height: 30px;
    padding: 0 var(--space-3);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    min-width: 200px;
  }

  .ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: var(--radius-sm);
    padding: 3px 10px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .ghost:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }
  .primary {
    background: var(--accent);
    color: var(--text-on-accent, #000);
    border: none;
    border-radius: var(--radius-sm);
    padding: 6px 14px;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1020;
    padding: var(--space-4);
  }
  .modal__dialog {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: 100%;
    max-width: 420px;
    padding: var(--space-5);
  }
  .modal__dialog h3 {
    margin: 0 0 var(--space-2);
  }
  .modal__dialog label {
    display: block;
    margin-top: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .modal__dialog input {
    width: 100%;
    height: 34px;
    margin-top: 4px;
    padding: 0 var(--space-3);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .modal__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
</style>
