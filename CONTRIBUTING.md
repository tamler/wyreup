# Contributing to Wyreup

Thanks for your interest in contributing! Wyreup is a free, privacy-first tool library, and we welcome contributions that help us stay true to those principles.

## Getting started

1. Fork the repo and clone it
2. Install dependencies: `pnpm install`
3. Run tests: `pnpm test`
4. Build all packages: `pnpm build`

## Development workflow

- Create a feature branch from `main`
- Make your changes
- Add tests (see the design spec for TDD + UX gate expectations)
- Run `pnpm changeset` to describe your change
- Open a pull request

## CI gates

Every PR must pass:
- Lint + typecheck
- Unit tests
- Build
- Isolation check (`@wyreup/core` framework-free)
- Privacy scan (no non-allowlisted external domains)
- Bundle size budget

## Design principles

1. Free is free. Free operations run in WebAssembly on the user's device.
2. Tool modules are pure, framework-free, and self-contained.
3. Ease of use is measurable (5 human UX gates + 3 automated gates per tool).
4. Use browser-native APIs first; libraries fill gaps.
5. The tool module contract is the only architectural abstraction.
6. User chains are tools (same interface as built-ins).

## Questions?

Open an issue with the `question` label.
