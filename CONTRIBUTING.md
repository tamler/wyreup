# Contributing to Wyreup

Thanks for your interest. Wyreup is a free, privacy-first tool library and we welcome contributions that keep it that way.

## Dev environment setup

Prerequisites: Node >= 20, pnpm 9.

```bash
git clone https://github.com/<your-fork>/wyreup
cd wyreup
pnpm install
pnpm build    # builds @wyreup/core, then @wyreup/web (order matters)
pnpm test
```

Run the site locally:

```bash
pnpm --filter @wyreup/web dev
```

## Running tests

```bash
pnpm test                          # all packages
pnpm --filter @wyreup/core test    # core only
pnpm --filter @wyreup/web test     # web only (passWithNoTests if none)
```

Lint and types:

```bash
pnpm lint
pnpm typecheck
```

## Adding a new tool

Each tool is a self-contained directory under `packages/core/src/tools/<tool-id>/`.

A minimal tool module looks like this (`packages/core/src/tools/compress/index.ts` is a good reference):

```ts
import type { ToolModule } from '../../types.js';
import type { MyToolParams } from './types.js';

export const myTool: ToolModule<MyToolParams> = {
  id: 'my-tool',
  slug: 'my-tool',
  name: 'My Tool',
  description: 'One sentence. What it does, not how.',
  category: 'convert',   // see ToolCategory in types.ts
  presence: 'both',
  keywords: ['...'],

  input: {
    accept: ['image/png'],
    min: 1,
    sizeLimit: 500 * 1024 * 1024,
  },
  output: {
    mime: 'image/png',
    filename: (input) => input[0].name.replace(/\.\w+$/, '.out.png'),
  },

  async run(files, params, ctx) {
    // runs in browser (WebAssembly/browser-native APIs) and Node
    // no DOM access, no fetch to external URLs
    return [new File([...], 'out.png', { type: 'image/png' })];
  },
};
```

Key constraints enforced by CI:

- `@wyreup/core` must have **zero framework imports** (no React, Vue, Astro, etc.) — the isolation check enforces this
- `run()` must not fetch external URLs — the privacy scan enforces this
- Tools must work in both browser and Node environments (dual build via tsup)

After adding the tool:

1. Export it from `packages/core/src/index.ts`
2. Register it in `packages/core/src/default-registry.ts`
3. Add a page under `packages/web/src/pages/tools/<tool-slug>/index.astro` (copy an existing one)
4. Write at least one unit test in `packages/core/src/tools/<tool-id>/` or alongside in `test/`

## Code style

The repo uses ESLint and Prettier. Before committing:

```bash
pnpm format       # auto-fix formatting
pnpm lint         # check for lint errors
```

Config files: `eslint.config.js` at repo root, Prettier defaults (no config file — defaults are the config).

TypeScript is strict. No `any` without a comment explaining why.

## Commit message convention

Semantic commits. Examples from this repo:

```
feat(core): add pdf-redact tool
fix(web): correct tool card slug on mobile
docs(core): update types.ts tool contract comments
chore(ci): pin wrangler-action to v3
refactor(core): extract shared codec helpers
test(core): add wave 1e chain integration tests
```

Format: `<type>(<scope>): <short description>`

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`
Scopes: `core`, `web`, `cli`, `mcp`, `claude-skill`, `ci`, `root`

## PR process

1. Branch off `main`: `git checkout -b feat/my-feature`
2. Make changes, write tests
3. Ensure all CI checks pass locally (`pnpm build && pnpm test && pnpm lint && pnpm typecheck`)
4. Open a pull request against `main`
5. CI runs automatically — all jobs must be green before merge
6. Request a review; one approval required

## CI gates (must all pass)

| Check | What it does |
|---|---|
| Lint + types | ESLint + TypeScript typecheck |
| Unit tests | vitest across all packages |
| Build | Full turbo build |
| Isolation check | Confirms `@wyreup/core` has no framework imports |
| Privacy scan | Confirms no non-allowlisted external URLs in built output |
| Bundle size | Enforces size budget on core and web |

## Design principles

1. Free tools run entirely on the user's device. No server-side processing for free-tier operations.
2. Tool modules are pure, framework-free, and self-contained.
3. Browser-native APIs first; libraries only where the platform falls short.
4. The `ToolModule` contract (`packages/core/src/types.ts`) is the only architectural abstraction.
5. User-defined chains use the same `ToolModule` interface as built-ins.

## Questions?

Open an issue with the `question` label.
