# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Instead, email security reports to [tamler@gmail.com](mailto:tamler@gmail.com). Do not open public GitHub issues for security concerns.

We aim to acknowledge reports within 48 hours and provide a remediation timeline within 5 business days.

## Scope

In-scope:
- Code execution or privilege escalation via Wyreup packages
- Privacy violations (any path where free-tier data leaves the device)
- Credential leaks in published artifacts
- Supply chain risks in our dependency graph

Out of scope:
- Denial-of-service via extremely large user inputs (we document sane size limits)
- Social engineering, physical attacks, or issues in third-party services (kie.ai, Cloudflare, Stripe)
