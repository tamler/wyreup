import type { ToolModule, ToolRunContext } from '../../types.js';

export interface OpenapiValidateParams {
  /** When true, also flag PRACTICES that aren't strictly invalid (missing descriptions, operationId, etc.). */
  strict?: boolean;
}

export const defaultOpenapiValidateParams: OpenapiValidateParams = {
  strict: false,
};

export type OpenapiIssueSeverity = 'error' | 'warning';

export interface OpenapiIssue {
  path: string;
  severity: OpenapiIssueSeverity;
  message: string;
}

export interface OpenapiValidateResult {
  valid: boolean;
  version: string | null;
  issues: OpenapiIssue[];
  stats: {
    pathCount: number;
    operationCount: number;
    componentSchemaCount: number;
  };
}

const OpenapiValidateComponentStub = (): unknown => null;

const VALID_HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function validateOpenapi(doc: unknown, strict: boolean): OpenapiValidateResult {
  const issues: OpenapiIssue[] = [];
  const push = (severity: OpenapiIssueSeverity, path: string, message: string): void => {
    issues.push({ severity, path, message });
  };

  if (!isObject(doc)) {
    push('error', '$', 'Document must be a JSON object.');
    return { valid: false, version: null, issues, stats: { pathCount: 0, operationCount: 0, componentSchemaCount: 0 } };
  }

  const version = typeof doc.openapi === 'string' ? doc.openapi : null;
  if (!version) push('error', '$.openapi', 'Missing required "openapi" version string.');
  else if (!/^3\.[0-1]\./.test(version)) {
    push('error', '$.openapi', `Unsupported OpenAPI version "${version}". This validator targets 3.0.x and 3.1.x.`);
  }

  if (!isObject(doc.info)) {
    push('error', '$.info', 'Missing required "info" object.');
  } else {
    if (typeof doc.info.title !== 'string') push('error', '$.info.title', 'info.title must be a string.');
    if (typeof doc.info.version !== 'string') push('error', '$.info.version', 'info.version must be a string.');
    if (strict && typeof doc.info.description !== 'string') {
      push('warning', '$.info.description', 'No description on the API — recommended for discoverability.');
    }
  }

  let pathCount = 0;
  let operationCount = 0;
  if (doc.paths !== undefined && !isObject(doc.paths)) {
    push('error', '$.paths', 'paths must be an object.');
  } else if (isObject(doc.paths)) {
    for (const [pathKey, pathItem] of Object.entries(doc.paths)) {
      pathCount++;
      if (!pathKey.startsWith('/')) {
        push('error', `$.paths['${pathKey}']`, 'Path keys must start with "/".');
      }
      if (!isObject(pathItem)) {
        push('error', `$.paths['${pathKey}']`, 'Path item must be an object.');
        continue;
      }
      for (const [methodKey, operation] of Object.entries(pathItem)) {
        if (!VALID_HTTP_METHODS.has(methodKey.toLowerCase())) {
          // Could be a $ref / summary / description / parameters / servers — those are fine on a path item.
          continue;
        }
        operationCount++;
        if (!isObject(operation)) {
          push('error', `$.paths['${pathKey}'].${methodKey}`, 'Operation must be an object.');
          continue;
        }
        if (!isObject(operation.responses)) {
          push('error', `$.paths['${pathKey}'].${methodKey}.responses`, 'Operation is missing required "responses" object.');
        } else {
          // Each response key should be a status code or "default"
          for (const respKey of Object.keys(operation.responses)) {
            if (respKey !== 'default' && !/^[1-5](?:XX|\d{2})$/.test(respKey)) {
              push('warning', `$.paths['${pathKey}'].${methodKey}.responses.${respKey}`, 'Response keys should be HTTP status codes ("200", "4XX") or "default".');
            }
          }
        }
        if (strict && typeof operation.operationId !== 'string') {
          push('warning', `$.paths['${pathKey}'].${methodKey}.operationId`, 'No operationId — strongly recommended for client codegen.');
        }
      }
    }
  } else if (!Array.isArray(doc.webhooks) && doc.webhooks === undefined && !doc.paths) {
    push('error', '$.paths', 'Document must define paths, webhooks, or components.');
  }

  let componentSchemaCount = 0;
  if (doc.components !== undefined) {
    if (!isObject(doc.components)) {
      push('error', '$.components', 'components must be an object.');
    } else if (isObject(doc.components.schemas)) {
      componentSchemaCount = Object.keys(doc.components.schemas).length;
    }
  }

  // Servers — when present, urls should be valid.
  if (Array.isArray(doc.servers)) {
    for (let i = 0; i < doc.servers.length; i++) {
      const s = doc.servers[i];
      if (!isObject(s) || typeof s.url !== 'string') {
        push('error', `$.servers[${i}]`, 'Each server entry must have a string "url".');
      }
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  return {
    valid: errorCount === 0,
    version,
    issues,
    stats: { pathCount, operationCount, componentSchemaCount },
  };
}

export const openapiValidate: ToolModule<OpenapiValidateParams> = {
  id: 'openapi-validate',
  slug: 'openapi-validate',
  name: 'OpenAPI Validate',
  description:
    'Validate an OpenAPI 3.0 or 3.1 document against the core spec rules. Catches the common shape errors (missing info, malformed paths, response status code typos) with clear paths and messages — without bundling the full 50 KB meta-schema. Set strict mode to also flag missing operationIds, descriptions, and other lints.',
  category: 'inspect',
  presence: 'both',
  keywords: ['openapi', 'swagger', 'api', 'validate', 'lint', 'spec'],

  input: {
    accept: ['application/json', 'application/yaml', 'text/yaml', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultOpenapiValidateParams,

  paramSchema: {
    strict: {
      type: 'boolean',
      label: 'strict mode',
      help: 'Also flag practices (missing operationIds, descriptions, etc.) as warnings.',
    },
  },

  Component: OpenapiValidateComponentStub,

  async run(inputs: File[], params: OpenapiValidateParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('openapi-validate accepts exactly one file.');
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing' });
    const text = await inputs[0]!.text();
    let doc: unknown;
    // Accept JSON or YAML (very common for OpenAPI docs).
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

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
