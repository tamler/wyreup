# Signup monitoring & abuse controls

State as of 2026-07-13. Three layers, cheapest-to-detect first.

## 1. In-code gate (shipped from day one)

`functions/api/account/create.ts`: 5 attempts/day per email, 10/day per IP
(`CF-Connecting-IP`), recorded in the `create_attempts` D1 table before any
work. Over-cap requests get a 429 and are NOT inserted (no free writes for
attackers). Existing-email attempts send a notice, never a key.

## 2. Visibility + scheduled alerts (shipped 2026-07-13)

- `GET /api/admin/stats` now includes `signupAttempts` (24h/7d volumes,
  distinct IPs/emails, IPs at the daily cap) — rendered as the "Signup
  attempts" card on `/admin`.
- `GET /api/admin/alerts` evaluates anomalies and prunes `create_attempts`
  rows older than 14 days. Alerts: attempt volume ≥ 50/24h, ≥ 3 IPs at the
  daily cap, negative outstanding credit balance.
- `.github/workflows/signup-alerts.yml` calls the alerts endpoint every 6
  hours. Any alert — or an unreachable endpoint, which doubles as the
  "signups are broken" canary — fails the run and opens/comments on a
  "Signup monitor alert" GitHub issue (email arrives via normal GitHub
  notifications).

**One-time setup (operator):** create a repo secret `WYREUP_ADMIN_KEY`
containing a `wk_live_…` key that belongs to an account listed in the
`ADMIN_EMAILS` Pages environment variable. Without it the monitor opens an
issue telling you it cannot run.

## 3. Cloudflare WAF rate limiting (operator, dashboard-only — NOT yet done)

Code cannot configure this; takes ~2 minutes in the dashboard:

1. Cloudflare dashboard → wyreup.com zone → Security → WAF → Rate limiting
   rules → Create rule.
2. Name: `signup-create-limit`. If incoming requests match: URI Path equals
   `/api/account/create` AND Method equals `POST`.
3. Rate: 10 requests per 1 minute per IP. Action: Block for 1 hour.
4. Then Notifications (account level) → Add → "Security Events Alert" →
   filter to the wyreup.com zone → email.

This blocks volumetric floods at the edge before they reach the Function
(the in-code gate is per-day; this catches per-minute hammering the D1 gate
would happily serve 429s to all day).

## Known trade-offs

- The create endpoint's "account already exists" response reveals whether an
  email is registered (enumeration); accepted because the 5/day/email cap
  bounds it and the alternative (silent success) breaks honest UX.
- Alert thresholds are tuned for pre-traction volume; raise
  `ATTEMPTS_24H_ALERT` in `functions/api/admin/alerts.ts` when real signups
  approach it.
