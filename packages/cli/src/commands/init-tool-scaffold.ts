import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface InitToolAnswers {
  toolId: string;
  displayName: string;
  description: string;
  category: string;
  inputMimes: string[];
  outputMime: string;
  inputMin: number;
  inputMax: number;
  memoryEstimate: 'low' | 'medium' | 'high';
}

/**
 * Generate the index.ts ToolModule boilerplate.
 */
export function generateIndexTs(a: InitToolAnswers): string {
  const paramsType = `${toPascalCase(a.toolId)}Params`;
  const varName = toCamelCase(a.toolId);
  const acceptStr = a.inputMimes.map((m) => `'${m}'`).join(', ');
  return `import type { ToolModule } from '../../types.js';
import type { ${paramsType} } from './types.js';

export interface ${paramsType} {
  // Add your params here
}

const defaults: ${paramsType} = {
  // Set default values here
};

export const ${varName}: ToolModule<${paramsType}> = {
  id: '${a.toolId}',
  slug: '${a.toolId}',
  name: '${a.displayName}',
  description: '${a.description}',
  category: '${a.category}',
  keywords: ['${a.toolId}'],

  input: {
    accept: [${acceptStr}],
    min: ${a.inputMin},
    max: ${a.inputMax},
  },

  output: {
    mime: '${a.outputMime}',
  },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: '${a.memoryEstimate}',

  async run(inputs, params, ctx) {
    // TODO: implement run()
    // Return the first input unchanged as a placeholder.
    return inputs[0]!;
  },

  defaults,

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['${a.outputMime}'],
  },
};
`;
}

/**
 * Generate the types.ts for the tool.
 */
export function generateTypesTs(a: InitToolAnswers): string {
  const paramsType = `${toPascalCase(a.toolId)}Params`;
  return `// Re-export from index so tests can import cleanly.
export type { ${paramsType} } from './index.js';
`;
}

/**
 * Generate the test file.
 */
export function generateTestTs(a: InitToolAnswers): string {
  const varName = toCamelCase(a.toolId);
  const importPath = `../../../src/tools/${a.toolId}/index.js`;
  return `import { describe, it, expect } from 'vitest';
import { ${varName} } from '${importPath}';

describe('${a.toolId} — metadata', () => {
  it('has the correct id', () => {
    expect(${varName}.id).toBe('${a.toolId}');
  });

  it('declares expected output MIME', () => {
    expect(${varName}.output.mime).toBe('${a.outputMime}');
  });

  it('has defaults defined', () => {
    expect(${varName}.defaults).toBeDefined();
  });
});

describe('${a.toolId} — run()', () => {
  it.todo('TODO: implement run() tests');
});
`;
}

export interface ScaffoldPaths {
  toolDir: string;
  indexTs: string;
  typesTs: string;
  testDir: string;
  testTs: string;
}

/**
 * Write scaffolded files into the monorepo.
 * @param baseDir Root of the monorepo (or a temp dir in tests).
 */
export function scaffoldTool(baseDir: string, answers: InitToolAnswers): ScaffoldPaths {
  const toolDir = join(baseDir, 'packages', 'core', 'src', 'tools', answers.toolId);
  const testDir = join(baseDir, 'packages', 'core', 'test', 'tools', answers.toolId);

  mkdirSync(toolDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });

  const indexTs = join(toolDir, 'index.ts');
  const typesTs = join(toolDir, 'types.ts');
  const testTs = join(testDir, `${answers.toolId}.test.ts`);

  writeFileSync(indexTs, generateIndexTs(answers), 'utf8');
  writeFileSync(typesTs, generateTypesTs(answers), 'utf8');
  writeFileSync(testTs, generateTestTs(answers), 'utf8');

  return { toolDir, indexTs, typesTs, testDir, testTs };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toCamelCase(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toPascalCase(kebab: string): string {
  const camel = toCamelCase(kebab);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}
