import { readFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createJobController } from './jobs.js';
import { LIMITS, ERROR_MESSAGES, PilotError, safeError, UI_URI } from './limits.js';
import { TOOLS, validateArguments, validateOutput } from './schemas.js';
import type { ErrorDetails, Operation } from './types.js';
import { configuredOutputOrigins } from '../scripts/output-delivery.mjs';

export function boundedResult(result: CallToolResult): CallToolResult {
  if (!validateOutput(result.structuredContent) || Buffer.byteLength(JSON.stringify(result)) > LIMITS.envelopeBytes) {
    throw new PilotError('OUTPUT_TOO_LARGE');
  }
  return result;
}

export function errorResult(operation: Operation, error: unknown): CallToolResult {
  const safe = safeError(error);
  const details: ErrorDetails = {
    status: 'error', operation, code: safe.code, message: ERROR_MESSAGES[safe.code],
    retryable: safe.code === 'BUSY' || safe.code === 'DOWNLOAD_TIMEOUT' || safe.code === 'WORKER_TIMEOUT' || safe.code === 'FILE_DOWNLOAD_FAILED',
    ...(safe.code === 'FILE_HOST_NOT_ENABLED' && safe.downloadHost ? { downloadHost: safe.downloadHost } : {}),
    ...(safe.code === 'TARGET_UNREACHABLE' && safe.target ? { targetReached: false, ...safe.target } : {}),
  };
  const message = details.downloadHost ? `${details.message} Observed hostname: ${details.downloadHost}.` : details.message;
  return boundedResult({ isError: true, structuredContent: { ...details }, content: [{ type: 'text', text: message }] });
}

export function createServer(hosts: ReadonlySet<string>, jobs = createJobController(hosts), outputOrigins: readonly string[] = []): Server {
  const origins = configuredOutputOrigins(outputOrigins.join(','));
  const server = new Server({ name: 'wyreup-private-chatgpt-pilot', version: '0.1.0' }, {
    capabilities: { tools: {}, resources: {} },
    instructions: 'Three bounded file workflows. Inputs and outputs pass through OpenAI; processing runs on the operator host. This does not sanitize visible content or PDF active content.',
  });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const selected = TOOLS.find(tool => tool.name === request.params.name);
    if (!selected) throw new McpError(ErrorCode.InvalidParams, 'Unknown tool.');
    const operation = selected.name as Operation;
    try {
      const args = validateArguments(operation, request.params.arguments);
      const result = await jobs.run(operation, args, extra.signal);
      return boundedResult({
        structuredContent: { ...result.details },
        content: [{ type: 'text', text: 'The file was processed. Inspect the result and use Download in the result card.' }],
        _meta: { output: { ...result.output } },
      });
    } catch (error) { return errorResult(operation, error); }
  });
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [{ uri: UI_URI, name: 'Wyreup result card', mimeType: 'text/html;profile=mcp-app' }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== UI_URI) throw new McpError(ErrorCode.InvalidParams, 'Unknown resource.');
    const html = await readFile(new URL('./widget.html', import.meta.url), 'utf8');
    if (!html.includes('</head>')) throw new McpError(ErrorCode.InternalError, 'Invalid result card.');
    const configuration = JSON.stringify(origins).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
    return { contents: [{ uri: UI_URI, mimeType: 'text/html;profile=mcp-app',
      text: html.replace('</head>', '<script type="application/json" id="wyreup-output-origins">' + configuration + '</script></head>'),
      _meta: { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [] } },
        'openai/widgetCSP': { connect_domains: [], resource_domains: [], frame_domains: [], redirect_domains: origins } },
    }] };
  });
  return server;
}
