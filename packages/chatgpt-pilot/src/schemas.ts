import Ajv from 'ajv';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ERROR_MESSAGES, LIMITS, PilotError, UI_URI } from './limits.js';
import type { ImageArguments, MergeArguments, Operation } from './types.js';

const fileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    download_url: { type: 'string', minLength: 1, maxLength: 8192 },
    file_id: { type: 'string', minLength: 1, maxLength: 256 },
    mime_type: { type: 'string', maxLength: 128 },
    file_name: { type: 'string', maxLength: 256 },
  },
  required: ['download_url', 'file_id'],
};

const imageSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: { file: fileSchema },
  required: ['file'],
};

const compressSchema = {
  ...imageSchema,
  properties: {
    file: fileSchema,
    target_kb: { type: 'integer', minimum: 10, maximum: 10240, default: 200 },
    allow_downscale: { type: 'boolean', default: true },
  },
};

const mergeSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: { files: { type: 'array', minItems: 2, maxItems: 5, items: fileSchema } },
  required: ['files'],
};

export const outputSchema = {
  type: 'object' as const,
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { const: 'success' },
        operation: { enum: ['compress_image_to_size', 'strip_image_metadata', 'merge_pdfs'] },
        output: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string', enum: ['compressed.jpg', 'compressed.png', 'compressed.webp', 'metadata-removed.jpg', 'metadata-removed.png', 'metadata-removed.webp', 'merged.pdf'] },
            mimeType: { enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] },
            bytes: { type: 'integer', minimum: 1, maximum: LIMITS.outputBytes },
          },
          required: ['name', 'mimeType', 'bytes'],
        },
        inputBytes: { type: 'integer', minimum: 1, maximum: 25165824 },
        targetReached: { const: true },
        targetBytes: { type: 'integer', minimum: 10240, maximum: 10485760 },
        pageCount: { type: 'integer', minimum: 1, maximum: 100 },
        inputOrder: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'integer', minimum: 1, maximum: 5 } },
      },
      required: ['status', 'operation', 'output', 'inputBytes'],
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { const: 'error' },
        operation: { enum: ['compress_image_to_size', 'strip_image_metadata', 'merge_pdfs'] },
        code: { enum: Object.keys(ERROR_MESSAGES) },
        message: { type: 'string', maxLength: 256 },
        retryable: { type: 'boolean' },
        downloadHost: { type: 'string', maxLength: 253, pattern: '^[a-z0-9.-]+$' },
        targetReached: { const: false },
        targetBytes: { type: 'integer', minimum: 10240, maximum: 10485760 },
        smallestBytes: { type: 'integer', minimum: 1 },
      },
      required: ['status', 'operation', 'code', 'message', 'retryable'],
    },
  ],
};

const ajv = new Ajv({ strict: true, allErrors: false, coerceTypes: false, removeAdditional: false, useDefaults: false });
const validateImage = ajv.compile<ImageArguments>(imageSchema);
const validateCompress = ajv.compile<ImageArguments>(compressSchema);
const validateMerge = ajv.compile<MergeArguments>(mergeSchema);
export const validateOutput = ajv.compile(outputSchema);

export function validateArguments(operation: Operation, args: unknown): ImageArguments | MergeArguments {
  if (operation === 'merge_pdfs') {
    if (!validateMerge(args)) throw new PilotError('INVALID_ARGUMENTS');
    return args;
  }
  const validate = operation === 'compress_image_to_size' ? validateCompress : validateImage;
  if (!validate(args)) throw new PilotError('INVALID_ARGUMENTS');
  return args;
}

function tool(name: Operation, title: string, description: string, inputSchema: Tool['inputSchema'], fileField: string): Tool {
  return {
    name, title, description, inputSchema, outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: { 'openai/fileParams': [fileField], ui: { resourceUri: UI_URI } },
  };
}

export const TOOLS: Tool[] = [
  tool('compress_image_to_size', 'Compress an image to a size', 'Compress one JPEG, PNG, or WebP to a target KB. An over-target PNG may become JPEG and lose transparency. Unreachable targets return an error.', compressSchema, 'file'),
  tool('strip_image_metadata', 'Remove image metadata', 'Re-encode one JPEG, PNG, or WebP with baked orientation and removed container metadata. JPEG/WebP quality is 95. Visible content is not redacted.', imageSchema, 'file'),
  tool('merge_pdfs', 'Merge PDFs in order', 'Merge two to five PDFs in the supplied order, up to 100 pages combined. Document contents and active content are preserved; this does not sanitize PDFs.', mergeSchema, 'files'),
];
