import type { ToolModule, ToolRunContext } from '../types.js';
import { cssFormatter } from '../tools/css-formatter/index.js';
import { htmlFormatter } from '../tools/html-formatter/index.js';
import { xmlFormatter } from '../tools/xml-formatter/index.js';
import { sqlFormatter } from '../tools/sql-formatter/index.js';
import { UtilityInputError, validateUtilityParams, type UtilityParams } from './common.js';
import { assertUnicode } from './text-developer.js';

export type BeautifierLanguage = 'json' | 'css' | 'html' | 'xml' | 'sql' | 'javascript';
const defaults = { language: 'javascript' };
const schema = {
  language: {
    type: 'enum' as const,
    label: 'Language',
    options: ['json', 'css', 'html', 'xml', 'sql', 'javascript'].map((value) => ({
      value,
      label: value,
    })),
  },
};

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new UtilityInputError('$run', 'abort', 'Formatting cancelled.');
}

function checkJsonStructure(text: string, signal: AbortSignal): void {
  // Grammar is validated first. Count original lexical values, including
  // duplicate-key subtrees that JSON.parse would discard.
  JSON.parse(text);
  let depth = 0;
  let values = 0;
  let cursor = 0;
  const whitespace = (character: string) => ' \t\r\n'.includes(character);
  const value = () => {
    if (depth > 128)
      throw new UtilityInputError('$input', 'depth', 'JSON nesting exceeds 128 levels.');
    if (++values > 100000)
      throw new UtilityInputError('$input', 'budget', 'JSON exceeds 100000 values.');
  };
  while (cursor < text.length) {
    if ((cursor & 1023) === 0) checkAbort(signal);
    const character = text[cursor]!;
    if (whitespace(character) || character === ',' || character === ':') {
      cursor++;
    } else if (character === '}' || character === ']') {
      depth--;
      cursor++;
    } else if (character === '{' || character === '[') {
      value();
      depth++;
      cursor++;
    } else if (character === '"') {
      cursor++;
      while (cursor < text.length && text[cursor] !== '"') {
        if ((cursor & 1023) === 0) checkAbort(signal);
        cursor += text[cursor] === '\\' ? 2 : 1;
      }
      cursor++;
      let next = cursor;
      while (next < text.length && whitespace(text[next]!)) next++;
      if (text[next] !== ':') value();
    } else {
      value();
      while (cursor < text.length && !whitespace(text[cursor]!) && !',}]'.includes(text[cursor]!)) {
        if ((cursor & 1023) === 0) checkAbort(signal);
        cursor++;
      }
    }
  }
  checkAbort(signal);
}

export async function beautifyCode(
  text: string,
  language: BeautifierLanguage,
  ctx: ToolRunContext,
): Promise<string> {
  checkAbort(ctx.signal);
  assertUnicode(text);
  if (new TextEncoder().encode(text).length > 5 * 1024 * 1024)
    throw new UtilityInputError('$input', 'budget', 'Code input exceeds 5 MiB.');
  const params = validateUtilityParams(defaults, schema, { language });
  let result: string;
  if (params.language === 'javascript' || params.language === 'json') {
    if (params.language === 'json') checkJsonStructure(text, ctx.signal);
    const [prettier, babel, estree] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ]);
    checkAbort(ctx.signal);
    result = await prettier.format(text, {
      parser: params.language === 'json' ? 'json-stringify' : 'babel',
      plugins: [babel, estree],
      tabWidth: 2,
      printWidth: 80,
    });
    if (params.language === 'json') result = result.replace(/\n$/, '');
  } else {
    const file = new File([text], 'code.txt', { type: 'text/plain' });
    let artifacts: Blob | Blob[];
    if (params.language === 'css')
      artifacts = await cssFormatter.run(
        [file],
        { mode: 'beautify', printWidth: 80, tabWidth: 2 },
        ctx,
      );
    else if (params.language === 'html')
      artifacts = await htmlFormatter.run(
        [file],
        { mode: 'beautify', printWidth: 80, tabWidth: 2 },
        ctx,
      );
    else if (params.language === 'xml')
      artifacts = await xmlFormatter.run([file], { mode: 'beautify', indent: 2 }, ctx);
    else
      artifacts = await sqlFormatter.run(
        [file],
        { language: 'sql', keywordCase: 'upper', indent: 2 },
        ctx,
      );
    checkAbort(ctx.signal);
    const blobs = Array.isArray(artifacts) ? artifacts : [artifacts];
    if (blobs.length !== 1 || !(blobs[0] instanceof Blob) || blobs[0].size > 20 * 1024 * 1024)
      throw new Error('Formatter returned an invalid artifact.');
    result = await blobs[0].text();
  }
  checkAbort(ctx.signal);
  if (new TextEncoder().encode(result).length > 20 * 1024 * 1024)
    throw new UtilityInputError('$result', 'budget', 'Formatted code exceeds 20 MiB.');
  return result;
}

export const codeBeautifier: ToolModule<UtilityParams> = {
  id: 'code-beautifier',
  slug: 'code-beautifier',
  name: 'Code Beautifier',
  description:
    'Format JavaScript, JSON, CSS, HTML, XML or SQL locally. JSON number spellings are preserved. XML formatting can change significant whitespace; forgiving HTML and SQL formatting is not a syntax-validation guarantee. Code is never executed.',
  category: 'dev',
  keywords: ['code', 'beautify', 'format', 'javascript', 'json', 'css', 'html', 'xml', 'sql'],
  input: {
    accept: [
      'text/plain',
      'text/javascript',
      'application/javascript',
      'application/json',
      'text/css',
      'text/html',
      'text/xml',
      'application/xml',
      'application/sql',
    ],
    min: 1,
    max: 1,
    sizeLimit: 5 * 1024 * 1024,
  },
  output: { mime: 'text/plain', multiple: false },
  defaults,
  paramSchema: schema,
  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  surfaces: ['web', 'cli', 'mcp'],
  async run(inputs, provided, ctx) {
    checkAbort(ctx.signal);
    if (inputs.length !== 1 || inputs[0]!.size > 5 * 1024 * 1024)
      throw new UtilityInputError('$input', 'budget', 'Select one code file of at most 5 MiB.');
    const mime = inputs[0]!.type.split(';', 1)[0]!.trim();
    if (mime && !codeBeautifier.input.accept.includes(mime))
      throw new UtilityInputError('$input', 'type', 'Unsupported code file MIME type.');
    const params = validateUtilityParams(defaults, schema, provided);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await inputs[0]!.arrayBuffer());
    const result = await beautifyCode(text, params.language as BeautifierLanguage, ctx);
    checkAbort(ctx.signal);
    ctx.onProgress({ stage: 'done', percent: 100 });
    return [new Blob([result], { type: 'text/plain' })];
  },
  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['text/plain'] },
};
