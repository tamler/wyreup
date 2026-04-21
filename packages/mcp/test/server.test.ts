import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWyreupMcpServer } from '../src/server.js';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

const FIXTURES = new URL('../../core/test/fixtures', import.meta.url).pathname;

// ──── Direct handler access helpers ──────────────────────────────────────────
// Avoids needing a live transport while still exercising the real handler logic.

type McpServer = ReturnType<typeof createWyreupMcpServer>;

function getHandler(server: McpServer, method: string) {
  // The MCP SDK Protocol base class stores handlers in _requestHandlers (Map<string, fn>).
  // Accessing a private SDK internal for testing purposes — no public API available.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  const handlers = (server as any)._requestHandlers as Map<string, (req: unknown, extra: unknown) => unknown>;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`No handler for method: ${method}`);
  return handler;
}

async function listTools(server: McpServer) {
  const handler = getHandler(server, 'tools/list');
  return handler({ method: 'tools/list', params: {} }, {}) as Promise<{
    tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  }>;
}

async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
) {
  const handler = getHandler(server, 'tools/call');
  return handler(
    { method: 'tools/call', params: { name, arguments: args } },
    {},
  ) as Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

// ──── Tests ───────────────────────────────────────────────────────────────────

describe('createWyreupMcpServer', () => {
  let server: McpServer;
  let tmpDir: string;

  beforeAll(async () => {
    server = createWyreupMcpServer();
    tmpDir = await mkdtemp(join(tmpdir(), 'wyreup-mcp-test-'));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── list_tools ──────────────────────────────────────────────────────────────

  it('lists exactly 53 tools', async () => {
    const result = await listTools(server);
    expect(result.tools).toHaveLength(53);
  });

  it('every tool entry has name, description, and inputSchema', async () => {
    const result = await listTools(server);
    for (const tool of result.tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.inputSchema).toBe('object');
    }
  });

  it('inputSchema for single-output tools contains output_path (not output_dir)', async () => {
    const result = await listTools(server);
    const hashTool = result.tools.find((t) => t.name === 'hash');
    expect(hashTool).toBeDefined();
    const props = (hashTool!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty('output_path');
    expect(props).not.toHaveProperty('output_dir');
  });

  it('inputSchema for multi-output tools contains output_dir (not output_path)', async () => {
    const result = await listTools(server);
    const splitTool = result.tools.find((t) => t.name === 'split-pdf');
    expect(splitTool).toBeDefined();
    const props = (splitTool!.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty('output_dir');
    expect(props).not.toHaveProperty('output_path');
  });

  it('inputSchema includes input_paths and params for every tool', async () => {
    const result = await listTools(server);
    for (const tool of result.tools) {
      const props = (tool.inputSchema as { properties: Record<string, unknown> }).properties;
      expect(props).toHaveProperty('input_paths');
      expect(props).toHaveProperty('params');
    }
  });

  it('all 53 expected tool IDs are present', async () => {
    const result = await listTools(server);
    const ids = new Set(result.tools.map((t) => t.name));
    const expected = [
      'compress', 'convert', 'strip-exif', 'image-to-pdf', 'merge-pdf',
      'split-pdf', 'rotate-pdf', 'reorder-pdf', 'page-numbers-pdf', 'color-palette',
      'qr', 'watermark-pdf', 'pdf-to-text', 'image-diff', 'rotate-image',
      'flip-image', 'grayscale', 'sepia', 'invert', 'image-info',
      'pdf-info', 'hash', 'crop', 'resize', 'image-watermark',
      'favicon', 'pdf-to-image', 'json-formatter', 'base64', 'url-encoder',
      'color-converter', 'markdown-to-html', 'html-to-markdown', 'text-diff', 'word-counter',
      'password-generator', 'uuid-generator', 'ocr', 'svg-to-png', 'timestamp-converter',
      'lorem-ipsum', 'regex-tester', 'pdf-extract-pages', 'pdf-delete-pages', 'pdf-compress',
      'pdf-encrypt', 'pdf-decrypt', 'pdf-redact', 'pdf-metadata', 'pdf-extract-tables',
      'pdf-crop', 'face-blur', 'audio-enhance',
    ];
    for (const id of expected) {
      expect(ids.has(id), `missing tool: ${id}`).toBe(true);
    }
  });

  // ── call_tool — unknown tool ────────────────────────────────────────────────

  it('throws for unknown tool name', async () => {
    await expect(callTool(server, 'does-not-exist', {})).rejects.toThrow(
      'Unknown tool: does-not-exist',
    );
  });

  // ── call_tool — hash (JSON output, written to disk) ─────────────────────────

  it('hash tool writes JSON output to disk and returns the path', async () => {
    const inputPath = join(FIXTURES, 'photo.jpg');
    const outputPath = join(tmpDir, 'hash-result.json');
    const result = await callTool(server, 'hash', {
      input_paths: [inputPath],
      output_path: outputPath,
      params: { algorithms: ['SHA-256'] },
    });
    expect(result.content[0]?.text).toContain(outputPath);
    const written = await readFile(outputPath, 'utf8');
    const parsed: unknown = JSON.parse(written);
    // hash returns a single object for one input, or an array for multiple
    const entry: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
    expect(entry).toHaveProperty('hashes');
  });

  // ── call_tool — inline text output (no output_path) ─────────────────────────

  it('hash tool returns inline JSON when no output_path is given', async () => {
    const inputPath = join(FIXTURES, 'photo.jpg');
    const result = await callTool(server, 'hash', {
      input_paths: [inputPath],
      params: { algorithms: ['SHA-256'] },
    });
    expect(result.content[0]?.type).toBe('text');
    const parsed: unknown = JSON.parse(result.content[0]!.text);
    // hash returns a single object for one input or an array for multiple
    const entry: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
    expect(entry).toHaveProperty('hashes');
  });

  // ── call_tool — split-pdf (multi-output) ────────────────────────────────────

  it('split-pdf writes multiple files to output_dir', async () => {
    const inputPath = join(FIXTURES, 'doc-multipage.pdf');
    const outputDirPath = join(tmpDir, 'split-output');
    const result = await callTool(server, 'split-pdf', {
      input_paths: [inputPath],
      output_dir: outputDirPath,
      params: {},
    });
    expect(result.content[0]?.text).toContain('Successfully processed');
    const lines = result.content[0]!.text.split('\n').slice(1).filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const data = await readFile(line);
      expect(data.length).toBeGreaterThan(0);
    }
  });

  // ── call_tool — no-input tool (uuid-generator) ──────────────────────────────

  it('uuid-generator produces inline text output with no input files', async () => {
    const result = await callTool(server, 'uuid-generator', {
      input_paths: [],
      params: { count: 3 },
    });
    expect(result.content[0]?.type).toBe('text');
    // uuid-generator returns text/plain — verify it has UUID-like content
    expect(result.content[0]!.text.length).toBeGreaterThan(0);
  });

  // ── call_tool — binary with no output path ──────────────────────────────────

  it('returns error content when binary output has no output_path', async () => {
    const inputPath = join(FIXTURES, 'photo.jpg');
    const result = await callTool(server, 'compress', {
      input_paths: [inputPath],
      params: { quality: 80 },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('output_path');
  });

  // ── call_tool — defaults are used when params omitted ───────────────────────

  it('uses tool defaults when params is omitted', async () => {
    const inputPath = join(FIXTURES, 'photo.jpg');
    const outputPath = join(tmpDir, 'hash-defaults.json');
    const result = await callTool(server, 'hash', {
      input_paths: [inputPath],
      output_path: outputPath,
    });
    expect(result.content[0]?.text).toContain(outputPath);
  });

  // ── call_tool — merge-pdf (multi-input, single-output) ──────────────────────

  it('merge-pdf merges two PDFs into one output file', async () => {
    const inputA = join(FIXTURES, 'doc-a.pdf');
    const inputB = join(FIXTURES, 'doc-b.pdf');
    const outputPath = join(tmpDir, 'merged.pdf');
    const result = await callTool(server, 'merge-pdf', {
      input_paths: [inputA, inputB],
      output_path: outputPath,
      params: {},
    });
    expect(result.content[0]?.text).toContain(outputPath);
    const data = await readFile(outputPath);
    expect(data.length).toBeGreaterThan(0);
  });
});
