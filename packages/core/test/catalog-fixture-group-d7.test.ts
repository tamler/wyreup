import { expect, it } from 'vitest';
import {
  htmlFormatter,
  markdownToHtml,
  planningTools,
  regexTester,
  sqlFormatter,
  textDiff,
  textReadability,
  type ToolRunContext,
} from '../src/index.js';

const context = (): ToolRunContext => ({
  onProgress() {},
  signal: new AbortController().signal,
  cache: new Map(),
  executionId: 'group-d7-source-bound-fixtures',
});

function publicPlanningTool(id: string) {
  const matches = planningTools.filter((tool) => tool.id === id);
  if (matches.length !== 1) throw new Error('Expected exactly one public planning tool.');
  return matches[0]!;
}

it('group-d7 markdown-to-html', async () => {
  const inputs = [new File(['# Hello World\n\n**bold text**\n'], 'test.md', { type: 'text/markdown' })];
  const params = { gfm: true };
  const outputs = await markdownToHtml.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/html');
  const html = await outputs[0]!.text();
  expect(html).toContain('<h1>');
  expect(html).toContain('Hello World');
  expect(html).toContain('<strong>');
  expect(html).toContain('bold text');
});

it('group-d7 regex-tester', async () => {
  const inputs = [new File(['hello world hello'], 'input.txt', { type: 'text/plain' })];
  const params = { pattern: 'hello', flags: 'g' };
  const outputs = await regexTester.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  const result = JSON.parse(await outputs[0]!.text()) as {
    valid: boolean; matchCount: number; matches: { match: string }[];
  };
  expect(result.valid).toBe(true);
  expect(result.matchCount).toBe(2);
  expect(result.matches.length).toBe(2);
  expect(result.matches[0]!.match).toBe('hello');
});

it('group-d7 sql-formatter', async () => {
  const inputs = [new File(['select id,name from users where id=1'], 'query.sql', { type: 'text/plain' })];
  const params = {};
  const outputs = await sqlFormatter.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/plain');
  const sql = await outputs[0]!.text();
  expect(sql).toContain('SELECT');
  expect(sql).toContain('FROM');
  expect(sql).toContain('WHERE');
});

it('group-d7 html-formatter', async () => {
  const inputs = [new File(['<div><!-- comment --><p>text</p></div>'], 'input.html', { type: 'text/html' })];
  const params = { mode: 'minify' } as const;
  const outputs = await htmlFormatter.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('text/html');
  expect(await outputs[0]!.text()).not.toContain('<!--');
});

it('group-d7 text-diff', async () => {
  const inputs = [
    new File(['line one\nline two\nline three\n'], 'file1.txt', { type: 'text/plain' }),
    new File(['line one\nline TWO\nline three\n'], 'file2.txt', { type: 'text/plain' }),
  ];
  const params = { context: 3 };
  const outputs = await textDiff.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(2);
  expect(outputs[0]!.type).toBe('text/plain');
  expect(outputs[1]!.type).toBe('application/json');
  const diff = await outputs[0]!.text();
  const stats = JSON.parse(await outputs[1]!.text()) as {
    additions: number; deletions: number; changes: number;
  };
  expect(diff).toContain('-line two');
  expect(diff).toContain('+line TWO');
  expect(stats.additions).toBe(1);
  expect(stats.deletions).toBe(1);
  expect(stats.changes).toBe(2);
});

it('group-d7 photography-contract-generator', async () => {
  const tool = publicPlanningTool('photography-contract-generator');
  const inputs: File[] = [];
  const provided = { photographer: '<img src=x>', client: 'Client', project: 'Portrait session', fee: 100, deposit: 25 };
  const params = { ...tool.defaults, ...provided };
  const outputs = await tool.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  const result = JSON.parse(await outputs[0]!.text()) as { draft: string };
  expect(result.draft).toContain('<img src=x>');
  expect(result.draft).toContain('Balance: 75 USD');
  expect(result.draft).toContain('Draft for review');
});

it('group-d7 text-readability', async () => {
  const inputs = [new File(['The cat sat on mats. The cat sat on mats. The cat sat on mats.'], 'test.txt', { type: 'text/plain' })];
  const params = {};
  const outputs = await textReadability.run(inputs, params, context());
  if (!Array.isArray(outputs)) throw new Error('Expected ordered outputs.');
  expect(outputs).toHaveLength(1);
  expect(outputs[0]!.type).toBe('application/json');
  expect(JSON.parse(await outputs[0]!.text())).toEqual({
    flesch: 117.2,
    fleschKincaid: -1.9,
    colemanLiau: -4.3,
    smog: 3.1,
    automatedReadability: -4,
    daleChall: 0.3,
    gunningFog: 2,
    gradeLevel: '1st and 2nd grade',
  });
});
