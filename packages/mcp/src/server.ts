import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createDefaultRegistry, toolRunsOnSurface, runChain, parseChainString } from '@wyreup/core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ──── MIME helpers ────────────────────────────────────────────────────────────

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
  'image/x-icon': '.ico',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/markdown': '.md',
  'application/json': '.json',
  'text/csv': '.csv',
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'video/mp4': '.mp4',
};

function inferMimeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

function extFromMime(mime: string): string {
  return MIME_TO_EXT[mime] ?? '.bin';
}

// ──── LLM-optimized descriptions ─────────────────────────────────────────────

const TOOL_DESCRIPTIONS: Record<string, string> = {
  compress:
    'Compress an image (JPEG/PNG/WebP) to reduce file size. Use when a user wants a smaller image file. Quality is 1-100 (default 80). Preserves the original format unless targetFormat is set.',
  convert:
    'Convert an image to a different format (JPEG, PNG, WebP, etc.). Use when the user needs a specific file format, e.g. PNG to JPEG or WebP.',
  'strip-exif':
    'Remove all EXIF metadata from JPEG/PNG images. Use for privacy — strips GPS location, camera model, timestamps, and other embedded metadata.',
  'image-to-pdf':
    'Convert one or more images (JPEG, PNG, WebP) into a single PDF. Use when the user wants to combine images into a PDF document.',
  'merge-pdf':
    'Merge two or more PDF files into one. Use when the user wants to combine multiple PDFs in order.',
  'split-pdf':
    'Split a PDF into individual pages or page ranges. Produces multiple output files — use output_dir. Use when the user wants separate PDFs per page or range.',
  'rotate-pdf':
    'Rotate pages in a PDF by 90, 180, or 270 degrees. Use when a PDF is sideways or upside down.',
  'reorder-pdf':
    'Reorder pages in a PDF by specifying a new page order. Use when the user wants to rearrange PDF pages.',
  'page-numbers-pdf':
    'Add page numbers to a PDF. Use when the user wants numbered pages on an existing PDF.',
  'color-palette':
    'Extract a color palette from an image. Returns dominant colors as hex codes. Use when the user wants to know the main colors in an image.',
  qr: 'Generate a QR code from a URL or text. No input file needed. Use when the user wants a scannable QR image.',
  'watermark-pdf':
    'Add a text watermark to all pages of a PDF. Use when the user wants a "CONFIDENTIAL", "DRAFT", or custom watermark on a PDF.',
  'pdf-to-text':
    'Extract all text content from a PDF. Returns a plain text file. Use when the user wants to read or search the text inside a PDF.',
  'image-diff':
    'Compare two images and highlight the pixel differences. Use when the user wants to see what changed between two versions of an image.',
  'rotate-image':
    'Rotate an image by a specified angle (90, 180, 270 degrees or custom). Use when an image is oriented incorrectly.',
  'flip-image':
    'Flip an image horizontally or vertically. Use when the user wants a mirror image.',
  grayscale:
    'Convert a color image to grayscale. Use when the user wants a black-and-white version of an image.',
  sepia: 'Apply a sepia tone filter to an image. Use for a warm vintage look.',
  invert:
    'Invert the colors of an image (negative effect). Use when the user wants an inverted/negative image.',
  'image-info':
    'Get metadata about an image: dimensions, format, file size, color mode. Use when the user asks "what size is this image?" or wants image properties.',
  'pdf-info':
    'Get metadata about a PDF: page count, dimensions, title, author, etc. Use when the user asks for PDF properties or page count.',
  hash: 'Compute SHA-256, SHA-1, or SHA-512 cryptographic hashes of any file. Use for integrity verification or checksums.',
  crop: 'Crop an image to a specific rectangle. Use when the user wants to trim or cut a portion of an image.',
  resize:
    'Resize an image to specific dimensions or a percentage. Use when the user needs a different image size.',
  'image-watermark':
    'Add a text or image watermark to an image. Use when the user wants to brand or protect an image.',
  favicon:
    'Generate a favicon (.ico) from an image. Use when the user needs a website favicon in multiple sizes.',
  'pdf-to-image':
    'Convert PDF pages to images (PNG/JPEG). Produces multiple output files — use output_dir. Use when the user wants to view or use PDF pages as images.',
  'json-formatter':
    'Format, prettify, or minify JSON. Use when the user has messy or minified JSON and wants it readable.',
  base64:
    'Encode a file to base64 or decode a base64 string to a file. Use when the user needs to convert between binary and base64 text.',
  'url-encoder':
    'URL-encode or URL-decode a text file or string. Use when the user needs percent-encoding for URLs.',
  'color-converter':
    'Convert colors between HEX, RGB, HSL, and other formats. Returns a JSON file with all format representations.',
  'markdown-to-html':
    'Convert a Markdown (.md) file to HTML. Use when the user wants an HTML version of their Markdown document.',
  'html-to-markdown':
    'Convert an HTML file to Markdown. Use when the user wants a Markdown version of an HTML document.',
  'text-diff':
    'Show the line-by-line diff between two text files. Use when the user wants to compare two versions of a text file.',
  'word-counter':
    'Count words, characters, sentences, and paragraphs in a text file. Use when the user asks for word or character count.',
  'password-generator':
    'Generate a secure random password. No input file needed. Use when the user needs a random password with configurable length and complexity.',
  'uuid-generator':
    'Generate one or more UUIDs (v4). No input file needed. Use when the user needs a unique identifier.',
  ocr: 'Extract text from an image using OCR. Returns a text file. Use when the user has a scanned document or screenshot and wants the text content. Note: may be slower in Node/CLI context due to Tesseract initialization.',
  'svg-to-png':
    'Convert an SVG file to a PNG image. Use when the user needs a raster version of an SVG graphic.',
  'timestamp-converter':
    'Convert a Unix timestamp to a human-readable date, or vice versa. Returns JSON with multiple timezone representations.',
  'lorem-ipsum':
    'Generate lorem ipsum placeholder text. No input file needed. Use when the user needs dummy/filler text for design mockups.',
  'regex-tester':
    'Test a regular expression against sample text. Returns JSON with all matches. Use when the user wants to validate or debug a regex pattern.',
  'pdf-extract-pages':
    'Extract specific pages from a PDF into a new PDF. Use when the user wants just certain pages from a larger PDF.',
  'pdf-delete-pages':
    'Delete specific pages from a PDF. Use when the user wants to remove pages from a PDF.',
  'pdf-compress':
    'Compress a PDF to reduce file size. Use when the user needs to shrink a PDF for email or upload.',
  'pdf-encrypt':
    'Password-protect (encrypt) a PDF. Use when the user wants to add a password to a PDF.',
  'pdf-decrypt':
    'Remove the password from a PDF (decrypt). Requires knowing the current password. Use to unlock a password-protected PDF.',
  'pdf-redact':
    'Redact (black out) specific areas of a PDF. Use when the user wants to hide sensitive text or regions on a PDF page.',
  'pdf-metadata':
    'Read or update PDF metadata (title, author, subject, keywords). Use when the user wants to see or change PDF document properties.',
  'pdf-extract-tables':
    'Extract tabular data from a PDF and return it as JSON or CSV. Use when the user wants the data from tables inside a PDF.',
  'pdf-crop':
    'Crop the visible area of PDF pages. Use when the user wants to trim margins or reframe the visible region of a PDF.',
  'face-blur':
    'Detect and blur all faces in an image using MediaPipe. Use for privacy — anonymizes people in photos. Note: requires browser/WebGL context for MediaPipe; may not work in pure Node.js without a display.',
  'audio-enhance':
    'Enhance audio quality using AI super-resolution (FlashSR, 16kHz to 48kHz upsampling). Use when the user wants higher quality audio from a low-quality recording. CPU/GPU-intensive — may take several seconds.',
};

// ──── Schema builder ──────────────────────────────────────────────────────────

function inferParamType(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { type: 'null' };
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'array', items: {} };
    return { type: 'array', items: inferParamType(value[0]) };
  }
  switch (typeof value) {
    case 'boolean': return { type: 'boolean' };
    case 'number': return { type: 'number' };
    case 'string': return { type: 'string' };
    case 'object': {
      const properties: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        properties[k] = inferParamType(v);
      }
      return { type: 'object', properties };
    }
    default: return {};
  }
}

function buildParamsSchema(defaults: unknown): Record<string, unknown> {
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
    return { type: 'object', additionalProperties: true };
  }
  const properties: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(defaults as Record<string, unknown>)) {
    properties[key] = inferParamType(val);
  }
  return { type: 'object', properties, additionalProperties: true };
}

function buildMcpInputSchema(tool: { defaults: unknown; output: { multiple?: boolean } }): Record<string, unknown> {
  const isMultiOutput = tool.output.multiple === true;
  const properties: Record<string, unknown> = {
    input_paths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Absolute paths to input files on disk.',
    },
    params: {
      ...buildParamsSchema(tool.defaults),
      description: 'Tool-specific parameters. Uses defaults if omitted.',
    },
  };

  if (isMultiOutput) {
    properties['output_dir'] = {
      type: 'string',
      description: 'Absolute path to directory where output files will be written.',
    };
  } else {
    properties['output_path'] = {
      type: 'string',
      description: 'Absolute path where the output file will be written.',
    };
  }

  return {
    type: 'object',
    properties,
  };
}

// ──── Server factory ──────────────────────────────────────────────────────────

export function createWyreupMcpServer(): Server {
  const registry = createDefaultRegistry();
  // Hide tools that can't run via MCP (e.g. web-only capture
  // primitives like record-audio that need getUserMedia). They aren't
  // listed and aren't callable — the agent never sees them as an
  // option, so there's no fail path.
  const tools = Array.from(registry.toolsById.values()).filter((t) =>
    toolRunsOnSurface(t, 'mcp'),
  );

  const server = new Server(
    { name: 'wyreup', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // The `wyreup_chain` meta-tool lets agents run a multi-step chain
  // in a single call instead of orchestrating each tool individually.
  // Same pipeline the web's /chain/run uses; same chain string syntax
  // the CLI's `wyreup chain --steps "..."` accepts.
  const CHAIN_TOOL = {
    name: 'wyreup_chain',
    description:
      'Run a chain of Wyreup tools in sequence. Each step\'s output becomes the next step\'s input. ' +
      'Chain syntax: "tool1|tool2[key=val,key2=val2]|tool3". ' +
      'Use this when the agent task naturally pipelines (e.g. transcribe an audio file then summarize the text).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        steps: {
          type: 'string',
          description:
            'Chain string. Pipe-delimited tool IDs with optional [key=value,...] params: ' +
            '"transcribe|text-summarize[maxLength=200]" or "strip-exif|compress[quality=80]".',
        },
        input_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Input file paths for the first step.',
        },
        output_path: {
          type: 'string',
          description: 'Where to write the final result. Required for binary outputs.',
        },
        output_dir: {
          type: 'string',
          description: 'Directory for multi-output chains (each output written with a tool-derived name).',
        },
      },
      required: ['steps', 'input_paths'],
    },
  };

  // Handler signature requires Promise return; no internal await needed.
  // eslint-disable-next-line @typescript-eslint/require-await
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      CHAIN_TOOL,
      ...tools.map((tool) => ({
        name: tool.id,
        description: TOOL_DESCRIPTIONS[tool.id] ?? `${tool.name}: ${tool.description}`,
        inputSchema: buildMcpInputSchema(tool),
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Meta-tool: run a chain in one shot.
    if (name === 'wyreup_chain') {
      const rawArgs = args ?? {};
      const stepsStr = rawArgs['steps'] as string | undefined;
      const inputPaths = (rawArgs['input_paths'] as string[] | undefined) ?? [];
      const outputPath = rawArgs['output_path'] as string | undefined;
      const outputDir = rawArgs['output_dir'] as string | undefined;
      if (!stepsStr) {
        throw new Error('wyreup_chain requires a "steps" chain string.');
      }
      const chain = parseChainString(stepsStr);
      if (chain.length === 0) {
        throw new Error('wyreup_chain: no valid steps parsed from input.');
      }
      // Validate every step references a real, MCP-runnable tool.
      for (const step of chain) {
        const t = registry.toolsById.get(step.toolId);
        if (!t) throw new Error(`wyreup_chain: unknown tool "${step.toolId}".`);
        if (!toolRunsOnSurface(t, 'mcp')) {
          throw new Error(
            `wyreup_chain: tool "${step.toolId}" is not available on MCP. ` +
              'Web-only capture primitives (record-audio, take-photo, etc.) cannot run in a chain from MCP.',
          );
        }
      }

      const inputFiles = await Promise.all(
        inputPaths.map(async (filePath: string) => {
          const data = await readFile(filePath);
          return new File([data], basename(filePath), {
            type: inferMimeFromPath(filePath),
          });
        }),
      );

      const result = await runChain(
        chain,
        inputFiles,
        {
          onProgress: () => {},
          signal: new AbortController().signal,
          cache: new Map(),
          executionId: randomUUID(),
        },
        registry,
      );

      const outputs = Array.isArray(result) ? result : [result];
      const writtenPaths: string[] = [];

      if (outputs.length === 1 && outputPath) {
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, Buffer.from(await outputs[0]!.arrayBuffer()));
        writtenPaths.push(outputPath);
      } else if (outputDir) {
        await mkdir(outputDir, { recursive: true });
        for (let i = 0; i < outputs.length; i++) {
          const ext = extFromMime(outputs[i]!.type);
          const outPath = join(outputDir, `chain-${i}${ext}`);
          await writeFile(outPath, Buffer.from(await outputs[i]!.arrayBuffer()));
          writtenPaths.push(outPath);
        }
      } else if (outputs.length > 0 && !outputDir && !outputPath) {
        const blob = outputs[0]!;
        if (blob.type.startsWith('text/') || blob.type === 'application/json') {
          const text = await blob.text();
          return { content: [{ type: 'text', text }] };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Chain produced binary output but no output_path was provided. Rerun with output_path or output_dir.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Chain completed (${chain.length} step${chain.length === 1 ? '' : 's'}). Output${writtenPaths.length > 1 ? 's' : ''}:\n${writtenPaths.join('\n')}`,
          },
        ],
      };
    }

    const tool = registry.toolsById.get(name);
    if (!tool || !toolRunsOnSurface(tool, 'mcp')) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const rawArgs = args ?? {};
    const inputPaths = (rawArgs['input_paths'] as string[] | undefined) ?? [];
    const outputPath = rawArgs['output_path'] as string | undefined;
    const outputDir = rawArgs['output_dir'] as string | undefined;
    const params = (rawArgs['params'] as Record<string, unknown> | undefined) ?? tool.defaults;

    // Read input files from disk
    const inputFiles = await Promise.all(
      inputPaths.map(async (filePath: string) => {
        const data = await readFile(filePath);
        return new File([data], basename(filePath), {
          type: inferMimeFromPath(filePath),
        });
      }),
    );

    // Run the tool
    const result = await tool.run(inputFiles, params, {
      onProgress: () => {},
      signal: new AbortController().signal,
      cache: new Map(),
      executionId: randomUUID(),
    });

    const outputs = Array.isArray(result) ? result : [result];
    const writtenPaths: string[] = [];

    if (outputs.length === 1 && outputPath) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, Buffer.from(await outputs[0]!.arrayBuffer()));
      writtenPaths.push(outputPath);
    } else if (outputDir) {
      await mkdir(outputDir, { recursive: true });
      for (let i = 0; i < outputs.length; i++) {
        const ext = extFromMime(outputs[i]!.type);
        const outPath = join(outputDir, `${tool.id}-${i}${ext}`);
        await writeFile(outPath, Buffer.from(await outputs[i]!.arrayBuffer()));
        writtenPaths.push(outPath);
      }
    } else if (outputs.length > 0 && !outputDir && !outputPath) {
      // No output path given — return content inline for text/JSON tools
      const blob = outputs[0]!;
      if (blob.type.startsWith('text/') || blob.type === 'application/json') {
        const text = await blob.text();
        return {
          content: [{ type: 'text', text }],
        };
      }
      // Binary with no output path — surface a helpful error
      return {
        content: [
          {
            type: 'text',
            text: `Tool "${tool.id}" produced binary output but no output_path${tool.output.multiple ? '/output_dir' : ''} was provided. Rerun with an output path.`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Successfully processed. Output${writtenPaths.length > 1 ? 's' : ''}:\n${writtenPaths.join('\n')}`,
        },
      ],
    };
  });

  return server;
}

export { StdioServerTransport };
