import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  scaffoldTool,
  generateIndexTs,
  generateTypesTs,
  generateTestTs,
  type InitToolAnswers,
} from '../src/commands/init-tool-scaffold.js';

const base: InitToolAnswers = {
  toolId: 'test-tool',
  displayName: 'Test Tool',
  description: 'A tool for testing.',
  category: 'dev',
  inputMimes: ['image/jpeg', 'image/png'],
  outputMime: 'image/jpeg',
  inputMin: 1,
  inputMax: 1,
  memoryEstimate: 'low',
};

describe('generateIndexTs', () => {
  it('contains the tool ID', () => {
    const src = generateIndexTs(base);
    expect(src).toContain("id: 'test-tool'");
  });

  it('contains the display name', () => {
    const src = generateIndexTs(base);
    expect(src).toContain("name: 'Test Tool'");
  });

  it('contains the output MIME', () => {
    const src = generateIndexTs(base);
    expect(src).toContain("mime: 'image/jpeg'");
  });

  it('contains the category', () => {
    const src = generateIndexTs(base);
    expect(src).toContain("category: 'dev'");
  });

  it('contains both input MIMEs', () => {
    const src = generateIndexTs(base);
    expect(src).toContain("'image/jpeg'");
    expect(src).toContain("'image/png'");
  });

  it('exports the camelCase variable name', () => {
    const src = generateIndexTs(base);
    expect(src).toContain('export const testTool');
  });

  it('uses PascalCase for the Params type', () => {
    const src = generateIndexTs(base);
    expect(src).toContain('TestToolParams');
  });

  it('handles multi-segment kebab IDs', () => {
    const src = generateIndexTs({ ...base, toolId: 'strip-exif-data' });
    expect(src).toContain('export const stripExifData');
    expect(src).toContain('StripExifDataParams');
  });
});

describe('generateTypesTs', () => {
  it('re-exports the Params type', () => {
    const src = generateTypesTs(base);
    expect(src).toContain('TestToolParams');
    expect(src).toContain("from './index.js'");
  });
});

describe('generateTestTs', () => {
  it('imports the tool variable', () => {
    const src = generateTestTs(base);
    expect(src).toContain('testTool');
  });

  it('asserts the tool ID', () => {
    const src = generateTestTs(base);
    expect(src).toContain("toBe('test-tool')");
  });

  it('asserts the output MIME', () => {
    const src = generateTestTs(base);
    expect(src).toContain("toBe('image/jpeg')");
  });

  it('includes a todo for run() tests', () => {
    const src = generateTestTs(base);
    expect(src).toContain('it.todo');
  });
});

describe('scaffoldTool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'wyreup-scaffold-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the expected files', () => {
    const paths = scaffoldTool(tmpDir, base);
    expect(existsSync(paths.indexTs)).toBe(true);
    expect(existsSync(paths.typesTs)).toBe(true);
    expect(existsSync(paths.testTs)).toBe(true);
  });

  it('writes valid content to index.ts', () => {
    const paths = scaffoldTool(tmpDir, base);
    const content = readFileSync(paths.indexTs, 'utf8');
    expect(content).toContain("id: 'test-tool'");
  });

  it('writes valid content to test file', () => {
    const paths = scaffoldTool(tmpDir, base);
    const content = readFileSync(paths.testTs, 'utf8');
    expect(content).toContain("toBe('test-tool')");
  });

  it('places files in the correct monorepo layout', () => {
    const paths = scaffoldTool(tmpDir, base);
    expect(paths.toolDir).toContain(join('packages', 'core', 'src', 'tools', 'test-tool'));
    expect(paths.testDir).toContain(join('packages', 'core', 'test', 'tools', 'test-tool'));
  });
});
