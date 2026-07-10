import type { ToolModule, ToolRunContext } from '../../types.js';
import { validateOpenapi, type OpenapiValidateResult } from '../openapi-validate/index.js';

export interface OpenapiReportParams {
  /** Also flag practice issues (missing descriptions, operationId, etc.). */
  strict?: boolean;
}

export const defaultOpenapiReportParams: OpenapiReportParams = { strict: false };

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

// Render a validation result as a Markdown report suitable for pasting
// into a CI log or a pull-request comment.
function toMarkdown(r: OpenapiValidateResult): string {
  const errors = r.issues.filter((i) => i.severity === 'error');
  const warnings = r.issues.filter((i) => i.severity === 'warning');
  const lines: string[] = [];

  lines.push('# OpenAPI Validation Report', '');
  lines.push(`- **Result:** ${r.valid ? 'Valid' : 'Invalid'}`);
  lines.push(`- **Spec version:** ${r.version ?? 'unknown'}`);
  lines.push(
    `- **Paths:** ${r.stats.pathCount} · ` +
      `**Operations:** ${r.stats.operationCount} · ` +
      `**Component schemas:** ${r.stats.componentSchemaCount}`,
  );
  lines.push('');
  lines.push(`## Issues — ${errors.length} error(s), ${warnings.length} warning(s)`, '');

  if (r.issues.length === 0) {
    lines.push('No issues found.');
  } else {
    lines.push('| Severity | Path | Message |', '| --- | --- | --- |');
    for (const i of r.issues) {
      lines.push(`| ${i.severity} | \`${escapeCell(i.path)}\` | ${escapeCell(i.message)} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export const openapiReport: ToolModule<OpenapiReportParams> = {
  id: 'openapi-report',
  slug: 'openapi-report',
  name: 'OpenAPI Report',
  description:
    'Validate an OpenAPI spec (JSON or YAML) and get a Markdown report — result, spec stats, and an issues table — ready to paste into a CI log or pull-request comment.',
  category: 'inspect',
  keywords: ['openapi', 'swagger', 'report', 'markdown', 'validate', 'ci', 'api'],

  input: {
    accept: ['application/json', 'application/yaml', 'text/yaml', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 25 * 1024 * 1024,
  },
  output: {
    mime: 'text/markdown',
    multiple: true,
  },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultOpenapiReportParams,

  paramSchema: {
    strict: {
      type: 'boolean',
      label: 'strict',
      help: 'Also flag practice issues — missing descriptions, operationId, and the like.',
    },
  },

  async run(inputs: File[], params: OpenapiReportParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('openapi-report accepts exactly one file.');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing spec' });
    const text = await inputs[0]!.text();
    let doc: unknown;
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        doc = JSON.parse(text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not parse as JSON: ${msg}`);
      }
    } else {
      const { load } = await import('js-yaml');
      try {
        doc = load(text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not parse as YAML: ${msg}`);
      }
    }
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 70, message: 'Validating' });
    const result = validateOpenapi(doc, params.strict ?? false);
    const markdown = toMarkdown(result);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([markdown], { type: 'text/markdown' }),
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/markdown', 'application/json'],
  },
};
