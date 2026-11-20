# Account service retired

The November 20, 2026 free-only decision retires account creation, recovery, admin, billing and hosted inference. These endpoints return HTTP 410 without authentication, database access, email delivery or provider invocation. Existing records and migration history remain intact.

The former inbox-recovery rehearsal applies to an account service no longer offered. It is replaced in this same change by the mandatory, same-source retirement gate in [free-only-service.md](free-only-service.md). No email is sent, no key issued and no recovery observation claimed. The old `EMAIL_BOUND_AUTH_REHEARSAL_COMMIT` variable is not used to approve different source.

Do not run the former signup monitor, request recovery emails or replace credentials as part of this retirement.

Deployment retains exact-source/current-main checks and requires successful retirement proof before production mutations. Existing migrations stay immutable; refresh the production migration ledger before apply. The project guide's applicable live-delivery checks remain required.

Reintroducing any hosted, billing or account service requires a new explicit product decision, independent security review and relevant runtime qualification.
