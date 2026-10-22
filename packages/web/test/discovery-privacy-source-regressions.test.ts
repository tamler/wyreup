import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, fileMatchesMime } from '@wyreup/core';
import { acceptsBrowserFile } from '../src/lib/file-tool-candidates';
import { projectToolDiscoveryMetadata } from '../src/lib/tool-discovery-metadata';

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../src/${relative}`, import.meta.url)), 'utf8');
}

function visibleSourceText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function declaration(value: string, name: string, kind: 'function' | 'variable'): string {
  const script = ts.createSourceFile('actual-source.ts', value, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const matches: string[] = [];
  function visit(node: ts.Node) {
    if (kind === 'function' && ts.isFunctionDeclaration(node) && node.name?.text === name)
      matches.push(node.getText(script));
    if (kind === 'variable' && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer)
      matches.push(`const ${name} = ${node.initializer.getText(script)};`);
    ts.forEachChild(node, visit);
  }
  visit(script);
  if (matches.length !== 1) throw new Error(`Expected one actual ${name} declaration.`);
  return ts.transpileModule(matches[0], {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

// Runs the current trusted repository declaration, not a copied MIME algorithm.
// This is predicate evidence only; mounted production admission has a separate gate.
function actualDropPredicate(accept: string[], file: File): unknown {
  const script = source('components/runners/DropZone.svelte').match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!script) throw new Error('DropZone script was not found.');
  const code = declaration(script, 'matchesMime', 'function');
  return runInNewContext(`${code}\nmatchesMime(file);`, { accept, file, fileMatchesMime }, { timeout: 1000 });
}

describe('discovery/privacy source regressions; not production browser acceptance', () => {
  it('keeps real local, hosted and free-network metadata distinct', () => {
    const registry = createDefaultRegistry();
    const domain = registry.toolsById.get('domain-age-checker');
    const local = registry.toolsById.get('compress');
    const hosted = registry.toolsById.get('analyze-chart');
    if (!domain || !local || !hosted) throw new Error('Required actual registry controls are missing.');
    expect(domain.cost).toBe('free');
    expect(projectToolDiscoveryMetadata(domain).networkAccess).toBe('domain-registration');
    expect(projectToolDiscoveryMetadata(domain).seoContent?.intro).toMatch(/domain.*sent.*Wyreup/i);
    expect(projectToolDiscoveryMetadata(local).networkAccess).toBeUndefined();
    expect(local.cost).toBe('free');
    expect(projectToolDiscoveryMetadata(hosted).networkAccess).toBeUndefined();
    expect(hosted.cost).toBe('credit');
  });

  it('does not leave the known generic free-local assertion in tool facts or privacy markup', () => {
    const page = source('pages/tools/[slug].astro');
    const facts = page.match(/<dl class="tool-facts">([\s\S]*?)<\/dl>/)?.[1];
    const callout = page.match(/\{\/\* Privacy callout[\s\S]*?(?=<\/section>)/)?.[0];
    if (!facts || !callout) throw new Error('Actual tool facts/privacy blocks were not found.');
    expect(facts).not.toMatch(/Free,\s*runs in your browser/i);
    expect(visibleSourceText(callout)).not.toMatch(/This free tool executes in your browser/i);
    // The real domain/local/PRO branches themselves are asserted on emitted HTML.
  });

  it('keeps the tools social preview explicit about execution choices', () => {
    const description = source('pages/tools.astro').match(/ogDescription="([^"]+)"/)?.[1];
    expect(description).toBeTruthy();
    expect(description).not.toMatch(/free tools (?:run|execute) (?:entirely )?on your device/i);
    expect(description).toMatch(/local/i);
    expect(description).toMatch(/network/i);
    expect(description).toMatch(/hosted/i);
  });

  it('qualifies PwaShell offline availability by required local assets and network/hosted execution', () => {
    const message = source('components/PwaShell.svelte').match(/<span class="pwa-banner__msg">([\s\S]*?)<\/span>/)?.[1];
    expect(message).toBeTruthy();
    expect(message).toMatch(/local/i);
    expect(message).toMatch(/asset/i);
    expect(message).toMatch(/(?:if|when|available)/i);
    expect(message).toMatch(/network/i);
    expect(message).toMatch(/hosted|PRO/i);
    expect(message).toMatch(/connection|internet|online/i);
    expect(message).not.toMatch(/cached tools still work/i);
  });

  it('does not treat a download notice or prior use as an unconditional offline guarantee', () => {
    const message = visibleSourceText(source('components/ToolDownloadNotice.svelte'));
    expect(message).toMatch(/asset|model/i);
    expect(message).toMatch(/offline/i);
    expect(message).toMatch(/(?:if|when|depend)/i);
    expect(message).not.toMatch(/then runs offline/i);
  });

  it.each([false, true])('qualifies the actual category execution note; hosted=%s', (hasHostedTools) => {
    const frontmatter = source('pages/category/[slug].astro').split('---')[1];
    if (!frontmatter) throw new Error('Actual category frontmatter was not found.');
    const code = declaration(frontmatter, 'executionNote', 'variable');
    const text: unknown = runInNewContext(`${code}\nexecutionNote;`, { hasHostedTools, hasNetworkTools: false }, { timeout: 1000 });
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(/(?:all|every|free) tools (?:run|execute) (?:entirely )?(?:locally|in your browser|on your device)/i);
    expect(text).toMatch(/check|requirement|needed|supported|explain/i);
    if (hasHostedTools) {
      expect(text).toMatch(/hosted|PRO/i);
      expect(text).toMatch(/sent/i);
    }
  });

  const categoryGroups = [
    { name: 'local', ids: ['compress'], hosted: false, network: false },
    { name: 'hosted', ids: ['analyze-chart'], hosted: true, network: false },
    { name: 'network', ids: ['domain-age-checker'], hosted: false, network: true },
    { name: 'mixed', ids: ['domain-age-checker', 'analyze-chart'], hosted: true, network: true },
  ];

  function requiredTools(ids: readonly string[]) {
    const registry = createDefaultRegistry();
    return ids.map((id) => {
      const tool = registry.toolsById.get(id);
      if (!tool) throw new Error(`Required actual category control ${id} is missing.`);
      return tool;
    });
  }

  function categoryFrontmatter(): string {
    const frontmatter = source('pages/category/[slug].astro').split('---')[1];
    if (!frontmatter) throw new Error('Actual category frontmatter was not found.');
    return frontmatter;
  }

  function actualCategoryNote(catTools: ReturnType<typeof requiredTools>) {
    const frontmatter = categoryFrontmatter();
    const code = ['hasHostedTools', 'hasNetworkTools', 'executionNote']
      .map((name) => declaration(frontmatter, name, 'variable'))
      .join('\n');
    return runInNewContext(
      `${code}\n({hasHostedTools, hasNetworkTools, executionNote});`,
      { catTools, projectToolDiscoveryMetadata },
      { timeout: 1000 },
    ) as { hasHostedTools: unknown; hasNetworkTools: unknown; executionNote: unknown };
  }

  it.each(categoryGroups)('selects the actual category network/hosted branch for $name tools', (group) => {
    const result = actualCategoryNote(requiredTools(group.ids));
    expect(result.hasHostedTools).toBe(group.hosted);
    expect(result.hasNetworkTools).toBe(group.network);
    expect(typeof result.executionNote).toBe('string');
    expect(result.executionNote).not.toMatch(/(?:all|every|free) tools (?:run|execute) (?:entirely )?(?:locally|in your browser|on your device)/i);
    expect(result.executionNote).toMatch(/check|requirement|needed|supported|explain/i);
    if (group.network) {
      expect(result.executionNote).toMatch(/includes network lookups/i);
      expect(result.executionNote).toMatch(/connection/i);
    } else {
      expect(result.executionNote).not.toMatch(/includes network lookups/i);
    }
    if (group.hosted) {
      expect(result.executionNote).toMatch(/hosted|PRO/i);
      expect(result.executionNote).toMatch(/sent/i);
    }
    for (const other of categoryGroups) {
      if (other.name !== group.name)
        expect(result.executionNote).not.toBe(actualCategoryNote(requiredTools(other.ids)).executionNote);
    }
  });

  it('qualifies the actual dev-category membership as a network category', () => {
    const allTools = Array.from(createDefaultRegistry().toolsById.values());
    const code = declaration(categoryFrontmatter(), 'catTools', 'variable');
    const selected: unknown = runInNewContext(`${code}\ncatTools;`, { allTools, cat: 'dev' }, { timeout: 1000 });
    if (!Array.isArray(selected)) throw new Error('Actual dev category selection did not return an array.');
    const catTools = selected as ReturnType<typeof requiredTools>;
    expect(catTools.some((tool) => tool.id === 'domain-age-checker')).toBe(true);
    const result = actualCategoryNote(catTools);
    expect(result.hasNetworkTools).toBe(true);
    expect(typeof result.hasHostedTools).toBe('boolean');
    expect(typeof result.executionNote).toBe('string');
    expect(result.executionNote).toMatch(/includes network lookups/i);
    expect(result.executionNote).toMatch(/connection/i);
    expect(result.executionNote).not.toBe(actualCategoryNote(requiredTools(['compress'])).executionNote);
  });

  it('uses the same real File for exact parameterized PDF discovery and direct admission', () => {
    const tool = createDefaultRegistry().toolsById.get('pdf-info');
    if (!tool) throw new Error('Actual PDF Info module was not found.');
    const file = new File(['predicate-only data'], 'original.pdf', { type: 'application/pdf;profile=test' });
    expect(acceptsBrowserFile(tool, file)).toBe(true);
    expect(actualDropPredicate([...tool.input.accept], file)).toBe(true);
  });

  it.each([
    { accept: ['application/pdf'], type: 'application/pdf', name: 'original.pdf', admitted: true },
    { accept: ['application/pdf'], type: 'image/png', name: 'original.pdf', admitted: false },
    { accept: ['audio/*'], type: 'audio/webm;codecs=opus', name: 'original.webm', admitted: true },
    { accept: ['image/*'], type: '', name: 'original.png', admitted: true },
    { accept: ['.nef'], type: 'image/x-nikon-nef', name: 'original.NEF', admitted: true },
    { accept: ['.PSD'], type: '', name: 'original.psd', admitted: true },
    { accept: ['.psd'], type: '', name: 'original.PSD.txt', admitted: false },
    { accept: ['*/*'], type: '', name: 'original.bin', admitted: true },
    { accept: ['*'], type: '', name: 'original.bin', admitted: true },
  ])('preserves the direct-admission control $name / $type / $accept', ({ accept, type, name, admitted }) => {
    expect(actualDropPredicate(accept, new File(['predicate-only data'], name, { type }))).toBe(admitted);
  });
});
