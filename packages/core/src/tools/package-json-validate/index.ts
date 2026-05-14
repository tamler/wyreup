import type { ToolModule, ToolRunContext } from '../../types.js';

export interface PackageJsonValidateParams {
  /** When true, also flag practices (no description, no repository, no license, etc.). */
  strict?: boolean;
}

export const defaultPackageJsonValidateParams: PackageJsonValidateParams = {
  strict: false,
};

export interface PackageJsonIssue {
  path: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface PackageJsonValidateResult {
  valid: boolean;
  name: string | null;
  version: string | null;
  issues: PackageJsonIssue[];
  stats: {
    dependencyCount: number;
    devDependencyCount: number;
    peerDependencyCount: number;
    scriptCount: number;
  };
}

// npm name rules (simplified): lowercase, length 1..214, no leading dot/underscore,
// no spaces, only URL-safe chars. Supports scoped names @scope/name.
const VALID_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
// Lenient semver: M.m.p with optional prerelease/build. Range/version refs handled separately.
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
// Dependency version specifier — accepts semver ranges, git URLs, file:, npm:, workspace:, *, latest, etc.
const DEP_SPEC_RE = /^(?:\*|latest|next|workspace:.*|file:.*|link:.*|npm:.*|git\+.*|git:.*|https?:.*|github:.*|[~^>=<* ]*\d|\d|[a-zA-Z]+\/[a-zA-Z].+)/;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!isObject(v)) return false;
  for (const val of Object.values(v)) {
    if (typeof val !== 'string') return false;
  }
  return true;
}

export function validatePackageJson(doc: unknown, strict: boolean): PackageJsonValidateResult {
  const issues: PackageJsonIssue[] = [];
  const push = (severity: PackageJsonIssue['severity'], path: string, message: string): void => {
    issues.push({ severity, path, message });
  };

  if (!isObject(doc)) {
    push('error', '$', 'package.json must be a JSON object.');
    return {
      valid: false,
      name: null,
      version: null,
      issues,
      stats: { dependencyCount: 0, devDependencyCount: 0, peerDependencyCount: 0, scriptCount: 0 },
    };
  }

  // Required: name + version (for publishable packages; private apps relax this slightly, but
  // npm install still wants them present).
  const name = typeof doc.name === 'string' ? doc.name : null;
  const version = typeof doc.version === 'string' ? doc.version : null;

  if (!name) {
    push('error', '$.name', 'Missing required "name" field.');
  } else {
    if (name.length > 214) {
      push('error', '$.name', `Name is ${name.length} chars — npm limit is 214.`);
    }
    if (!VALID_NAME_RE.test(name)) {
      push('error', '$.name', `"${name}" is not a valid npm package name (lowercase, URL-safe, no leading . or _).`);
    }
    if (name !== name.toLowerCase()) {
      push('error', '$.name', 'Package name must be lowercase.');
    }
  }

  if (!version) {
    push('error', '$.version', 'Missing required "version" field.');
  } else if (!SEMVER_RE.test(version)) {
    push('error', '$.version', `"${version}" is not valid semver (expected MAJOR.MINOR.PATCH).`);
  }

  // main / module / types / exports — when present, should be strings or objects.
  for (const key of ['main', 'module', 'browser', 'types', 'typings'] as const) {
    if (doc[key] !== undefined && typeof doc[key] !== 'string') {
      push('error', `$.${key}`, `${key} must be a string when present.`);
    }
  }
  if (doc.exports !== undefined && !isObject(doc.exports) && typeof doc.exports !== 'string') {
    push('error', '$.exports', 'exports must be a string or object when present.');
  }

  // bin — string or string-record.
  if (doc.bin !== undefined && typeof doc.bin !== 'string' && !isStringRecord(doc.bin)) {
    push('error', '$.bin', 'bin must be a string or { [name]: path } map.');
  }

  // scripts — must be string-record.
  let scriptCount = 0;
  if (doc.scripts !== undefined) {
    if (!isStringRecord(doc.scripts)) {
      push('error', '$.scripts', 'scripts must be a string-keyed map of strings.');
    } else {
      scriptCount = Object.keys(doc.scripts).length;
    }
  }

  // Dependencies, devDependencies, peerDependencies, optionalDependencies.
  const depCounts = { dependencyCount: 0, devDependencyCount: 0, peerDependencyCount: 0 };
  const depKeys: Array<['dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies', keyof typeof depCounts | null]> = [
    ['dependencies', 'dependencyCount'],
    ['devDependencies', 'devDependencyCount'],
    ['peerDependencies', 'peerDependencyCount'],
    ['optionalDependencies', null],
  ];
  for (const [key, counter] of depKeys) {
    const block = doc[key];
    if (block === undefined) continue;
    if (!isStringRecord(block)) {
      push('error', `$.${key}`, `${key} must be a map of { [name]: version-spec }.`);
      continue;
    }
    if (counter) depCounts[counter] = Object.keys(block).length;
    for (const [depName, spec] of Object.entries(block)) {
      if (!VALID_NAME_RE.test(depName)) {
        push('warning', `$.${key}["${depName}"]`, `Dependency name "${depName}" does not look like a valid npm name.`);
      }
      if (!DEP_SPEC_RE.test(spec) && spec !== '') {
        push('warning', `$.${key}["${depName}"]`, `Version spec "${spec}" doesn't match a recognized range / URL / workspace pattern.`);
      }
    }
  }

  // engines — string record.
  if (doc.engines !== undefined && !isStringRecord(doc.engines)) {
    push('error', '$.engines', 'engines must be a map of { [tool]: version-range }.');
  }

  // license — recommended string.
  if (doc.license !== undefined && typeof doc.license !== 'string' && !isObject(doc.license)) {
    push('error', '$.license', 'license must be a SPDX string (or object with type/url).');
  }
  if (strict && doc.license === undefined) {
    push('warning', '$.license', 'No license field — npm will warn on publish.');
  }

  // Strict-only practice checks.
  if (strict) {
    if (typeof doc.description !== 'string' || (doc.description).trim() === '') {
      push('warning', '$.description', 'No description — strongly recommended for npm search.');
    }
    if (doc.repository === undefined) {
      push('warning', '$.repository', 'No repository field — strongly recommended for discoverability.');
    }
    if (!Array.isArray(doc.keywords) || doc.keywords.length === 0) {
      push('warning', '$.keywords', 'No keywords — strongly recommended for npm search.');
    }
    if (doc.author === undefined && !Array.isArray(doc.contributors)) {
      push('warning', '$.author', 'No author or contributors listed.');
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  return {
    valid: errorCount === 0,
    name,
    version,
    issues,
    stats: { ...depCounts, scriptCount },
  };
}

export const packageJsonValidate: ToolModule<PackageJsonValidateParams> = {
  id: 'package-json-validate',
  slug: 'package-json-validate',
  name: 'package.json Validate',
  description:
    'Lint a Node package.json for shape errors and npm-publish blockers. Catches invalid names, broken semver, mistyped dependency maps, and weird scripts blocks — without bundling the full npm schema. Strict mode also warns on missing description, repository, keywords, license.',
  category: 'inspect',
  keywords: ['npm', 'package.json', 'validate', 'lint', 'node', 'package'],

  input: {
    accept: ['application/json', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 5 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultPackageJsonValidateParams,

  paramSchema: {
    strict: {
      type: 'boolean',
      label: 'strict mode',
      help: 'Also flag practices (no description, repository, keywords, license, author).',
    },
  },

  async run(inputs: File[], params: PackageJsonValidateParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('package-json-validate accepts exactly one file.');
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing' });
    const text = await inputs[0]!.text();
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not parse as JSON: ${msg}`);
    }
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Validating' });
    const result = validatePackageJson(doc, params.strict ?? false);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
