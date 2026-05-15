# Wyreup — Wave 0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a working pnpm monorepo scaffold with five packages (`@wyreup/core`, `@wyreup/web`, `@wyreup/mcp`, `@wyreup/cli`, `claude-code-wyreup-skill`), shared tooling, CI with three custom privacy/isolation/size checks, and the foundational type system + chain engine skeleton from the spec — all building green and deployable, with no tools yet.

**Architecture:** pnpm workspaces + Turborepo for task orchestration. TypeScript strict mode across all packages. `@wyreup/core` is framework-free and publishes dual browser/node builds via tsup with conditional exports. `@wyreup/web` is Astro + Cloudflare Pages. `@wyreup/mcp` and `@wyreup/cli` are Node-only. Three custom CI checks (isolation, bundle size, privacy scan) enforce design principles from day one before any tool code exists.

**Tech Stack:** pnpm, TypeScript 5.x, Turborepo, Vitest, ESLint flat config, Prettier, tsup, Astro, @modelcontextprotocol/sdk, commander, Changesets, GitHub Actions.

**Scope:** Wave 0 only (from spec §9). Produces scaffold with zero tools. Wave 1 (first 8 tools across all surfaces) is a follow-up plan.

**Source spec:** `/Users/jacob/Projects/toanother.one/docs/superpowers/specs/2026-04-15-wyreup-tool-library-design.md`

**Repository state assumption:** This plan assumes the working directory is empty or effectively empty. It initializes git, creates the monorepo structure from scratch, and commits at each logical milestone.

---

## Prerequisites (one-time, not tracked as tasks)

Before executing this plan, verify the following are installed:

- Node.js 20.x or later (`node --version`)
- pnpm 9.x or later (`pnpm --version` or install via `npm install -g pnpm`)
- git (`git --version`)

If missing, install them before Task 1.

---

## Task 1: Initialize git repository and base structure

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `LICENSE`

- [ ] **Step 1: Verify we're in the right directory**

Run:
```bash
pwd
```
Expected: `/Users/jacob/Projects/toanother.one` (or wherever the project root is; the folder may rename later — that's fine).

- [ ] **Step 2: Initialize git repository**

Run:
```bash
git init
git config core.autocrlf false
```
Expected: "Initialized empty Git repository in ..."

- [ ] **Step 3: Create `.gitignore`**

Create `.gitignore` with:
```
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
.astro/
.turbo/
.wrangler/

# Test coverage
coverage/

# Environment and secrets
.env
.env.local
.env.*.local
.dev.vars
*.secret

# OS files
.DS_Store
Thumbs.db

# Editor
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea/

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Cloudflare
.wrangler/
wrangler.toml.local
```

- [ ] **Step 4: Create `LICENSE` (MIT)**

Create `LICENSE` with:
```
MIT License

Copyright (c) 2026 Wyreup contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 5: Create minimal `README.md`**

Create `README.md` with:
```markdown
# Wyreup

Free, privacy-first, open-source tool library for transforming files. Images, PDFs, and more.

**Status:** Wave 0 foundation (scaffolding in progress).

## Packages

- `@wyreup/core` — the tool library (framework-free, dual browser/node build)
- `@wyreup/web` — wyreup.com website, landing pages, editor, PWA
- `@wyreup/mcp` — MCP server for agent access
- `@wyreup/cli` — `wyreup` command-line interface
- `claude-code-wyreup-skill` — Claude Code skill

## Development

```bash
pnpm install
pnpm build
pnpm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contributor workflow.

## License

MIT — see [LICENSE](./LICENSE).
```

- [ ] **Step 6: Initial commit**

```bash
git add .gitignore README.md LICENSE
git commit -m "chore: initialize repository with license and readme"
```

Expected: "1 file changed" or similar, commit succeeds.

---

## Task 2: Initialize pnpm workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`

- [ ] **Step 1: Create root `package.json`**

Create `package.json` with:
```json
{
  "name": "wyreup-monorepo",
  "version": "0.0.0",
  "private": true,
  "description": "Wyreup — free, privacy-first tool library",
  "license": "MIT",
  "packageManager": "pnpm@9.0.0",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "dev": "turbo run dev --parallel",
    "clean": "turbo run clean && rm -rf node_modules .turbo"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

Create `pnpm-workspace.yaml` with:
```yaml
packages:
  - "packages/*"
  - "tools"
```

(The `tools` directory is included so CI check scripts can have their own test deps managed by pnpm. It contains repo-level scripts, not a publishable package.)

- [ ] **Step 3: Verify pnpm picks up the workspace**

Run:
```bash
pnpm install
```
Expected: "Done" with no packages installed yet (empty workspace). No errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore: initialize pnpm workspace"
```

---

## Task 3: Configure TypeScript base

**Files:**
- Create: `tsconfig.base.json`

- [ ] **Step 1: Install TypeScript and Node types**

Run:
```bash
pnpm add -Dw typescript@^5.5.0 @types/node@^20.0.0
```
Expected: typescript and @types/node added as root devDependencies. (`@types/node` is hoisted so every package — including the dual-build `@wyreup/core` — can reference Node APIs like `process.versions` in type checks.)

- [ ] **Step 2: Create `tsconfig.base.json`**

Create `tsconfig.base.json` at the repo root with:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": false
  },
  "exclude": ["node_modules", "dist", ".astro", ".turbo"]
}
```

- [ ] **Step 3: Verify TypeScript resolves**

Run:
```bash
pnpm exec tsc --version
```
Expected: `Version 5.5.x` or later.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.base.json
git commit -m "chore: add typescript base configuration"
```

---

## Task 4: Configure Prettier

**Files:**
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Modify: `package.json` (add scripts and devDependency)

- [ ] **Step 1: Install Prettier**

Run:
```bash
pnpm add -Dw prettier@^3.3.0
```

- [ ] **Step 2: Create `.prettierrc.json`**

Create `.prettierrc.json`:
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

- [ ] **Step 3: Create `.prettierignore`**

Create `.prettierignore`:
```
node_modules/
dist/
.astro/
.turbo/
pnpm-lock.yaml
*.md
```

- [ ] **Step 4: Add format scripts to root `package.json`**

Edit `package.json` to add to `scripts`:
```json
    "format": "prettier --write .",
    "format:check": "prettier --check ."
```

- [ ] **Step 5: Verify Prettier runs**

Run:
```bash
pnpm format:check
```
Expected: "All matched files use Prettier code style!" or similar. No errors.

- [ ] **Step 6: Commit**

```bash
git add .prettierrc.json .prettierignore package.json pnpm-lock.yaml
git commit -m "chore: add prettier configuration"
```

---

## Task 5: Configure ESLint (flat config)

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json`

- [ ] **Step 1: Install ESLint and plugins**

Run:
```bash
pnpm add -Dw eslint@^9.10.0 @eslint/js typescript-eslint@^8.0.0 eslint-config-prettier
```

- [ ] **Step 2: Create `eslint.config.js`**

Create `eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.astro/**',
      '**/.turbo/**',
      '**/*.config.js',
      '**/*.config.ts',
      '**/tools/**/*.js',
    ],
  },
);
```

- [ ] **Step 3: Add lint script to root `package.json`**

Edit `package.json` `scripts` to add:
```json
    "lint:root": "eslint ."
```

(The per-package `lint` will be wired via Turborepo later.)

- [ ] **Step 4: Verify ESLint runs**

Run:
```bash
pnpm lint:root
```
Expected: no errors (nothing to lint yet). May output "No files matching the pattern" or clean exit.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js package.json pnpm-lock.yaml
git commit -m "chore: add eslint flat config"
```

---

## Task 6: Install and configure Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**

Run:
```bash
pnpm add -Dw vitest@^2.1.0 @vitest/coverage-v8
```

- [ ] **Step 2: Create `vitest.config.ts` at the repo root**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.config.*',
        '**/test-fixtures/**',
      ],
    },
  },
});
```

- [ ] **Step 3: Add test scripts to root `package.json`**

Edit `package.json` `scripts` to add:
```json
    "test:root": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Verify Vitest runs**

Run:
```bash
pnpm test:root
```
Expected: "No test files found" — that's fine, we have no tests yet. Exit code 0 or controlled exit.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml
git commit -m "chore: add vitest configuration"
```

---

## Task 7: Install and configure Turborepo

**Files:**
- Create: `turbo.json`

- [ ] **Step 1: Install Turborepo**

Run:
```bash
pnpm add -Dw turbo@^2.1.0
```

- [ ] **Step 2: Create `turbo.json`**

Create `turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".astro/**"],
      "inputs": ["src/**", "package.json", "tsconfig.json"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"],
      "inputs": ["src/**", "test/**", "package.json"]
    },
    "lint": {
      "outputs": [],
      "inputs": ["src/**", "test/**", "package.json"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": [],
      "inputs": ["src/**", "test/**", "tsconfig.json"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    }
  }
}
```

- [ ] **Step 3: Verify Turborepo runs**

Run:
```bash
pnpm exec turbo --version
```
Expected: `2.x.x` or later.

- [ ] **Step 4: Try running `pnpm build` (should no-op)**

Run:
```bash
pnpm build
```
Expected: "No tasks were executed" or similar. No errors. (No packages yet, so nothing to build.)

- [ ] **Step 5: Commit**

```bash
git add turbo.json package.json pnpm-lock.yaml
git commit -m "chore: add turborepo configuration"
```

---

## Task 8: Scaffold `@wyreup/core` package

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/README.md`

- [ ] **Step 1: Create package directory structure**

Run:
```bash
mkdir -p packages/core/src packages/core/test
```

- [ ] **Step 2: Create `packages/core/package.json`**

Create `packages/core/package.json`:
```json
{
  "name": "@wyreup/core",
  "version": "0.0.0",
  "description": "Wyreup tool library — framework-free, dual browser/node build",
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "browser": "./dist/browser/index.js",
      "node": "./dist/node/index.js",
      "default": "./dist/browser/index.js"
    }
  },
  "main": "./dist/node/index.js",
  "module": "./dist/browser/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "lint": "eslint src test",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create `packages/core/tsconfig.json`**

Create `packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create placeholder `packages/core/src/index.ts`**

Create `packages/core/src/index.ts`:
```ts
// Wyreup core — tool library public API
// Populated in subsequent tasks.

export const WYREUP_CORE_VERSION = '0.0.0';
```

- [ ] **Step 5: Create `packages/core/README.md`**

Create `packages/core/README.md`:
```markdown
# @wyreup/core

The Wyreup tool library. Framework-free, dual browser/node build.

This package contains:
- Tool module type definitions and registry
- The chain engine (type graph, runChain, cycle detection)
- Runtime adapters (browser, node)

Consumed by `@wyreup/web`, `@wyreup/mcp`, `@wyreup/cli`.

## Status

Wave 0 foundation scaffolding. Types and skeletons only; tools are added in Wave 1.
```

- [ ] **Step 6: Install package dependencies**

Run:
```bash
pnpm install
```
Expected: pnpm resolves the workspace, installs tsup for `@wyreup/core`.

- [ ] **Step 7: Commit**

```bash
git add packages/core package.json pnpm-lock.yaml
git commit -m "feat(core): scaffold @wyreup/core package"
```

---

## Task 9: Write `ToolModule` type definitions

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/test/types.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/types.test.ts`:
```ts
import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  ToolModule,
  ToolCategory,
  ToolPresence,
  ToolInputSpec,
  ToolOutputSpec,
  ToolProgress,
  ToolRunContext,
  MemoryEstimate,
  MimePattern,
} from '../src/types.js';

describe('types', () => {
  it('ToolCategory includes expected values', () => {
    const cat: ToolCategory = 'optimize';
    expect(cat).toBe('optimize');
  });

  it('MemoryEstimate includes expected tiers', () => {
    const mem: MemoryEstimate = 'low';
    expect(mem).toBe('low');
  });

  it('ToolPresence is a union of three literals', () => {
    const p: ToolPresence = 'editor';
    expect(p).toBe('editor');
  });

  it('ToolRunContext has executionId for idempotency', () => {
    const ctx: ToolRunContext = {
      onProgress: () => {},
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: 'test-uuid',
    };
    expect(ctx.executionId).toBe('test-uuid');
  });

  it('ToolModule interface compiles with a minimal shape', () => {
    const mod: ToolModule<{ quality: number }> = {
      id: 'test',
      slug: 'test',
      name: 'Test',
      description: 'Test tool',
      category: 'optimize',
      presence: 'both',
      keywords: ['test'],
      input: { accept: ['image/*'], min: 1 },
      output: { mime: 'image/png' },
      interactive: false,
      batchable: true,
      cost: 'free',
      memoryEstimate: 'low',
      defaults: { quality: 80 },
      Component: () => null as any,
      run: async () => new Blob(),
      __testFixtures: { valid: [], weird: [], expectedOutputMime: [] },
    };
    expect(mod.id).toBe('test');
    expect(mod.memoryEstimate).toBe('low');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @wyreup/core test
```
Expected: FAIL — `Cannot find module '../src/types.js'` or similar.

- [ ] **Step 3: Create `packages/core/src/types.ts` with full type definitions**

Create `packages/core/src/types.ts`:
```ts
// Wyreup core — type definitions
// Source of truth for the tool module contract.
// See /docs/superpowers/specs/2026-04-15-wyreup-tool-library-design.md §5.1

import type { ComponentType } from './ui-types.js';

// ──── Category and presence ────

export type ToolCategory =
  | 'optimize'
  | 'convert'
  | 'edit'
  | 'privacy'
  | 'pdf'
  | 'create'
  | 'inspect'
  | 'export';

export type ToolPresence = 'editor' | 'standalone' | 'both';

// ──── Memory estimate for worker pool scheduling ────

/**
 * Approximate working-set memory (in tiers) when run() is active.
 * Used by the worker pool to gate concurrent execution on low-memory devices.
 * Values are rough estimates, not hard guarantees.
 */
export type MemoryEstimate =
  | 'low'      // <50 MB: most pure-WASM tools (compress, convert, strip-exif)
  | 'medium'   // 50-200 MB: background removal, face detection, PDF rendering
  | 'high'     // 200-500 MB: video processing (v1.5), OCR (v1.5)
  | 'extreme'; // >500 MB: reserved; not used in v1 or v1.5

// ──── MIME pattern (e.g. 'image/*', 'application/pdf', 'image/heic') ────

export type MimePattern = string;

// ──── Input / output specifications ────

export interface ToolInputSpec {
  /** Allowed MIME patterns (supports wildcards like 'image/*'). */
  accept: MimePattern[];
  /** Minimum number of files required. */
  min: number;
  /** Maximum number of files (undefined = unlimited). */
  max?: number;
  /** Per-file byte cap for sanity; default 500 MB. */
  sizeLimit?: number;
}

export interface ToolOutputSpec {
  /** Output MIME type. */
  mime: MimePattern;
  /** True if run() can produce multiple files (e.g. pdf-to-image). */
  multiple?: boolean;
  /** Optional: suggested output filename generator. */
  filename?: (input: File, params: unknown) => string;
}

// ──── Progress reporting ────

export interface ToolProgress {
  stage: 'loading-deps' | 'processing' | 'encoding' | 'done';
  /** 0-100 if known, undefined if indeterminate. */
  percent?: number;
  /** Short human-readable message. */
  message?: string;
}

// ──── Run context passed into every tool invocation ────

export interface ToolRunContext {
  onProgress: (p: ToolProgress) => void;
  signal: AbortSignal;
  /** Per-session cache for expensive shared initialization (e.g. model handles). */
  cache: Map<string, unknown>;
  /**
   * Stable UUID for this invocation. Used as an idempotency key for v2 AI
   * backend calls so that retries don't double-charge credits.
   */
  executionId: string;
}

// ──── UI component contract ────

export interface ToolComponentProps<Params> {
  /** Where the component is being rendered. */
  surface: 'landing-page' | 'editor-chip' | 'editor-modal' | 'focused-mode';
  /** Partial params that pin the tool's config (used by SEO alias pages). */
  preset?: Partial<Params>;
  /** Files to operate on (from editor context or picked inline). */
  inputs: File[];
  /** Called when the user changes the input file set. */
  onInputsChange: (files: File[]) => void;
  /** Called when run() completes with the output blobs. */
  onComplete: (outputs: Blob[]) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

// ──── The ToolModule interface ────

export interface ToolModule<Params = unknown> {
  // Metadata
  id: string;
  slug: string;
  name: string;
  description: string;
  category: ToolCategory;
  presence: ToolPresence;
  keywords: string[];

  // Capabilities
  input: ToolInputSpec;
  output: ToolOutputSpec;
  interactive: boolean;
  batchable: boolean;
  cost: 'free' | 'credit';
  memoryEstimate: MemoryEstimate;

  // Core operation (v1 tools use this)
  run(inputs: File[], params: Params, ctx: ToolRunContext): Promise<Blob[] | Blob>;

  // Streaming operation (v1.5+ forward-compat; undefined/false in v1)
  streaming?: boolean;
  runStream?: (
    inputs: ReadableStream<Uint8Array>[],
    params: Params,
    ctx: ToolRunContext,
  ) => Promise<ReadableStream<Uint8Array>[]>;

  // UI component (same component renders in all surfaces)
  Component: ComponentType<ToolComponentProps<Params>>;

  // Presets
  defaults: Params;
  applyPreset?: (preset: Partial<Params>, defaults: Params) => Params;

  // Testing contract (consumed by CI)
  __testFixtures: {
    valid: string[];
    weird: string[];
    expectedOutputMime: string[];
  };
}
```

- [ ] **Step 4: Create `packages/core/src/ui-types.ts`**

Create `packages/core/src/ui-types.ts`:
```ts
// UI component type definition. Decoupled from React so @wyreup/core stays
// framework-free. Consumers (web, mcp, cli) adapt to this interface.
//
// A ComponentType is just a function that takes props and returns *something*
// a UI can render. Framework-specific consumers (e.g. @wyreup/web using React)
// will adapt this to their framework's component type.

export type ComponentType<Props> = (props: Props) => unknown;
```

- [ ] **Step 5: Export types from `packages/core/src/index.ts`**

Edit `packages/core/src/index.ts`:
```ts
// Wyreup core — tool library public API

export const WYREUP_CORE_VERSION = '0.0.0';

export type {
  ToolModule,
  ToolCategory,
  ToolPresence,
  ToolInputSpec,
  ToolOutputSpec,
  ToolProgress,
  ToolRunContext,
  ToolComponentProps,
  MemoryEstimate,
  MimePattern,
} from './types.js';

export type { ComponentType } from './ui-types.js';
```

- [ ] **Step 6: Run the test to verify it passes**

Run:
```bash
pnpm --filter @wyreup/core test
```
Expected: PASS (5 tests in `types.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src packages/core/test
git commit -m "feat(core): add tool module type definitions"
```

---

## Task 10: Chain engine skeleton with depth cap

**Files:**
- Create: `packages/core/src/chain/types.ts`
- Create: `packages/core/src/chain/errors.ts`
- Create: `packages/core/src/chain/engine.ts`
- Create: `packages/core/test/chain/engine.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/chain/engine.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  runChain,
  MAX_CHAIN_DEPTH,
  ChainError,
  type Chain,
  type ChainStep,
} from '../../src/chain/engine.js';
import type { ToolRunContext } from '../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test-exec-id',
  };
}

describe('runChain', () => {
  it('throws ChainError with depth info when MAX_CHAIN_DEPTH exceeded', async () => {
    const step: ChainStep = { toolId: 'nonexistent-tool', params: {} };
    const chain: Chain = Array(MAX_CHAIN_DEPTH + 1).fill(step);

    await expect(runChain(chain, [], makeCtx(), MAX_CHAIN_DEPTH + 1))
      .rejects.toBeInstanceOf(ChainError);
  });

  it('MAX_CHAIN_DEPTH is exactly 10', () => {
    expect(MAX_CHAIN_DEPTH).toBe(10);
  });

  it('returns empty array when given empty chain', async () => {
    const result = await runChain([], [], makeCtx());
    expect(result).toEqual([]);
  });

  it('ChainError carries the failing step index', () => {
    const err = new ChainError('test', 3);
    expect(err.stepIndex).toBe(3);
    expect(err.message).toBe('test');
    expect(err).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @wyreup/core test
```
Expected: FAIL — `Cannot find module '../../src/chain/engine.js'`.

- [ ] **Step 3: Create `packages/core/src/chain/types.ts`**

Create `packages/core/src/chain/types.ts`:
```ts
/**
 * One step in a chain: a tool id plus partial parameters that override defaults.
 */
export interface ChainStep {
  toolId: string;
  params: Record<string, unknown>;
}

/**
 * A chain is an ordered list of steps. Each step's output feeds the next step's input.
 */
export type Chain = ChainStep[];

/**
 * A saved chain that can be invoked by name and converted to a ToolModule
 * via the chainToToolModule adapter (Wave 1).
 */
export interface SavedChain {
  id: string;
  name: string;
  description?: string;
  steps: Chain;
  createdAt: number;
}
```

- [ ] **Step 4: Create `packages/core/src/chain/errors.ts`**

Create `packages/core/src/chain/errors.ts`:
```ts
/**
 * Error thrown when chain execution fails at a specific step.
 * stepIndex is the 0-indexed position where the failure occurred.
 */
export class ChainError extends Error {
  public readonly stepIndex: number;

  constructor(message: string, stepIndex: number) {
    super(message);
    this.name = 'ChainError';
    this.stepIndex = stepIndex;
  }
}
```

- [ ] **Step 5: Create `packages/core/src/chain/engine.ts`**

Create `packages/core/src/chain/engine.ts`:
```ts
import type { ToolRunContext } from '../types.js';
import type { Chain, ChainStep } from './types.js';
import { ChainError } from './errors.js';

// Re-export for ergonomics.
export { ChainError };
export type { Chain, ChainStep };

/**
 * Hard cap on chain nesting depth. Prevents runaway recursion (user chains
 * referencing other user chains) from freezing the browser.
 */
export const MAX_CHAIN_DEPTH = 10;

/**
 * Execute a chain of tools in sequence. Each step's output feeds the next
 * step's input. Wave 0 skeleton: validates depth, iterates steps, delegates
 * actual tool lookup/execution to the registry (added in Wave 1).
 *
 * @param chain      The ordered list of steps to run.
 * @param inputs     Initial inputs for the first step.
 * @param ctx        Run context (progress, abort, executionId, etc.).
 * @param depth      Current recursion depth (defaults to 0; incremented by
 *                   callers that invoke runChain from within runChain).
 */
export async function runChain(
  chain: Chain,
  inputs: File[],
  ctx: ToolRunContext,
  depth = 0,
): Promise<Blob[]> {
  if (depth >= MAX_CHAIN_DEPTH) {
    throw new ChainError(
      `Maximum chain depth ${MAX_CHAIN_DEPTH} exceeded`,
      depth,
    );
  }

  // Wave 0 skeleton: no registry yet, so we can only iterate the chain.
  // Wave 1 will fill in the step-execution body that looks up tools and runs them.

  for (let i = 0; i < chain.length; i++) {
    if (ctx.signal.aborted) {
      throw new ChainError('Aborted', i);
    }
    // Skeleton: no actual execution. Wave 1 implements step dispatch.
    const _step: ChainStep = chain[i]!;
    void _step;
    void inputs;
  }

  // Wave 0 returns empty; Wave 1 returns actual output blobs.
  return [];
}
```

- [ ] **Step 6: Update `packages/core/src/index.ts` to export chain API**

Edit `packages/core/src/index.ts` to add:
```ts
export {
  runChain,
  MAX_CHAIN_DEPTH,
  ChainError,
  type Chain,
  type ChainStep,
} from './chain/engine.js';

export type { SavedChain } from './chain/types.js';
```

- [ ] **Step 7: Run tests to verify they pass**

Run:
```bash
pnpm --filter @wyreup/core test
```
Expected: PASS (all tests in `engine.test.ts` green; previous types tests still green).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/chain packages/core/src/index.ts packages/core/test/chain
git commit -m "feat(core): chain engine skeleton with depth cap"
```

---

## Task 11: Cycle detection for saved chains

**Files:**
- Create: `packages/core/src/chain/cycle.ts`
- Create: `packages/core/test/chain/cycle.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/chain/cycle.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { detectCycle } from '../../src/chain/cycle.js';
import type { SavedChain } from '../../src/chain/types.js';

describe('detectCycle', () => {
  it('returns null for a chain with no user-chain references', () => {
    const chain: SavedChain = {
      id: 'a',
      name: 'A',
      steps: [
        { toolId: 'compress', params: {} },
        { toolId: 'strip-exif', params: {} },
      ],
      createdAt: 0,
    };
    const allChains = new Map([['a', chain]]);
    expect(detectCycle(chain, allChains)).toBeNull();
  });

  it('returns null when referenced user chains do not form a cycle', () => {
    const chainB: SavedChain = {
      id: 'b',
      name: 'B',
      steps: [{ toolId: 'compress', params: {} }],
      createdAt: 0,
    };
    const chainA: SavedChain = {
      id: 'a',
      name: 'A',
      steps: [{ toolId: 'user:b', params: {} }],
      createdAt: 0,
    };
    const allChains = new Map([
      ['a', chainA],
      ['b', chainB],
    ]);
    expect(detectCycle(chainA, allChains)).toBeNull();
  });

  it('detects direct self-reference (A → A)', () => {
    const chainA: SavedChain = {
      id: 'a',
      name: 'A',
      steps: [{ toolId: 'user:a', params: {} }],
      createdAt: 0,
    };
    const allChains = new Map([['a', chainA]]);
    const cycle = detectCycle(chainA, allChains);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('a');
  });

  it('detects indirect cycle (A → B → A)', () => {
    const chainA: SavedChain = {
      id: 'a',
      name: 'A',
      steps: [{ toolId: 'user:b', params: {} }],
      createdAt: 0,
    };
    const chainB: SavedChain = {
      id: 'b',
      name: 'B',
      steps: [{ toolId: 'user:a', params: {} }],
      createdAt: 0,
    };
    const allChains = new Map([
      ['a', chainA],
      ['b', chainB],
    ]);
    const cycle = detectCycle(chainA, allChains);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('a');
    expect(cycle).toContain('b');
  });

  it('detects longer cycle (A → B → C → A)', () => {
    const chainA: SavedChain = {
      id: 'a',
      name: 'A',
      steps: [{ toolId: 'user:b', params: {} }],
      createdAt: 0,
    };
    const chainB: SavedChain = {
      id: 'b',
      name: 'B',
      steps: [{ toolId: 'user:c', params: {} }],
      createdAt: 0,
    };
    const chainC: SavedChain = {
      id: 'c',
      name: 'C',
      steps: [{ toolId: 'user:a', params: {} }],
      createdAt: 0,
    };
    const allChains = new Map([
      ['a', chainA],
      ['b', chainB],
      ['c', chainC],
    ]);
    const cycle = detectCycle(chainA, allChains);
    expect(cycle).not.toBeNull();
    expect(cycle).toEqual(['a', 'b', 'c', 'a']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @wyreup/core test
```
Expected: FAIL — `Cannot find module '../../src/chain/cycle.js'`.

- [ ] **Step 3: Create `packages/core/src/chain/cycle.ts`**

Create `packages/core/src/chain/cycle.ts`:
```ts
import type { SavedChain } from './types.js';

/**
 * Detect a cycle in a chain-of-chains graph.
 *
 * User chains can reference other user chains as steps (via toolId like
 * "user:<chainId>"). If A references B and B references A (or through a
 * longer path), execution would loop forever. This function runs a DFS
 * from the given chain and returns the cycle path if one is found, or
 * null if no cycle exists.
 *
 * Called at save time so users get immediate feedback instead of a
 * runtime error later.
 *
 * @param chain      The chain to check.
 * @param allChains  All known user chains keyed by id (for reference resolution).
 * @returns          The cycle path as an array of chain ids (first id
 *                   appears at both ends), or null if no cycle.
 */
export function detectCycle(
  chain: SavedChain,
  allChains: Map<string, SavedChain>,
): string[] | null {
  return dfs(chain.id, allChains, []);
}

function dfs(
  currentId: string,
  allChains: Map<string, SavedChain>,
  path: string[],
): string[] | null {
  // Cycle detection: if we've seen this id in the current path, we have a cycle.
  if (path.includes(currentId)) {
    return [...path, currentId];
  }

  const current = allChains.get(currentId);
  if (!current) {
    return null; // reference to a missing chain; not a cycle per se
  }

  const newPath = [...path, currentId];

  for (const step of current.steps) {
    if (step.toolId.startsWith('user:')) {
      const referencedId = step.toolId.slice('user:'.length);
      const cycle = dfs(referencedId, allChains, newPath);
      if (cycle !== null) {
        return cycle;
      }
    }
  }

  return null;
}
```

- [ ] **Step 4: Update `packages/core/src/index.ts`**

Edit `packages/core/src/index.ts` to add:
```ts
export { detectCycle } from './chain/cycle.js';
```

- [ ] **Step 5: Run tests**

Run:
```bash
pnpm --filter @wyreup/core test
```
Expected: PASS (5 cycle tests + all previous tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/chain/cycle.ts packages/core/src/index.ts packages/core/test/chain/cycle.test.ts
git commit -m "feat(core): cycle detection for saved chains"
```

---

## Task 12: Tool registry skeleton

**Files:**
- Create: `packages/core/src/registry.ts`
- Create: `packages/core/test/registry.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/registry.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRegistry,
  type ToolRegistry,
} from '../src/registry.js';
import type { ToolModule } from '../src/types.js';

function makeTool(overrides: Partial<ToolModule> = {}): ToolModule {
  return {
    id: 'test',
    slug: 'test',
    name: 'Test',
    description: 'Test tool',
    category: 'optimize',
    presence: 'both',
    keywords: ['test'],
    input: { accept: ['image/*'], min: 1 },
    output: { mime: 'image/png' },
    interactive: false,
    batchable: true,
    cost: 'free',
    memoryEstimate: 'low',
    defaults: {},
    Component: () => null,
    run: async () => new Blob(),
    __testFixtures: { valid: [], weird: [], expectedOutputMime: [] },
    ...overrides,
  } as ToolModule;
}

describe('registry', () => {
  let registry: ToolRegistry;
  let compress: ToolModule;
  let convert: ToolModule;
  let mergePdf: ToolModule;

  beforeEach(() => {
    compress = makeTool({
      id: 'compress',
      name: 'Compress',
      category: 'optimize',
      keywords: ['compress', 'shrink', 'reduce'],
    });
    convert = makeTool({
      id: 'convert',
      name: 'Convert format',
      category: 'convert',
      keywords: ['convert', 'format'],
      input: { accept: ['image/png', 'image/jpeg'], min: 1 },
    });
    mergePdf = makeTool({
      id: 'merge-pdf',
      name: 'Merge PDFs',
      category: 'pdf',
      keywords: ['merge', 'pdf', 'combine'],
      input: { accept: ['application/pdf'], min: 2 },
    });

    registry = createRegistry([compress, convert, mergePdf]);
  });

  it('looks up tools by id', () => {
    expect(registry.toolsById.get('compress')).toBe(compress);
    expect(registry.toolsById.get('merge-pdf')).toBe(mergePdf);
    expect(registry.toolsById.get('missing')).toBeUndefined();
  });

  it('filters tools by category', () => {
    const pdfTools = registry.toolsByCategory('pdf');
    expect(pdfTools).toEqual([mergePdf]);
    const optimizeTools = registry.toolsByCategory('optimize');
    expect(optimizeTools).toEqual([compress]);
  });

  it('finds tools compatible with a single image file', () => {
    const pngFile = new File([], 'x.png', { type: 'image/png' });
    const compatible = registry.toolsForFiles([pngFile]);
    expect(compatible).toContain(compress);
    expect(compatible).toContain(convert);
    expect(compatible).not.toContain(mergePdf);
  });

  it('finds tools compatible with multiple PDFs (respects min count)', () => {
    const pdf1 = new File([], 'a.pdf', { type: 'application/pdf' });
    const pdf2 = new File([], 'b.pdf', { type: 'application/pdf' });
    const compatible = registry.toolsForFiles([pdf1, pdf2]);
    expect(compatible).toContain(mergePdf);
  });

  it('does not suggest tools whose min count is unmet', () => {
    const pdf1 = new File([], 'a.pdf', { type: 'application/pdf' });
    const compatible = registry.toolsForFiles([pdf1]);
    expect(compatible).not.toContain(mergePdf);
  });

  it('searchTools matches by keyword', () => {
    const results = registry.searchTools('shrink');
    expect(results).toContain(compress);
  });

  it('searchTools matches by name substring', () => {
    const results = registry.searchTools('merge');
    expect(results).toContain(mergePdf);
  });

  it('searchTools returns empty for no match', () => {
    const results = registry.searchTools('nonexistent-query-xyz');
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @wyreup/core test
```
Expected: FAIL — `Cannot find module '../src/registry.js'`.

- [ ] **Step 3: Create `packages/core/src/registry.ts`**

Create `packages/core/src/registry.ts`:
```ts
import type { ToolModule, ToolCategory, MimePattern } from './types.js';

export interface ToolRegistry {
  /** All tools, in registration order. */
  readonly tools: readonly ToolModule[];
  /** Fast lookup by tool id. */
  readonly toolsById: ReadonlyMap<string, ToolModule>;
  /** All tools matching a category. */
  toolsByCategory(category: ToolCategory): ToolModule[];
  /** Tools whose input spec is satisfied by the given files. */
  toolsForFiles(files: File[]): ToolModule[];
  /** Fuzzy-ish search across id, name, description, keywords. */
  searchTools(query: string): ToolModule[];
}

/**
 * Create a registry over a fixed list of tools. The registry is the single
 * source of truth consumed by the editor, command palette, sitemap generator,
 * MCP server schema generator, and CLI.
 */
export function createRegistry(tools: ToolModule[]): ToolRegistry {
  const toolsById = new Map(tools.map((t) => [t.id, t]));

  function toolsByCategory(category: ToolCategory): ToolModule[] {
    return tools.filter((t) => t.category === category);
  }

  function toolsForFiles(files: File[]): ToolModule[] {
    if (files.length === 0) {
      // Tools with min: 0 (e.g. qr generator) are always available.
      return tools.filter((t) => t.input.min === 0);
    }
    return tools.filter((t) => filesMatchInput(files, t.input));
  }

  function searchTools(query: string): ToolModule[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return tools.filter((t) => {
      if (t.id.toLowerCase().includes(q)) return true;
      if (t.name.toLowerCase().includes(q)) return true;
      if (t.description.toLowerCase().includes(q)) return true;
      if (t.keywords.some((k) => k.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  return {
    tools,
    toolsById,
    toolsByCategory,
    toolsForFiles,
    searchTools,
  };
}

/**
 * Check whether a set of files satisfies a tool's input specification.
 * - File count must be between min and max (inclusive).
 * - Every file's MIME type must match one of the accept patterns.
 */
function filesMatchInput(
  files: File[],
  input: ToolModule['input'],
): boolean {
  if (files.length < input.min) return false;
  if (input.max !== undefined && files.length > input.max) return false;
  return files.every((f) => input.accept.some((p) => mimeMatches(f.type, p)));
}

/**
 * Match a MIME type against a pattern. Supports simple wildcards like
 * 'image/*' matching any 'image/<x>'.
 */
export function mimeMatches(mime: string, pattern: MimePattern): boolean {
  if (pattern === '*' || pattern === '*/*') return true;
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -1); // 'image/'
    return mime.startsWith(prefix);
  }
  return mime === pattern;
}
```

- [ ] **Step 4: Update `packages/core/src/index.ts`**

Edit `packages/core/src/index.ts` to add:
```ts
export { createRegistry, mimeMatches, type ToolRegistry } from './registry.js';
```

- [ ] **Step 5: Run tests**

Run:
```bash
pnpm --filter @wyreup/core test
```
Expected: PASS (all registry tests green; all previous tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/registry.ts packages/core/src/index.ts packages/core/test/registry.test.ts
git commit -m "feat(core): tool registry with type-compatibility filtering"
```

---

## Task 13: Runtime adapter interface (browser + node)

**Files:**
- Create: `packages/core/src/runtime/types.ts`
- Create: `packages/core/src/runtime/browser.ts`
- Create: `packages/core/src/runtime/node.ts`
- Create: `packages/core/test/runtime/runtime.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/runtime/runtime.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { getRuntimeAdapter } from '../../src/runtime/types.js';

describe('runtime adapter', () => {
  it('getRuntimeAdapter returns an object with expected methods', () => {
    const adapter = getRuntimeAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.createCanvas).toBe('function');
    expect(typeof adapter.createImageFromBlob).toBe('function');
    expect(typeof adapter.isAvailable).toBe('function');
  });

  it('adapter reports availability', () => {
    const adapter = getRuntimeAdapter();
    const available = adapter.isAvailable();
    expect(typeof available).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter @wyreup/core test
```
Expected: FAIL — `Cannot find module '../../src/runtime/types.js'`.

- [ ] **Step 3: Create `packages/core/src/runtime/types.ts`**

Create `packages/core/src/runtime/types.ts`:
```ts
/**
 * Runtime adapter interface. Bridges between browser and node implementations
 * of canvas, image decoding, and related platform APIs that tools depend on.
 *
 * Tools import `getRuntimeAdapter()` and call its methods, staying agnostic
 * to which runtime they're in. The adapter is resolved at build time via
 * conditional exports in package.json (browser vs node).
 */
export interface RuntimeAdapter {
  /** Whether this runtime is actually usable (has required APIs). */
  isAvailable(): boolean;

  /**
   * Create an OffscreenCanvas-compatible surface. In browsers, this returns
   * an OffscreenCanvas. In Node, it returns a @napi-rs/canvas equivalent.
   * Wave 0: placeholder that throws NotImplementedError.
   */
  createCanvas(width: number, height: number): unknown;

  /**
   * Decode a Blob into an ImageBitmap-compatible structure. In browsers,
   * this uses `createImageBitmap()`. In Node, this uses the canvas library's
   * image loading. Wave 0: placeholder.
   */
  createImageFromBlob(blob: Blob): Promise<unknown>;
}

/**
 * Default adapter that always reports unavailable. Wave 0 uses this as a
 * placeholder. Wave 1 replaces it with proper browser.ts and node.ts
 * implementations wired via conditional exports.
 */
class PlaceholderAdapter implements RuntimeAdapter {
  isAvailable(): boolean {
    return false;
  }

  createCanvas(_width: number, _height: number): unknown {
    throw new Error('Runtime adapter not implemented in Wave 0');
  }

  createImageFromBlob(_blob: Blob): Promise<unknown> {
    throw new Error('Runtime adapter not implemented in Wave 0');
  }
}

/**
 * Get the current runtime adapter. Wave 0 returns a placeholder that
 * reports unavailable. Wave 1 will wire proper browser/node implementations
 * via conditional exports in package.json.
 */
export function getRuntimeAdapter(): RuntimeAdapter {
  return new PlaceholderAdapter();
}
```

- [ ] **Step 4: Create `packages/core/src/runtime/browser.ts`**

Create `packages/core/src/runtime/browser.ts`:
```ts
// Browser runtime adapter. Wave 0 placeholder; populated in Wave 1.
// Consumed via conditional exports when the package is imported in a browser context.

import type { RuntimeAdapter } from './types.js';

export const browserAdapter: RuntimeAdapter = {
  isAvailable(): boolean {
    return (
      typeof globalThis !== 'undefined' &&
      typeof (globalThis as unknown as { OffscreenCanvas?: unknown }).OffscreenCanvas !== 'undefined'
    );
  },
  createCanvas(_width: number, _height: number): unknown {
    throw new Error('browserAdapter.createCanvas: Wave 1 implementation pending');
  },
  createImageFromBlob(_blob: Blob): Promise<unknown> {
    throw new Error('browserAdapter.createImageFromBlob: Wave 1 implementation pending');
  },
};
```

- [ ] **Step 5: Create `packages/core/src/runtime/node.ts`**

Create `packages/core/src/runtime/node.ts`:
```ts
// Node runtime adapter. Wave 0 placeholder; populated in Wave 1 using
// @napi-rs/canvas for canvas operations. Consumed via conditional exports
// when the package is imported in a Node context.

import type { RuntimeAdapter } from './types.js';

export const nodeAdapter: RuntimeAdapter = {
  isAvailable(): boolean {
    return typeof process !== 'undefined' && typeof process.versions?.node === 'string';
  },
  createCanvas(_width: number, _height: number): unknown {
    throw new Error('nodeAdapter.createCanvas: Wave 1 implementation pending (will use @napi-rs/canvas)');
  },
  createImageFromBlob(_blob: Blob): Promise<unknown> {
    throw new Error('nodeAdapter.createImageFromBlob: Wave 1 implementation pending');
  },
};
```

- [ ] **Step 6: Update `packages/core/src/index.ts`**

Edit `packages/core/src/index.ts` to add:
```ts
export { getRuntimeAdapter, type RuntimeAdapter } from './runtime/types.js';
```

- [ ] **Step 7: Run tests**

Run:
```bash
pnpm --filter @wyreup/core test
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/runtime packages/core/src/index.ts packages/core/test/runtime
git commit -m "feat(core): runtime adapter interface with browser and node stubs"
```

---

## Task 14: Configure tsup for dual browser/node builds

**Files:**
- Create: `packages/core/tsup.config.ts`
- Modify: `packages/core/package.json`

- [ ] **Step 1: Install tsup in `@wyreup/core`**

Run:
```bash
pnpm install
```
(This should already have tsup from Task 8's package.json, but ensure it's resolved.)

- [ ] **Step 2: Create `packages/core/tsup.config.ts`**

Create `packages/core/tsup.config.ts`:
```ts
import { defineConfig } from 'tsup';

export default defineConfig([
  // Browser build — uses browser runtime adapter.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    outDir: 'dist/browser',
    platform: 'browser',
    target: 'es2022',
    clean: true,
    sourcemap: true,
    treeshake: true,
  },
  // Node build — uses node runtime adapter.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    outDir: 'dist/node',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    treeshake: true,
  },
]);
```

- [ ] **Step 3: Run the build**

Run:
```bash
pnpm --filter @wyreup/core build
```
Expected: Both browser and node builds emit to `packages/core/dist/browser/` and `packages/core/dist/node/`. No errors.

- [ ] **Step 4: Verify the output exists**

Run:
```bash
ls packages/core/dist/browser/ packages/core/dist/node/
```
Expected: `index.js`, `index.d.ts` in both (Node also has `index.cjs`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/tsup.config.ts
git commit -m "build(core): configure tsup for dual browser/node builds"
```

---

## Task 15: Scaffold `@wyreup/web` package (Astro)

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/astro.config.mjs`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/src/pages/index.astro`
- Create: `packages/web/src/layouts/BaseLayout.astro`
- Create: `packages/web/public/robots.txt`
- Create: `packages/web/README.md`

- [ ] **Step 1: Create package directory structure**

Run:
```bash
mkdir -p packages/web/src/pages packages/web/src/layouts packages/web/src/components packages/web/public
```

- [ ] **Step 2: Create `packages/web/package.json`**

Create `packages/web/package.json`:
```json
{
  "name": "@wyreup/web",
  "version": "0.0.0",
  "description": "Wyreup web app — wyreup.com",
  "license": "MIT",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "test": "vitest run",
    "lint": "eslint src",
    "typecheck": "astro check && tsc --noEmit",
    "clean": "rm -rf dist .astro .turbo"
  },
  "dependencies": {
    "@wyreup/core": "workspace:*",
    "astro": "^4.15.0"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create `packages/web/astro.config.mjs`**

Create `packages/web/astro.config.mjs`:
```js
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://wyreup.com',
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
  },
});
```

- [ ] **Step 4: Create `packages/web/tsconfig.json`**

Create `packages/web/tsconfig.json`:
```json
{
  "extends": "astro/tsconfigs/strict",
  "include": ["src/**/*", ".astro/types.d.ts"],
  "exclude": ["dist", ".astro"]
}
```

- [ ] **Step 5: Create `packages/web/src/layouts/BaseLayout.astro`**

Create `packages/web/src/layouts/BaseLayout.astro`:
```astro
---
interface Props {
  title: string;
  description?: string;
}

const { title, description = 'Wyreup — free, privacy-first tool library' } = Astro.props;
---

<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <title>{title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>
```

- [ ] **Step 6: Create `packages/web/src/pages/index.astro`**

Create `packages/web/src/pages/index.astro`:
```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---

<BaseLayout title="Wyreup — Coming Soon">
  <main>
    <h1>Wyreup</h1>
    <p>Wire up your tools. One thing to another, free forever.</p>
    <p><em>Foundation scaffolding in progress. Tools coming in Wave 1.</em></p>
  </main>
</BaseLayout>
```

- [ ] **Step 7: Create `packages/web/public/robots.txt`**

Create `packages/web/public/robots.txt`:
```
User-agent: *
Disallow: /

# Foundation scaffolding — no content to index yet. Wave 1 will open indexing.
```

- [ ] **Step 8: Create `packages/web/README.md`**

Create `packages/web/README.md`:
```markdown
# @wyreup/web

The Wyreup website. Astro + Cloudflare Pages static site.

## Structure

- `src/pages/` — route-per-file Astro pages
- `src/layouts/` — shared layouts
- `src/components/` — reusable components
- `public/` — static assets

## Status

Wave 0 foundation scaffolding. Placeholder home page only.
```

- [ ] **Step 9: Install dependencies**

Run:
```bash
pnpm install
```
Expected: Astro and friends install. `@wyreup/core` linked via workspace.

- [ ] **Step 10: Build the site**

Run:
```bash
pnpm --filter @wyreup/web build
```
Expected: Astro builds successfully. Output in `packages/web/dist/`.

- [ ] **Step 11: Commit**

```bash
git add packages/web package.json pnpm-lock.yaml
git commit -m "feat(web): scaffold @wyreup/web Astro site"
```

---

## Task 16: Scaffold `@wyreup/mcp` package

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/index.ts`
- Create: `packages/mcp/src/server.ts`
- Create: `packages/mcp/README.md`

- [ ] **Step 1: Create package directory structure**

Run:
```bash
mkdir -p packages/mcp/src packages/mcp/test
```

- [ ] **Step 2: Create `packages/mcp/package.json`**

Create `packages/mcp/package.json`:
```json
{
  "name": "@wyreup/mcp",
  "version": "0.0.0",
  "description": "Wyreup MCP server — agent-accessible tool library",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "wyreup-mcp": "./dist/index.js"
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "test": "vitest run",
    "lint": "eslint src test",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@wyreup/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create `packages/mcp/tsconfig.json`**

Create `packages/mcp/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create `packages/mcp/src/server.ts`**

Create `packages/mcp/src/server.ts`:
```ts
import { createRegistry, type ToolRegistry } from '@wyreup/core';

/**
 * Wyreup MCP server state. Wave 0 scaffold: wraps an empty registry.
 * Wave 1 will add real tools and MCP protocol handlers.
 */
export interface WyreupMcpServer {
  registry: ToolRegistry;
  start(): Promise<void>;
}

export function createWyreupMcpServer(): WyreupMcpServer {
  const registry = createRegistry([]);

  return {
    registry,
    async start(): Promise<void> {
      console.error(
        `[wyreup-mcp] starting with ${registry.tools.length} tool(s) registered (Wave 0 scaffold)`,
      );
      // Wave 1: connect to MCP transport (stdio), handle list_tools / call_tool.
    },
  };
}
```

- [ ] **Step 5: Create `packages/mcp/src/index.ts`**

Create `packages/mcp/src/index.ts`:
```ts
#!/usr/bin/env node
import { createWyreupMcpServer } from './server.js';

async function main(): Promise<void> {
  const server = createWyreupMcpServer();
  await server.start();
}

main().catch((err: unknown) => {
  console.error('[wyreup-mcp] fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 6: Create `packages/mcp/README.md`**

Create `packages/mcp/README.md`:
```markdown
# @wyreup/mcp

MCP server exposing Wyreup tools to agents (Claude, Continue, Cursor, any MCP-aware client).

## Usage

```bash
npx @wyreup/mcp
```

## Status

Wave 0 foundation scaffolding. Empty tool list; Wave 1 will connect the full registry.
```

- [ ] **Step 7: Install dependencies**

Run:
```bash
pnpm install
```

- [ ] **Step 8: Build**

Run:
```bash
pnpm --filter @wyreup/mcp build
```
Expected: Build succeeds. `packages/mcp/dist/index.js` exists.

- [ ] **Step 9: Smoke-test the binary**

Run:
```bash
node packages/mcp/dist/index.js
```
Expected: stderr shows `[wyreup-mcp] starting with 0 tool(s) registered (Wave 0 scaffold)`. Process exits cleanly (or hangs — kill with Ctrl+C; Wave 1 will add a transport loop).

- [ ] **Step 10: Commit**

```bash
git add packages/mcp package.json pnpm-lock.yaml
git commit -m "feat(mcp): scaffold @wyreup/mcp server"
```

---

## Task 17: Scaffold `@wyreup/cli` package

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/list.ts`
- Create: `packages/cli/README.md`

- [ ] **Step 1: Create package directory structure**

Run:
```bash
mkdir -p packages/cli/src/commands packages/cli/test
```

- [ ] **Step 2: Create `packages/cli/package.json`**

Create `packages/cli/package.json`:
```json
{
  "name": "@wyreup/cli",
  "version": "0.0.0",
  "description": "Wyreup CLI — wire up your tools from the shell",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "wyreup": "./dist/index.js"
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "test": "vitest run",
    "lint": "eslint src test",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@wyreup/core": "workspace:*",
    "commander": "^12.1.0"
  },
  "devDependencies": {
    "tsup": "^8.3.0",
    "typescript": "^5.5.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create `packages/cli/tsconfig.json`**

Create `packages/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022"]
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: Create `packages/cli/src/commands/list.ts`**

Create `packages/cli/src/commands/list.ts`:
```ts
import { createRegistry } from '@wyreup/core';

export function listCommand(): void {
  const registry = createRegistry([]);
  if (registry.tools.length === 0) {
    console.log('No tools available yet (Wave 0 scaffold).');
    return;
  }
  for (const tool of registry.tools) {
    console.log(`${tool.id} — ${tool.description}`);
  }
}
```

- [ ] **Step 5: Create `packages/cli/src/index.ts`**

Create `packages/cli/src/index.ts`:
```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { listCommand } from './commands/list.js';

const program = new Command();

program
  .name('wyreup')
  .description('Wyreup CLI — wire up your tools from the shell')
  .version('0.0.0');

program
  .command('list')
  .description('List available tools')
  .action(() => {
    listCommand();
  });

program.parse();
```

- [ ] **Step 6: Create `packages/cli/README.md`**

Create `packages/cli/README.md`:
```markdown
# @wyreup/cli

The `wyreup` command-line interface.

## Usage

```bash
pnpm add -g @wyreup/cli
wyreup --help
wyreup list
```

## Status

Wave 0 foundation scaffolding. Only `wyreup list` (reports zero tools) is wired.
```

- [ ] **Step 7: Install and build**

Run:
```bash
pnpm install
pnpm --filter @wyreup/cli build
```
Expected: Build succeeds.

- [ ] **Step 8: Smoke-test the binary**

Run:
```bash
node packages/cli/dist/index.js --help
```
Expected: Commander prints help text showing `list` command.

Run:
```bash
node packages/cli/dist/index.js list
```
Expected: `No tools available yet (Wave 0 scaffold).`

- [ ] **Step 9: Commit**

```bash
git add packages/cli package.json pnpm-lock.yaml
git commit -m "feat(cli): scaffold @wyreup/cli with list command"
```

---

## Task 18: Scaffold `claude-code-wyreup-skill`

**Files:**
- Create: `packages/claude-skill/package.json`
- Create: `packages/claude-skill/skill.md`
- Create: `packages/claude-skill/README.md`

- [ ] **Step 1: Create package directory**

Run:
```bash
mkdir -p packages/claude-skill
```

- [ ] **Step 2: Create `packages/claude-skill/package.json`**

Create `packages/claude-skill/package.json`:
```json
{
  "name": "claude-code-wyreup-skill",
  "version": "0.0.0",
  "description": "Claude Code skill teaching Claude how to use Wyreup",
  "license": "MIT",
  "private": true,
  "files": ["skill.md", "README.md"],
  "scripts": {
    "build": "echo 'no build step for skill'",
    "test": "echo 'no tests for skill'",
    "lint": "echo 'no lint for skill'",
    "typecheck": "echo 'no typecheck for skill'",
    "clean": "echo 'nothing to clean'"
  }
}
```

- [ ] **Step 3: Create `packages/claude-skill/skill.md`**

Create `packages/claude-skill/skill.md`:
```markdown
---
name: wyreup
description: Free, privacy-first tool library for transforming files. Use when the user needs to process images, PDFs, or other files without uploading them to a cloud service.
---

# Wyreup

Wyreup is a free, privacy-first, open-source tool library for transforming files. Every operation runs locally — on the user's device in the browser, or on their machine via CLI/MCP server. No uploads, no accounts (for free tools), no rate limits.

## When to use

- Image tasks: compress, convert format, crop, resize, rotate, remove background, strip EXIF, blur faces, watermark, color palette extraction, collage, GIF maker, image diff, favicon generation, filters.
- PDF tasks: merge, split, rotate, compress, reorder, page numbers, watermark, password protect/unlock, PDF→text, HTML→PDF, sign.

## Status

Wave 0 foundation — tools are not yet connected. This skill file will be populated as Wave 1 adds the tool registry.
```

- [ ] **Step 4: Create `packages/claude-skill/README.md`**

Create `packages/claude-skill/README.md`:
```markdown
# claude-code-wyreup-skill

Claude Code skill that teaches Claude how to invoke Wyreup tools effectively.

Not published to npm — installed by users into their Claude Code configuration or via a plugin.

## Status

Wave 0 foundation — skill content is a placeholder. Wave 1 will add real tool invocation examples.
```

- [ ] **Step 5: Commit**

```bash
git add packages/claude-skill
git commit -m "feat(skill): scaffold claude-code-wyreup-skill placeholder"
```

---

## Task 19: CI check — isolation enforcement

**Files:**
- Create: `tools/check-isolation.mjs`
- Create: `tools/test/check-isolation.test.mjs`
- Create: `tools/package.json`

- [ ] **Step 1: Create `tools/` directory and package.json**

Run:
```bash
mkdir -p tools/test
```

Create `tools/package.json`:
```json
{
  "name": "wyreup-tools",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Repo-level CI check scripts for Wyreup",
  "scripts": {
    "check:isolation": "node check-isolation.mjs",
    "check:privacy": "node check-privacy.mjs",
    "check:bundle-size": "node check-bundle-size.mjs",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tools/test/check-isolation.test.mjs`:
```js
import { describe, it, expect } from 'vitest';
import { checkIsolation } from '../check-isolation.mjs';

describe('checkIsolation', () => {
  it('passes when @wyreup/core imports nothing framework-shaped', async () => {
    const result = await checkIsolation({
      coreDir: 'packages/core/src',
      forbiddenPackages: ['astro', 'react', 'react-dom', 'preact', 'svelte', 'vue'],
    });
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
pnpm install
cd tools && pnpm test
```
Expected: FAIL — `Cannot find module '../check-isolation.mjs'`.

- [ ] **Step 4: Create `tools/check-isolation.mjs`**

Create `tools/check-isolation.mjs`:
```js
// Isolation check: @wyreup/core must not import from UI frameworks.
// Walks every .ts/.tsx file in packages/core/src and scans import statements.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @param {object} options
 * @param {string} options.coreDir
 * @param {string[]} options.forbiddenPackages
 * @returns {Promise<{ ok: boolean, violations: Array<{ file: string, importPath: string }> }>}
 */
export async function checkIsolation({ coreDir, forbiddenPackages }) {
  const violations = [];
  const files = await walkDir(coreDir);

  for (const file of files) {
    if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
    const content = await readFile(file, 'utf8');
    const importMatches = content.matchAll(/(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*\{[^}]*\})?\s*from\s+['"]([^'"]+)['"]/g);

    for (const match of importMatches) {
      const importPath = match[1];
      if (importPath.startsWith('.') || importPath.startsWith('/')) continue; // relative
      const pkg = importPath.startsWith('@')
        ? importPath.split('/').slice(0, 2).join('/')
        : importPath.split('/')[0];
      if (forbiddenPackages.includes(pkg)) {
        violations.push({ file, importPath });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

async function walkDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await checkIsolation({
    coreDir: 'packages/core/src',
    forbiddenPackages: ['astro', 'react', 'react-dom', 'preact', 'svelte', 'vue', '@astrojs/check'],
  });

  if (!result.ok) {
    console.error('Isolation check FAILED:');
    for (const v of result.violations) {
      console.error(`  ${v.file}: imports "${v.importPath}"`);
    }
    process.exit(1);
  }

  console.log(`Isolation check passed (${result.violations.length} violations)`);
}
```

- [ ] **Step 5: Run tests**

Run:
```bash
cd tools && pnpm test
```
Expected: PASS.

- [ ] **Step 6: Run the check directly**

Run:
```bash
cd .. && node tools/check-isolation.mjs
```
Expected: `Isolation check passed (0 violations)`.

- [ ] **Step 7: Commit**

```bash
git add tools/check-isolation.mjs tools/test tools/package.json pnpm-lock.yaml
git commit -m "ci: add isolation check for @wyreup/core framework independence"
```

---

## Task 20: CI check — privacy scan

**Files:**
- Create: `tools/check-privacy.mjs`
- Create: `tools/test/check-privacy.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tools/test/check-privacy.test.mjs`:
```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { checkPrivacy } from '../check-privacy.mjs';

const TEST_DIR = 'tools/test/.tmp-privacy';

describe('checkPrivacy', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('passes when built output contains only allowlisted domains', async () => {
    await writeFile(
      `${TEST_DIR}/index.html`,
      '<script src="https://static.cloudflareinsights.com/beacon.js"></script>',
    );
    const result = await checkPrivacy({
      distDir: TEST_DIR,
      allowlist: ['wyreup.com', 'static.cloudflareinsights.com'],
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('fails on disallowed external domain', async () => {
    await writeFile(
      `${TEST_DIR}/index.html`,
      '<script src="https://cdn.evil.example/track.js"></script>',
    );
    const result = await checkPrivacy({
      distDir: TEST_DIR,
      allowlist: ['wyreup.com', 'static.cloudflareinsights.com'],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0].domain).toBe('cdn.evil.example');
  });

  it('ignores relative paths and same-origin references', async () => {
    await writeFile(
      `${TEST_DIR}/index.html`,
      '<link href="/styles.css" /><script src="./app.js"></script>',
    );
    const result = await checkPrivacy({
      distDir: TEST_DIR,
      allowlist: ['wyreup.com'],
    });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd tools && pnpm test
```
Expected: FAIL — `Cannot find module '../check-privacy.mjs'`.

- [ ] **Step 3: Create `tools/check-privacy.mjs`**

Create `tools/check-privacy.mjs`:
```js
// Privacy scan: grep built output for external domain references.
// Belt-and-suspenders alongside runtime CSP (which is the primary enforcement).
// Catches honest mistakes like "I forgot this was a CDN link" before they ship.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @param {object} options
 * @param {string} options.distDir
 * @param {string[]} options.allowlist
 * @returns {Promise<{ ok: boolean, violations: Array<{ file: string, domain: string }> }>}
 */
export async function checkPrivacy({ distDir, allowlist }) {
  const violations = [];
  const files = await walkDir(distDir);

  // Match http://... or https://... URLs (but not relative paths).
  const urlRegex = /https?:\/\/([a-zA-Z0-9.-]+)/g;

  for (const file of files) {
    if (!isScannable(file)) continue;
    const content = await readFile(file, 'utf8');

    for (const match of content.matchAll(urlRegex)) {
      const domain = match[1];
      if (isAllowed(domain, allowlist)) continue;
      violations.push({ file, domain });
    }
  }

  // Deduplicate by file+domain pair
  const dedup = new Map();
  for (const v of violations) {
    dedup.set(`${v.file}::${v.domain}`, v);
  }

  return {
    ok: dedup.size === 0,
    violations: Array.from(dedup.values()),
  };
}

function isAllowed(domain, allowlist) {
  return allowlist.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function isScannable(file) {
  return /\.(html|js|mjs|cjs|css|json|webmanifest|txt)$/i.test(file);
}

async function walkDir(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkDir(full)));
      } else {
        files.push(full);
      }
    }
    return files;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const distDirs = ['packages/web/dist', 'packages/core/dist'];
  const allowlist = ['wyreup.com', 'static.cloudflareinsights.com'];

  let totalViolations = 0;
  for (const dir of distDirs) {
    const result = await checkPrivacy({ distDir: dir, allowlist });
    if (!result.ok) {
      console.error(`Privacy scan FAILED in ${dir}:`);
      for (const v of result.violations) {
        console.error(`  ${v.file}: references "${v.domain}"`);
      }
      totalViolations += result.violations.length;
    }
  }

  if (totalViolations > 0) {
    process.exit(1);
  }
  console.log('Privacy scan passed');
}
```

- [ ] **Step 4: Run tests**

Run:
```bash
cd tools && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Run the check directly**

Run:
```bash
cd .. && pnpm --filter @wyreup/web build && node tools/check-privacy.mjs
```
Expected: `Privacy scan passed`.

- [ ] **Step 6: Commit**

```bash
git add tools/check-privacy.mjs tools/test/check-privacy.test.mjs
git commit -m "ci: add privacy scan for external domains in built output"
```

---

## Task 21: CI check — bundle size budget

**Files:**
- Create: `tools/check-bundle-size.mjs`
- Create: `tools/test/check-bundle-size.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tools/test/check-bundle-size.test.mjs`:
```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { checkBundleSize } from '../check-bundle-size.mjs';

const TEST_DIR = 'tools/test/.tmp-bundle';

describe('checkBundleSize', () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('passes when total gzipped size is under budget', async () => {
    // Write a small file that gzips to well under 1 KB.
    await writeFile(`${TEST_DIR}/a.js`, 'console.log("small");');
    const result = await checkBundleSize({
      targetDir: TEST_DIR,
      maxGzipKb: 150,
      extensions: ['.js'],
    });
    expect(result.ok).toBe(true);
  });

  it('fails when a file exceeds the budget', async () => {
    // Write a large, high-entropy file that will not gzip below the limit.
    const big = Array.from({ length: 60_000 }, () => Math.random().toString(36)).join('\n');
    await writeFile(`${TEST_DIR}/big.js`, big);
    const result = await checkBundleSize({
      targetDir: TEST_DIR,
      maxGzipKb: 1,
      extensions: ['.js'],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd tools && pnpm test
```
Expected: FAIL — `Cannot find module '../check-bundle-size.mjs'`.

- [ ] **Step 3: Create `tools/check-bundle-size.mjs`**

Create `tools/check-bundle-size.mjs`:
```js
// Bundle size check: enforce per-file gzipped size budget.
// Wave 0 scaffold: simple per-file check. Wave 1 will add per-page entry-point analysis.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';

const gzipAsync = promisify(gzip);

/**
 * @param {object} options
 * @param {string} options.targetDir
 * @param {number} options.maxGzipKb
 * @param {string[]} options.extensions
 * @returns {Promise<{ ok: boolean, violations: Array<{ file: string, sizeKb: number }> }>}
 */
export async function checkBundleSize({ targetDir, maxGzipKb, extensions }) {
  const violations = [];
  const files = await walkDir(targetDir);

  for (const file of files) {
    if (!extensions.some((ext) => file.endsWith(ext))) continue;
    const content = await readFile(file);
    const gzipped = await gzipAsync(content);
    const sizeKb = gzipped.length / 1024;
    if (sizeKb > maxGzipKb) {
      violations.push({ file, sizeKb: Number(sizeKb.toFixed(2)) });
    }
  }

  return { ok: violations.length === 0, violations };
}

async function walkDir(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkDir(full)));
      } else {
        files.push(full);
      }
    }
    return files;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await checkBundleSize({
    targetDir: 'packages/web/dist',
    maxGzipKb: 150,
    extensions: ['.js', '.mjs'],
  });

  if (!result.ok) {
    console.error('Bundle size check FAILED:');
    for (const v of result.violations) {
      console.error(`  ${v.file}: ${v.sizeKb} KB (budget 150 KB)`);
    }
    process.exit(1);
  }

  console.log(`Bundle size check passed (${result.violations.length} violations)`);
}
```

- [ ] **Step 4: Run tests**

Run:
```bash
cd tools && pnpm test
```
Expected: PASS.

- [ ] **Step 5: Run the check directly**

Run:
```bash
cd .. && node tools/check-bundle-size.mjs
```
Expected: `Bundle size check passed (0 violations)`.

- [ ] **Step 6: Commit**

```bash
git add tools/check-bundle-size.mjs tools/test/check-bundle-size.test.mjs
git commit -m "ci: add bundle size budget check"
```

---

## Task 22: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/` directory**

Run:
```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

Create `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-and-types:
    name: Lint + Types
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint:root
      - run: pnpm typecheck

  unit-tests:
    name: Unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: |
            packages/*/dist
            !packages/*/dist/**/*.map

  isolation-check:
    name: Isolation check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: node tools/check-isolation.mjs

  privacy-scan:
    name: Privacy scan
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: node tools/check-privacy.mjs

  bundle-size:
    name: Bundle size
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: node tools/check-bundle-size.mjs
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add github actions workflow"
```

---

## Task 23: Changesets setup

**Files:**
- Create: `.changeset/config.json`
- Create: `.changeset/README.md`

- [ ] **Step 1: Install Changesets**

Run:
```bash
pnpm add -Dw @changesets/cli@^2.27.0
```

- [ ] **Step 2: Initialize Changesets**

Run:
```bash
pnpm exec changeset init
```
Expected: `.changeset/` directory created with config.json and README.md.

- [ ] **Step 3: Update `.changeset/config.json`**

Edit `.changeset/config.json` to match:
```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["@wyreup/web", "claude-code-wyreup-skill", "wyreup-tools"]
}
```

(The `ignore` list excludes packages that are not published to npm.)

- [ ] **Step 4: Add changeset scripts to root `package.json`**

Edit `package.json` `scripts` to add:
```json
    "changeset": "changeset",
    "changeset:version": "changeset version",
    "changeset:publish": "changeset publish"
```

- [ ] **Step 5: Commit**

```bash
git add .changeset package.json pnpm-lock.yaml
git commit -m "chore: configure changesets for versioning"
```

---

## Task 24: CONTRIBUTING, SECURITY, CODE_OF_CONDUCT

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CODE_OF_CONDUCT.md`

- [ ] **Step 1: Create `CONTRIBUTING.md`**

Create `CONTRIBUTING.md`:
```markdown
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
- Add tests (see §8 of the design spec for the TDD + UX gate expectations)
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
```

- [ ] **Step 2: Create `SECURITY.md`**

Create `SECURITY.md`:
```markdown
# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Instead, email security reports to the maintainers (address to be configured once the repo is public).

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
```

- [ ] **Step 3: Create `CODE_OF_CONDUCT.md`**

Create `CODE_OF_CONDUCT.md`:
```markdown
# Code of Conduct

Wyreup follows the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

We expect all contributors and participants in community spaces to:

- Be respectful and inclusive
- Accept constructive feedback gracefully
- Focus on what's best for the community
- Show empathy toward other community members

Unacceptable behavior (harassment, trolling, personal attacks, discrimination) will be addressed by maintainers and may result in temporary or permanent bans from the project.

Report issues to the maintainers via the same channel as security reports (see SECURITY.md).
```

- [ ] **Step 4: Commit**

```bash
git add CONTRIBUTING.md SECURITY.md CODE_OF_CONDUCT.md
git commit -m "docs: add contributing, security, and code of conduct"
```

---

## Task 25: Architecture docs reference

**Files:**
- Create: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Create `docs/ARCHITECTURE.md`**

Create `docs/ARCHITECTURE.md`:
```markdown
# Wyreup Architecture (Quick Reference)

See the full design specification: [`superpowers/specs/2026-04-15-wyreup-tool-library-design.md`](./superpowers/specs/2026-04-15-wyreup-tool-library-design.md).

## One-page summary

**Wyreup is a tool library with four surfaces.**

```
                ┌───────────────────────┐
                │   @wyreup/core        │
                │  Tool modules         │
                │  Chain engine         │
                │  Type graph           │
                │  Registry             │
                │  Runtime adapters     │
                │  (framework-free)     │
                └──────┬────────────────┘
                       │
        ┌──────────────┼──────────────┬────────────────┐
        ▼              ▼              ▼                ▼
   ┌─────────┐   ┌─────────┐    ┌─────────┐      ┌──────────┐
   │  web    │   │   mcp   │    │   cli   │      │  skill   │
   └─────────┘   └─────────┘    └─────────┘      └──────────┘
```

- **`@wyreup/core`** — the library. Framework-free. Dual browser/node build.
- **`@wyreup/web`** — wyreup.com, landing pages, editor, PWA (Astro + Cloudflare Pages).
- **`@wyreup/mcp`** — MCP server for agents.
- **`@wyreup/cli`** — `wyreup` command.
- **`claude-code-wyreup-skill`** — Claude Code skill teaching the agent how to use Wyreup.

## Invariants

- `@wyreup/core` imports nothing framework-shaped. CI enforces this.
- Free tier runs entirely client-side. CI enforces this via privacy scan + runtime CSP.
- Every tool is a `ToolModule` satisfying the same interface, regardless of surface.
- Chains are first-class tools. Saved chains become `ToolModule` instances at runtime.

## Status

Wave 0 foundation — scaffolding only. Wave 1 adds the first 8 tools across all four surfaces.
```

- [ ] **Step 2: Commit**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs: add architecture quick reference"
```

---

## Task 26: Full end-to-end verification

**Files:** none (verification task)

- [ ] **Step 1: Clean everything**

Run:
```bash
pnpm clean 2>/dev/null || true
rm -rf node_modules packages/*/node_modules packages/*/dist
```

- [ ] **Step 2: Fresh install**

Run:
```bash
pnpm install
```
Expected: all packages resolve, no errors.

- [ ] **Step 3: Lint**

Run:
```bash
pnpm lint:root
```
Expected: no errors.

- [ ] **Step 4: Typecheck**

Run:
```bash
pnpm typecheck
```
Expected: no type errors across all packages.

- [ ] **Step 5: Test**

Run:
```bash
pnpm test
```
Expected: all tests across `@wyreup/core` and `tools/` pass.

- [ ] **Step 6: Build**

Run:
```bash
pnpm build
```
Expected: all packages build successfully. `packages/core/dist/{browser,node}/`, `packages/web/dist/`, `packages/mcp/dist/`, `packages/cli/dist/` all exist.

- [ ] **Step 7: Isolation check**

Run:
```bash
node tools/check-isolation.mjs
```
Expected: `Isolation check passed (0 violations)`.

- [ ] **Step 8: Privacy scan**

Run:
```bash
node tools/check-privacy.mjs
```
Expected: `Privacy scan passed`.

- [ ] **Step 9: Bundle size check**

Run:
```bash
node tools/check-bundle-size.mjs
```
Expected: `Bundle size check passed (0 violations)`.

- [ ] **Step 10: CLI smoke test**

Run:
```bash
node packages/cli/dist/index.js --help
```
Expected: help text showing `list` command.

Run:
```bash
node packages/cli/dist/index.js list
```
Expected: `No tools available yet (Wave 0 scaffold).`

- [ ] **Step 11: MCP server smoke test**

Run:
```bash
node packages/mcp/dist/index.js 2>&1 | head -1
```
Expected: `[wyreup-mcp] starting with 0 tool(s) registered (Wave 0 scaffold)`.

- [ ] **Step 12: Web preview**

Run:
```bash
pnpm --filter @wyreup/web preview
```
Expected: Astro serves the placeholder home page at `http://localhost:4321`. Stop with Ctrl+C.

- [ ] **Step 13: Final commit marking wave 0 complete**

Run:
```bash
git log --oneline | head -30
```

If there are any uncommitted changes:
```bash
git status
git add -A
git commit -m "chore: wave 0 foundation complete"
```

- [ ] **Step 14: Add a tag**

Run:
```bash
git tag -a v0.0.0-wave0 -m "Wave 0 foundation scaffold complete"
```

---

## Plan exit criteria

Wave 0 is complete when all of the following are true:

1. **Repository structure** exists at the root with all five packages scaffolded under `packages/`.
2. **`@wyreup/core`** exports the full `ToolModule` type system, the chain engine skeleton with `MAX_CHAIN_DEPTH = 10`, cycle detection, the tool registry with type-compatibility filtering, and the runtime adapter interface. All public API types match the design spec §5.1.
3. **`@wyreup/web`** has a placeholder Astro site that builds and previews successfully.
4. **`@wyreup/mcp`** has a functional binary that starts and reports zero tools.
5. **`@wyreup/cli`** has a functional `wyreup list` command that reports zero tools.
6. **`claude-code-wyreup-skill`** has a placeholder skill.md file.
7. **CI workflow** runs lint, typecheck, test, build, isolation check, privacy scan, and bundle size check.
8. **Three custom CI checks** (isolation, privacy, bundle size) are implemented, tested, and passing.
9. **Changesets** is configured for versioning.
10. **Documentation** (README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, ARCHITECTURE) is in place.
11. **Full build is green** end-to-end (Task 26 verification passes cleanly).

## What's NOT in Wave 0 (deferred to subsequent plans)

- Any actual tool implementations (compress, convert, crop, etc.) — Wave 1a
- `@wyreup/web` landing pages, editor, PWA — Wave 1b
- `@wyreup/mcp` protocol transport (stdio loop, list_tools, call_tool) — Wave 1c
- `@wyreup/cli` per-tool invocation commands — Wave 1c
- Runtime adapter real implementations (`@napi-rs/canvas` in Node, `OffscreenCanvas` in browser) — Wave 1a
- Lighthouse CI, Playwright E2E, visual regression — Wave 1b (when there's something to test)
- Cloudflare Pages deployment configuration — Wave 1b
- Starter chains, chain import/export, chain-as-tool adapter — Wave 1c
- Any SEO alias pages — Wave 1b (after the first tool ships)

## Subsequent plan sequence

After Wave 0 ships cleanly, the plans that follow are:

- **Wave 1a:** `@wyreup/core` first tool end-to-end — `compress` — with real runtime adapters, CI fixture support, unit + integration tests. Establishes the tool module implementation pattern.
- **Wave 1b:** `@wyreup/web` first tool page + minimal editor shell + PWA install + Cloudflare Pages deploy.
- **Wave 1c:** `@wyreup/mcp` protocol wiring + `@wyreup/cli` command wiring + Claude Code skill population, all with the first tool.
- **Wave 1d:** Remaining 7 core tools (convert, crop, resize, rotate, remove-background, strip-exif, blur-faces) added across all four surfaces in parallel.

Each follow-up plan is its own document at `docs/superpowers/plans/2026-MM-DD-wyreup-wave-1x-<focus>.md`.
