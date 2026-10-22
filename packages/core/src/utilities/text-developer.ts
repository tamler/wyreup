import Papa from 'papaparse';
import type { ParamFieldSchema, ToolCategory, ToolModule, ToolRunContext } from '../types.js';
import {
  cloneUtilityJson,
  createUtility,
  numberParam,
  stringParam,
  validateUtilityParams,
  type UtilityDefinition,
  type UtilityParams,
  type UtilityResult,
} from './common.js';

const MiB = 1024 * 1024;
const encoder = new TextEncoder();
const string = (label: string, maxLength = 100000): ParamFieldSchema => ({
  type: 'string',
  label,
  maxLength,
});
const bool = (label: string): ParamFieldSchema => ({ type: 'boolean', label });
const choice = (label: string, values: string[]): ParamFieldSchema => ({
  type: 'enum',
  label,
  options: values.map((value) => ({ value, label: value })),
});
const bounded = (label: string, min: number, max: number, step?: number): ParamFieldSchema => ({
  type: 'number',
  label,
  min,
  max,
  ...(step === undefined ? {} : { step }),
});

export function assertUnicode(text: string): void {
  for (let i = 0; i < text.length; i++) {
    const n = text.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new Error('Text contains an unpaired Unicode surrogate.');
    } else if (n >= 0xdc00 && n <= 0xdfff)
      throw new Error('Text contains an unpaired Unicode surrogate.');
  }
}

function abort(ctx: ToolRunContext): void {
  if (ctx.signal.aborted) throw new Error('Cancelled.');
}

function textBudget(text: string, max = 5 * MiB): void {
  assertUnicode(text);
  if (encoder.encode(text).byteLength > max) throw new Error(`Text exceeds ${max} bytes.`);
}

function definition(
  id: string,
  name: string,
  description: string,
  category: ToolCategory,
  defaults: UtilityParams,
  paramSchema: Record<string, ParamFieldSchema>,
  calculate: UtilityDefinition['calculate'],
): UtilityDefinition {
  return {
    id,
    name,
    description,
    category,
    keywords: id.split('-'),
    defaults,
    paramSchema,
    calculate,
  };
}

function fileTool(
  id: string,
  name: string,
  description: string,
  category: ToolCategory,
  mime: string,
  accept: string[],
  defaults: UtilityParams,
  paramSchema: Record<string, ParamFieldSchema>,
  transform: (text: string, params: UtilityParams, ctx: ToolRunContext) => string | Promise<string>,
): ToolModule<UtilityParams> {
  return {
    id,
    slug: id,
    name,
    description,
    category,
    keywords: id.split('-'),
    input: { accept, min: 1, max: 1, sizeLimit: 5 * MiB },
    output: { mime, multiple: false },
    defaults,
    paramSchema,
    interactive: false,
    batchable: true,
    cost: 'free',
    memoryEstimate: 'low',
    async run(inputs, params, ctx) {
      abort(ctx);
      if (inputs.length !== 1) throw new Error('Select exactly one text file.');
      const file = inputs[0]!;
      if (file.size > 5 * MiB) throw new Error('Text file exceeds 5 MiB.');
      const essence = file.type.split(';', 1)[0]!.trim();
      if (essence && !accept.includes(essence) && essence !== 'text/plain')
        throw new Error('Unsupported text file type.');
      const bytes = await file.arrayBuffer();
      abort(ctx);
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new Error('File must contain valid UTF-8 text.');
      }
      const validated = validateUtilityParams(defaults, paramSchema, params);
      const result = await transform(text, validated, ctx);
      abort(ctx);
      textBudget(result, 20 * MiB);
      ctx.onProgress({ stage: 'done', percent: 100 });
      return [new Blob([result], { type: mime })];
    },
    __testFixtures: { valid: [], weird: [], expectedOutputMime: [mime] },
  };
}

function generator(
  id: string,
  name: string,
  description: string,
  mime: string,
  defaults: UtilityParams,
  schema: Record<string, ParamFieldSchema>,
  generate: (params: UtilityParams) => string,
): ToolModule<UtilityParams> {
  return {
    id,
    slug: id,
    name,
    description,
    category: 'dev',
    keywords: id.split('-'),
    input: { accept: [], min: 0, max: 0 },
    output: { mime, multiple: false },
    defaults,
    paramSchema: schema,
    cost: 'free',
    interactive: false,
    batchable: false,
    memoryEstimate: 'low',
    async run(inputs, params, ctx) {
      abort(ctx);
      if (inputs.length) throw new Error('This generator does not accept files.');
      const result = generate(validateUtilityParams(defaults, schema, params));
      textBudget(result, 20 * MiB);
      abort(ctx);
      ctx.onProgress({ stage: 'done', percent: 100 });
      return await Promise.resolve([new Blob([result], { type: mime })]);
    },
    __testFixtures: { valid: [], weird: [], expectedOutputMime: [mime] },
  };
}

const small = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function chunkWords(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${small[Math.floor(n / 100)]} hundred`);
    n %= 100;
  }
  if (n >= 20) parts.push(`${tens[Math.floor(n / 10)]}${n % 10 ? `-${small[n % 10]}` : ''}`);
  else if (n) parts.push(small[n]!);
  return parts.join(' ');
}
function integerWords(n: bigint): string {
  if (!n) return 'zero';
  const scale = ['', 'thousand', 'million', 'billion', 'trillion'];
  const parts: string[] = [];
  let i = 0;
  while (n) {
    const chunk = Number(n % 1000n);
    if (chunk) parts.unshift(`${chunkWords(chunk)}${scale[i] ? ` ${scale[i]}` : ''}`);
    n /= 1000n;
    i++;
  }
  return parts.join(' ');
}

export function numberToWords(params: UtilityParams): UtilityResult {
  const raw = stringParam(params, 'numberText');
  if (!/^[+-]?[0-9]{1,15}(?:\.[0-9]{1,6})?$/.test(raw))
    throw new Error(
      'Enter a decimal with at most 15 integer and six fractional digits; no spaces or exponent.',
    );
  const unsigned = raw.replace(/^[+-]/, '');
  const [integer, fraction = ''] = unsigned.split('.');
  const major = BigInt(integer!);
  const negative = raw.startsWith('-') && /[1-9]/.test(unsigned);
  let words = integerWords(major);
  if (params.mode === 'currency') {
    const exponent = numberParam(params, 'exponent', { integer: true, min: 0, max: 2 });
    if (fraction.length > exponent || (exponent === 0 && fraction))
      throw new Error('Fraction exceeds the declared currency exponent.');
    const noun = (key: string) => {
      const value = stringParam(params, key, { maxLength: 60 });
      if (!/^[A-Za-z]+(?:[ -][A-Za-z]+)*$/.test(value))
        throw new Error(`${key}: enter a unit name using ASCII letters, spaces or hyphens.`);
      return value;
    };
    const label = stringParam(params, 'currencyLabel', { maxLength: 20 });
    if (!/^[A-Za-z0-9 -]{1,20}$/.test(label))
      throw new Error('currencyLabel: enter a short currency label.');
    words += ` ${noun(major === 1n ? 'majorSingular' : 'majorPlural')}`;
    if (exponent) {
      const minor = BigInt(fraction.padEnd(exponent, '0'));
      words += ` and ${integerWords(minor)} ${noun(minor === 1n ? 'minorSingular' : 'minorPlural')}`;
    }
    return {
      numberText: raw,
      mode: 'currency',
      words: `${negative ? 'minus ' : ''}${words}`,
      unitAssumptions: {
        currencyLabel: label,
        exponent,
        majorSingular: noun('majorSingular'),
        majorPlural: noun('majorPlural'),
        ...(exponent
          ? { minorSingular: noun('minorSingular'), minorPlural: noun('minorPlural') }
          : {}),
      },
    };
  }
  if (fraction) words += ` point ${[...fraction].map((n) => small[Number(n)]).join(' ')}`;
  return {
    numberText: raw,
    mode: 'number',
    words: `${negative ? 'minus ' : ''}${words}`,
    unitAssumptions: { language: 'US English' },
  };
}

export function removeDuplicateLines(text: string, params: UtilityParams): string {
  textBudget(text);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = params.trim ? raw.trim() : raw;
    if (params.blankLines === 'remove' && !line.trim()) continue;
    const key = params.caseSensitive ? line : line.toLocaleLowerCase('en');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(line);
    }
  }
  return result.join('\n');
}

const delimiters: Record<string, string> = { comma: ',', tab: '\t', semicolon: ';', pipe: '|' };
export function parseTextRows(
  text: string,
  mode: string,
  maxRows = 10000,
  maxColumns = 100,
): string[][] {
  textBudget(text);
  if (!text) throw new Error('Enter a nonempty table.');
  const parse = (delimiter: string) => {
    const data: string[][] = [];
    let error = '';
    let quota = false;
    Papa.parse<string[]>(text, {
      delimiter,
      header: false,
      dynamicTyping: false,
      skipEmptyLines: false,
      step(result, parser) {
        if (result.errors.length) {
          error = result.errors[0]!.message;
          parser.abort();
          return;
        }
        if (result.data.length > maxColumns || data.length >= maxRows + 1) {
          error = 'Table exceeds the row or column limit.';
          quota = true;
          parser.abort();
          return;
        }
        data.push(result.data);
      },
    });
    const last = data.at(-1);
    if (/[\r\n]$/.test(text) && last?.length === 1 && last[0] === '') data.pop();
    if (data.length > maxRows) {
      error = 'Table exceeds the row limit.';
      quota = true;
    }
    return { data, error, quota };
  };
  if (mode === 'auto') {
    const attempts = Object.values(delimiters).map(parse);
    const candidates = attempts.filter(
      ({ data, error }) =>
        !error &&
        data.length > 0 &&
        data[0]!.length > 1 &&
        data.every((row) => row.length === data[0]!.length),
    );
    if (candidates.length === 0 && attempts.some(({ quota }) => quota))
      throw new Error(
        'Auto detection found no table within the row/column limit. Choose an explicit delimiter.',
      );
    if (candidates.length !== 1)
      throw new Error(
        'Delimiter is ambiguous or rows are inconsistent. Choose an explicit delimiter.',
      );
    return candidates[0]!.data;
  }
  const delimiter = delimiters[mode];
  if (!delimiter) throw new Error('Choose a supported delimiter.');
  const result = parse(delimiter);
  if (result.error) throw new Error(`CSV parse: ${result.error}`);
  return result.data;
}

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
export function markdownTable(text: string, params: UtilityParams): string {
  const rows = parseTextRows(text, stringParam(params, 'delimiter'));
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''));
  const headers = params.hasHeader
    ? padded.shift()!
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const cell = (s: string) =>
    escapeHtml(s)
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\r\n?|\n/g, '<br>');
  const line = (row: string[]) => `| ${row.map(cell).join(' | ')} |\n`;
  return line(headers) + line(headers.map(() => '---')) + padded.map(line).join('');
}

export function bulkMetaDescriptions(
  text: string,
  params: UtilityParams,
  ctx?: ToolRunContext,
): string {
  if (ctx) abort(ctx);
  const rows = parseTextRows(text, stringParam(params, 'delimiter'));
  if (ctx) abort(ctx);
  if (JSON.stringify(rows.shift()) !== JSON.stringify(['title', 'topic', 'url']))
    throw new Error('Use the exact header title,topic,url in that order.');
  const template = stringParam(params, 'template');
  textBudget(template, 100000);
  if (/[{}]/.test(template.replace(/\{(?:title|topic|url)\}/g, '')))
    throw new Error('Template supports only {title}, {topic} and {url}.');
  const max = numberParam(params, 'maxGraphemes', { integer: true, min: 1, max: 500 });
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const output: Array<Array<string | number | boolean>> = [
    ['url', 'title', 'description', 'graphemeCount', 'truncated', 'error'],
  ];
  const occurrences = { title: 0, topic: 0, url: 0 };
  const literalBytes = encoder.encode(
    template.replace(/\{(title|topic|url)\}/g, (_match, key: keyof typeof occurrences) => {
      occurrences[key]++;
      return '';
    }),
  ).length;
  let aggregateBytes = 0;
  // Check every row before expanding any template. Substitution is one pass,
  // with a function replacer so cell contents are inserted literally.
  for (const row of rows) {
    if (ctx) abort(ctx);
    if (row.length !== 3)
      throw new Error('Every description row must contain title, topic and url.');
    const expandedBytes =
      literalBytes +
      row.reduce(
        (sum, value, index) =>
          sum +
          encoder.encode(value).length * occurrences[(['title', 'topic', 'url'] as const)[index]!],
        0,
      );
    if (expandedBytes > MiB) throw new Error('Expanded description exceeds the 1 MiB limit.');
    aggregateBytes += expandedBytes;
    if (aggregateBytes > 20 * MiB)
      throw new Error('Aggregate expanded descriptions exceed the 20 MiB limit.');
  }
  for (const row of rows) {
    if (ctx) abort(ctx);
    if (row.length !== 3)
      throw new Error('Every description row must contain title, topic and url.');
    const [title, topic, url] = row as [string, string, string];
    if (!title.trim()) {
      output.push([url, title, '', 0, false, 'Empty title']);
      continue;
    }
    const values = { title, topic, url };
    const full = template
      .replace(/\{(title|topic|url)\}/g, (_match, key: keyof typeof values) => values[key])
      .replace(/\s+/g, ' ')
      .trim();
    const graphemes: string[] = [];
    for (const value of segmenter.segment(full)) {
      graphemes.push(value.segment);
      if (graphemes.length > max) break;
    }
    let description = graphemes.slice(0, max).join('');
    const truncated = graphemes.length > max;
    if (truncated && graphemes[max] !== ' ' && description.includes(' '))
      description = description.slice(0, description.lastIndexOf(' '));
    description = description.trimEnd();
    output.push([
      url,
      title,
      description,
      [...segmenter.segment(description)].length,
      truncated,
      '',
    ]);
  }
  return Papa.unparse(output, { newline: '\n' });
}

function rowsParam(
  params: UtilityParams,
  field: string,
  columns: string[],
  max = 1000,
): Record<string, unknown>[] {
  const text = stringParam(params, field);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${field}: enter valid rows.`);
  }
  const cloned = cloneUtilityJson(parsed);
  if (!Array.isArray(cloned) || cloned.length > max)
    throw new Error(`${field}: use at most ${max} rows.`);
  return cloned.map((row, i) => {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw new Error(`${field} row ${i + 1}: expected an object.`);
    const keys = Object.keys(row);
    if (keys.length !== columns.length || columns.some((key) => !Object.hasOwn(row, key)))
      throw new Error(`${field} row ${i + 1}: expected only ${columns.join(', ')}.`);
    return row;
  });
}
function rowString(row: Record<string, unknown>, key: string, max = 2048): string {
  const value = stringParam(row, key, { maxLength: max });
  assertUnicode(value);
  return value;
}
function asciiControl(text: string, includeSpace = false): boolean {
  return Array.from(text).some((character) => {
    const code = character.charCodeAt(0);
    return code <= (includeSpace ? 0x20 : 0x1f) || code === 0x7f;
  });
}
function absoluteUrl(text: string): URL {
  if (!/^https?:\/\//i.test(text) || asciiControl(text, true))
    throw new Error('Use an absolute HTTP(S) URL without controls or whitespace.');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('Invalid HTTP(S) URL.');
  }
  if (url.username || url.password) throw new Error('URL user information is not supported.');
  return url;
}
function percentBytes(text: string, prohibited: (value: string) => boolean): void {
  for (let i = 0; i < text.length; i++)
    if (text[i] === '%') {
      const pair = text.slice(i + 1, i + 3);
      if (!/^[0-9a-f]{2}$/i.test(pair)) throw new Error('Malformed percent escape.');
      if (prohibited(String.fromCharCode(parseInt(pair, 16))))
        throw new Error('Encoded control or directive character is not supported.');
      i += 2;
    }
}

export function robotsText(params: UtilityParams): string {
  const groups = rowsParam(params, 'groupsJson', ['userAgent', 'rule', 'path']);
  if (!groups.length) throw new Error('Add at least one user-agent rule.');
  const lines: string[] = [];
  const seen = new Set<string>();
  let previous = '';
  for (const row of groups) {
    const agent = rowString(row, 'userAgent', 256),
      rule = rowString(row, 'rule', 8),
      path = rowString(row, 'path');
    if (!/^[A-Za-z0-9_*.-]+$/.test(agent) || !['Allow', 'Disallow'].includes(rule))
      throw new Error('Invalid user agent or robots rule.');
    if (!(path === '' && rule === 'Disallow')) {
      if (
        !/^\/[A-Za-z0-9/._~?&=+*%$-]*$/.test(path) ||
        (path.includes('$') && path.indexOf('$') !== path.length - 1)
      )
        throw new Error('Use a slash-leading supported robots path; $ is only allowed at the end.');
      percentBytes(path, (value) => asciiControl(value, true) || '#:'.includes(value));
    }
    const agentKey = agent.toLowerCase();
    if (agentKey !== previous) {
      if (seen.has(agentKey)) throw new Error('Group each user agent in consecutive rows.');
      if (previous) lines.push('');
      lines.push(`User-agent: ${agent}`);
      seen.add(agentKey);
      previous = agentKey;
    }
    lines.push(`${rule}:${path ? ` ${path}` : ''}`);
  }
  const sitemaps = rowsParam(params, 'sitemapsJson', ['url'], 20);
  if (sitemaps.length) lines.push('');
  for (const row of sitemaps) {
    const text = rowString(row, 'url');
    absoluteUrl(text);
    if (text.includes('#')) throw new Error('Sitemap URLs cannot contain a fragment.');
    lines.push(`Sitemap: ${text}`);
  }
  return lines.join('\n') + '\n';
}

export function chmodResult(params: UtilityParams): UtilityResult {
  let mode: string;
  if (params.mode === 'octal') {
    mode = stringParam(params, 'octal');
    if (!/^[0-7]{4}$/.test(mode)) throw new Error('octal: enter exactly four octal digits.');
  } else {
    const bits = ['owner', 'group', 'other'].map((prefix) =>
      ['Read', 'Write', 'Execute'].reduce(
        (n, key, i) => n + (params[`${prefix}${key}`] ? [4, 2, 1][i]! : 0),
        0,
      ),
    );
    const special = (params.setuid ? 4 : 0) + (params.setgid ? 2 : 0) + (params.sticky ? 1 : 0);
    mode = `${special}${bits.join('')}`;
  }
  const n = parseInt(mode, 8);
  let symbolic = '';
  for (let i = 0; i < 3; i++) {
    const bits = (n >> ((2 - i) * 3)) & 7;
    const special = n & [0o4000, 0o2000, 0o1000][i]!;
    symbolic += `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${special ? (i === 2 ? (bits & 1 ? 't' : 'T') : bits & 1 ? 's' : 'S') : bits & 1 ? 'x' : '-'}`;
  }
  const filename = stringParam(params, 'filename', { maxLength: 1000 });
  assertUnicode(filename);
  if (!filename || asciiControl(filename))
    throw new Error('filename: enter a filename without controls.');
  return {
    octal: mode,
    symbolic,
    command: `chmod ${mode} -- '${filename.replace(/'/g, "'\\''")}'`,
  };
}

export function utmLink(params: UtilityParams): UtilityResult {
  const original = stringParam(params, 'url');
  assertUnicode(original);
  absoluteUrl(original);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  const hashAt = original.indexOf('#');
  const fragment = hashAt < 0 ? '' : original.slice(hashAt);
  const head = hashAt < 0 ? original : original.slice(0, hashAt);
  const queryAt = head.indexOf('?');
  const base = queryAt < 0 ? head : head.slice(0, queryAt);
  const query = queryAt < 0 ? [] : head.slice(queryAt + 1).split('&');
  const kept = query.filter((pair) => {
    let key: string;
    try {
      key = decodeURIComponent(pair.split('=')[0]!.replace(/\+/g, ' '));
    } catch {
      throw new Error('Malformed percent encoding in query key.');
    }
    return !keys.includes(key);
  });
  for (let i = 0; i < keys.length; i++) {
    const value = stringParam(params, ['source', 'medium', 'campaign', 'term', 'content'][i]!, {
      maxLength: 256,
    });
    assertUnicode(value);
    if (i < 3 && !value.trim()) throw new Error(`${keys[i]}: enter a value.`);
    if (value) kept.push(`${keys[i]}=${encodeURIComponent(value)}`);
  }
  return { url: `${base}?${kept.join('&')}${fragment}` };
}

const cspOrder = [
  'default-src',
  'script-src',
  'style-src',
  'img-src',
  'connect-src',
  'font-src',
  'frame-src',
  'form-action',
  'base-uri',
  'object-src',
];
export function cspHeader(params: UtilityParams): string {
  const rows = rowsParam(params, 'directivesJson', ['directive', 'sources'], 10);
  if (!rows.length) throw new Error('Add at least one directive.');
  const values = new Map<string, string>();
  for (const row of rows) {
    const directive = rowString(row, 'directive', 32),
      raw = rowString(row, 'sources');
    if (!cspOrder.includes(directive) || values.has(directive))
      throw new Error('Use a unique supported CSP directive.');
    if (asciiControl(raw) || raw.includes(';'))
      throw new Error('CSP sources cannot contain controls or semicolons.');
    const tokens = raw.trim().split(/ +/);
    const normalized: string[] = [];
    for (const token of tokens) {
      if (token === "'self'" || token === "'none'") {
        normalized.push(token);
        continue;
      }
      if (['data:', 'blob:'].includes(token) && ['img-src', 'font-src'].includes(directive)) {
        normalized.push(token);
        continue;
      }
      if (!/^https:\/\/[^\s/:?#\\@*%]+(?::[0-9]+)?\/?$/i.test(token))
        throw new Error('CSP sources must be HTTPS origins without paths, queries or fragments.');
      const url = absoluteUrl(token);
      if (
        url.protocol !== 'https:' ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        token.includes('*')
      )
        throw new Error('Use HTTPS origins, self or none; data/blob only for images and fonts.');
      if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/i.test(url.hostname))
        throw new Error(
          'CSP host sources support DNS names and IPv4; IPv6 and underscores are unsupported.',
        );
      normalized.push(url.origin);
    }
    if (tokens.includes("'none'") && tokens.length !== 1)
      throw new Error('none cannot be combined with other sources.');
    values.set(directive, normalized.join(' '));
  }
  return `${params.reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy'}: ${cspOrder
    .filter((key) => values.has(key))
    .map((key) => `${key} ${values.get(key)}`)
    .join('; ')}`;
}

export function hreflangTags(params: UtilityParams): string {
  const rows = rowsParam(params, 'linksJson', ['language', 'url']);
  if (!rows.length) throw new Error('Add at least one language URL.');
  const seen = new Set<string>();
  return rows
    .map((row) => {
      const raw = rowString(row, 'language', 100),
        url = rowString(row, 'url');
      absoluteUrl(url);
      let language: string;
      try {
        language =
          raw.toLowerCase() === 'x-default'
            ? 'x-default'
            : Intl.getCanonicalLocales(raw.replace(/_/g, '-'))[0]!;
      } catch {
        throw new Error('Invalid language-tag syntax.');
      }
      if (!language || seen.has(language.toLowerCase()))
        throw new Error('Use unique canonical language tags.');
      seen.add(language.toLowerCase());
      return `<link rel="alternate" hreflang="${escapeHtml(language)}" href="${escapeHtml(url)}">\n`;
    })
    .join('');
}

export function nginxRedirects(params: UtilityParams): string {
  const rows = rowsParam(params, 'redirectsJson', ['source', 'destination', 'status']);
  if (!rows.length) throw new Error('Add at least one redirect.');
  const seen = new Set<string>();
  return rows
    .map((row) => {
      const source = rowString(row, 'source'),
        destination = rowString(row, 'destination');
      const forbidden = (value: string) => asciiControl(value, true) || /[#$ {};\\"']/.test(value);
      if (
        !/^\/[A-Za-z0-9._~/-]*$/.test(source) ||
        source.includes('//') ||
        source.split('/').some((segment) => segment === '.' || segment === '..')
      )
        throw new Error(
          'Source must be a normalized slash-leading path without percent escapes, repeated slashes or dot segments.',
        );
      if (
        forbidden(destination) ||
        destination.startsWith('//') ||
        !/^[A-Za-z0-9._~/%?&=:+,-]+$/.test(destination)
      )
        throw new Error('Unsupported redirect destination characters.');
      if (!destination.startsWith('/')) absoluteUrl(destination);
      percentBytes(destination, forbidden);
      const key = source;
      if (seen.has(key)) throw new Error('Duplicate source path.');
      seen.add(key);
      const status = numberParam(row, 'status', { integer: true });
      if (![301, 302, 307, 308].includes(status))
        throw new Error('Use status 301, 302, 307 or 308.');
      return `location = ${source} { return ${status} "${destination}"; }\n`;
    })
    .join('');
}

interface Decimal {
  coefficient: bigint;
  scale: bigint;
}
export function decimalParts(text: string): Decimal {
  if (!/^(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(text) || text.length > 32)
    throw new Error('Use a nonnegative decimal with at most six fractional digits.');
  const [whole = '', fraction = ''] = text.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const coefficient = BigInt((whole || '0') + fraction);
  if (coefficient > 1000000000000n * scale) throw new Error('Decimal must be at most 1e12.');
  return { coefficient, scale };
}
function rationalDecimal(
  numerator: bigint,
  denominator: bigint,
): { value: string; approximation: boolean } {
  const scaled = numerator * 1000000n;
  let rounded = scaled / denominator;
  const remainder = scaled % denominator;
  if (remainder * 2n >= denominator) rounded++;
  const digits = rounded.toString().padStart(7, '0');
  const value = `${digits.slice(0, -6)}.${digits.slice(-6)}`.replace(/\.?0+$/, '') || '0';
  return { value, approximation: remainder !== 0n };
}
export function pxRem(params: UtilityParams): UtilityResult {
  const value = decimalParts(stringParam(params, 'value'));
  const root = decimalParts(stringParam(params, 'rootPx'));
  if (!root.coefficient) throw new Error('rootPx: enter a positive root font size.');
  const toRem = params.mode === 'px-to-rem';
  const result = toRem
    ? rationalDecimal(value.coefficient * root.scale, value.scale * root.coefficient)
    : rationalDecimal(value.coefficient * root.coefficient, value.scale * root.scale);
  return { ...result, unit: toRem ? 'rem' : 'px', rootPx: stringParam(params, 'rootPx') };
}

export async function cssGradient(params: UtilityParams): Promise<UtilityResult> {
  const { parse, converter } = await import('culori');
  const rgb = converter('rgb');
  const color = (key: string) => {
    const parsed = parse(stringParam(params, key));
    if (!parsed) throw new Error(`${key}: enter a supported CSS color.`);
    const value = rgb(parsed);
    if (!value) throw new Error(`${key}: use a finite color inside the RGB gamut.`);
    const channel = (number: unknown, tolerance = 0): number => {
      if (
        typeof number !== 'number' ||
        !Number.isFinite(number) ||
        number < -tolerance ||
        number > 1 + tolerance
      )
        throw new Error(`${key}: use a finite color inside the RGB gamut.`);
      return Math.min(1, Math.max(0, number));
    };
    const channels = [channel(value.r, 1e-7), channel(value.g, 1e-7), channel(value.b, 1e-7)];
    const alpha = channel(value.alpha ?? 1);
    return `rgba(${channels.map((n) => Math.floor(n * 255 + 0.5)).join(', ')}, ${Number(alpha.toFixed(6))})`;
  };
  const angle = numberParam(params, 'angle', { min: 0, max: 360 });
  const stop1 = numberParam(params, 'stop1', { min: 0, max: 100 }),
    stop2 = numberParam(params, 'stop2', { min: 0, max: 100 });
  if (stop1 > stop2) throw new Error('First stop cannot be after the second stop.');
  return {
    css: `linear-gradient(${angle}deg, ${color('color1')} ${stop1}%, ${color('color2')} ${stop2}%)`,
  };
}

const currencyVisible = { field: 'mode', equals: 'currency' } as const;
const numberWords = createUtility(
  definition(
    'number-to-words-converter',
    'Number to Words',
    'Write decimals in US English or explicitly named currency units without floating-point rounding.',
    'text',
    {
      numberText: '0',
      mode: 'number',
      currencyLabel: 'USD',
      exponent: 2,
      majorSingular: 'dollar',
      majorPlural: 'dollars',
      minorSingular: 'cent',
      minorPlural: 'cents',
    },
    {
      numberText: string('Decimal', 24),
      mode: choice('Mode', ['number', 'currency']),
      currencyLabel: { ...string('Currency label', 20), showWhen: currencyVisible },
      exponent: { ...bounded('Minor-unit digits', 0, 2, 1), showWhen: currencyVisible },
      ...Object.fromEntries(
        ['majorSingular', 'majorPlural', 'minorSingular', 'minorPlural'].map((key) => [
          key,
          { ...string(key, 60), showWhen: currencyVisible },
        ]),
      ),
    },
    numberToWords,
  ),
);

const flags = Object.fromEntries(
  ['owner', 'group', 'other'].flatMap((prefix) =>
    ['Read', 'Write', 'Execute'].map((action) => [
      `${prefix}${action}`,
      action === 'Read' || (prefix === 'owner' && action === 'Write'),
    ]),
  ),
);
const chmod = createUtility(
  definition(
    'chmod-calculator',
    'Chmod Calculator',
    'Generate octal permissions, symbolic notation and a quoted POSIX command. Review the command before applying it.',
    'dev',
    {
      mode: 'flags',
      octal: '0644',
      filename: 'data.txt',
      ...flags,
      setuid: false,
      setgid: false,
      sticky: false,
    },
    {
      mode: choice('Mode', ['flags', 'octal']),
      octal: { ...string('Four octal digits', 4), showWhen: { field: 'mode', equals: 'octal' } },
      filename: string('Filename', 1000),
      ...Object.fromEntries(
        [...Object.keys(flags), 'setuid', 'setgid', 'sticky'].map((key) => [
          key,
          { ...bool(key), showWhen: { field: 'mode', equals: 'flags' } },
        ]),
      ),
    },
    chmodResult,
  ),
);

export const textDeveloperTools: ToolModule<UtilityParams>[] = [
  numberWords,
  fileTool(
    'remove-duplicate-lines-online',
    'Remove Duplicate Lines',
    'Keep the first matching line with explicit case, whitespace and blank-line settings.',
    'text',
    'text/plain',
    ['text/plain'],
    { trim: false, caseSensitive: true, blankLines: 'keep' },
    {
      trim: bool('Trim each retained line'),
      caseSensitive: bool('Case sensitive'),
      blankLines: choice('Blank lines', ['keep', 'remove']),
    },
    removeDuplicateLines,
  ),
  fileTool(
    'markdown-table-generator',
    'Markdown Table Generator',
    'Convert quoted delimited text into an escaped Markdown table. Select a delimiter for ragged data.',
    'text',
    'text/markdown',
    ['text/plain', 'text/csv', 'text/tab-separated-values'],
    { delimiter: 'comma', hasHeader: true },
    {
      delimiter: choice('Input delimiter', ['comma', 'tab', 'semicolon', 'pipe', 'auto']),
      hasHeader: bool('First row is a header'),
    },
    markdownTable,
  ),
  fileTool(
    'bulk-meta-description-generator',
    'Bulk Meta Description Generator',
    'Fill a description template from title, topic and URL columns. Expanded text is limited to 1 MiB per row and 20 MiB total. CSV preserves literal cells; spreadsheets may interpret formulas.',
    'text',
    'text/csv',
    ['text/plain', 'text/csv', 'text/tab-separated-values'],
    { delimiter: 'comma', template: '{title}: {topic}', maxGraphemes: 160 },
    {
      delimiter: choice('Input delimiter', ['comma', 'tab']),
      template: string('Template'),
      maxGraphemes: bounded('Maximum graphemes', 1, 500, 1),
    },
    bulkMetaDescriptions,
  ),
  fileTool(
    'javascript-minifier',
    'JavaScript Minifier',
    'Minify JavaScript with Terser while preserving identifiers and disabling code compression. Input is never executed.',
    'dev',
    'text/javascript',
    ['text/plain', 'text/javascript', 'application/javascript'],
    { module: false },
    { module: bool('ES module') },
    async (text, params, ctx) => {
      abort(ctx);
      const { minify } = await import('terser');
      const result = await minify(text, {
        module: params.module === true,
        compress: false,
        mangle: false,
        keep_fnames: true,
        keep_classnames: true,
        format: { comments: false },
      });
      abort(ctx);
      return result.code ?? '';
    },
  ),
  generator(
    'robots-txt-generator',
    'Robots.txt Generator',
    'Create user-agent rules and sitemap lines. Robots.txt is crawler guidance, not access control.',
    'text/plain',
    { groupsJson: '[{"userAgent":"*","rule":"Disallow","path":""}]', sitemapsJson: '[]' },
    { groupsJson: string('User-agent rules'), sitemapsJson: string('Sitemap URLs') },
    robotsText,
  ),
  chmod,
  createUtility(
    definition(
      'utm-link-builder',
      'UTM Link Builder',
      'Add campaign parameters while preserving unrelated query bytes and fragments. No URL is fetched.',
      'dev',
      { url: 'https://example.com/', source: '', medium: '', campaign: '', term: '', content: '' },
      {
        url: string('URL'),
        source: string('Source', 256),
        medium: string('Medium', 256),
        campaign: string('Campaign', 256),
        term: string('Term', 256),
        content: string('Content', 256),
      },
      utmLink,
    ),
  ),
  generator(
    'csp-header-generator',
    'CSP Header Generator',
    'Build a bounded Content Security Policy from explicit directives. Test compatibility before applying it.',
    'text/plain',
    {
      directivesJson:
        '[{"directive":"default-src","sources":"\u0027self\u0027"},{"directive":"object-src","sources":"\u0027none\u0027"},{"directive":"base-uri","sources":"\u0027self\u0027"}]',
      reportOnly: false,
    },
    { directivesJson: string('Directives and sources'), reportOnly: bool('Report-only header') },
    cspHeader,
  ),
  generator(
    'hreflang-tag-generator',
    'Hreflang Tag Generator',
    'Generate escaped alternate-language tags from explicit URLs. Language tags are checked for syntax, not recognized-region status.',
    'text/html',
    { linksJson: '[{"language":"en","url":"https://example.com/"}]' },
    { linksJson: string('Language and URL rows') },
    hreflangTags,
  ),
  generator(
    'nginx-redirect-generator',
    'Nginx Redirect Generator',
    'Generate exact-path Nginx redirects from normalized ASCII paths without percent escapes, repeated slashes or dot segments. Review and test before deployment.',
    'text/plain',
    { redirectsJson: '[{"source":"/old","destination":"/new","status":301}]' },
    { redirectsJson: string('Redirect rows') },
    nginxRedirects,
  ),
  createUtility(
    definition(
      'css-gradient-generator',
      'CSS Gradient Generator',
      'Create a two-color linear gradient with explicit angle, stops and alpha. Out-of-gamut colors are reported.',
      'design',
      { color1: '#ff0000', color2: '#0000ff', angle: 90, stop1: 0, stop2: 100 },
      {
        color1: string('First color', 256),
        color2: string('Second color', 256),
        angle: bounded('Angle (degrees)', 0, 360),
        stop1: bounded('First stop (%)', 0, 100),
        stop2: bounded('Second stop (%)', 0, 100),
      },
      cssGradient,
    ),
  ),
  createUtility(
    definition(
      'px-to-rem-converter',
      'PX to REM Converter',
      'Convert decimal pixel and rem values using an explicit root font size. Results round to six fractional digits.',
      'design',
      { mode: 'px-to-rem', value: '16', rootPx: '16' },
      {
        mode: choice('Conversion', ['px-to-rem', 'rem-to-px']),
        value: string('Value', 32),
        rootPx: string('Root font size (px)', 32),
      },
      pxRem,
    ),
  ),
];
