import type { ToolModule, ToolRunContext } from '../../types.js';
import { defaultEpubToTextParams } from './types.js';
import type { EpubToTextParams } from './types.js';

export type { EpubToTextParams } from './types.js';
export { defaultEpubToTextParams } from './types.js';

type XmlRecord = Record<string, unknown>;

export const epubToText: ToolModule<EpubToTextParams> = {
  id: 'epub-to-text',
  slug: 'epub-to-text',
  name: 'EPUB to Text',
  description:
    'Extract readable plain text from an EPUB ebook in spine order. Includes optional title and author metadata, but does not preserve page layout or styling.',
  llmDescription:
    'Extract readable plain text from one EPUB file in its declared spine order. This is text extraction only: it can include Title and Author lines, but it does not preserve ebook layout or styling.',
  category: 'convert',
  categories: ['convert', 'text'],
  keywords: ['epub', 'ebook', 'convert', 'text', 'extract', 'book', 'xhtml', 'spine'],

  input: {
    accept: ['application/epub+zip'],
    min: 1,
    max: 1,
    sizeLimit: 200 * 1024 * 1024,
  },
  output: { mime: 'text/plain' },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',
  outputDisplay: 'prose',

  defaults: defaultEpubToTextParams,
  paramSchema: {
    includeMetadata: {
      type: 'boolean',
      label: 'include metadata',
      help: 'Prefix the extracted text with the EPUB title and author, when available.',
    },
  },

  async run(inputs: File[], params: EpubToTextParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('epub-to-text accepts exactly one file.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'loading-deps', percent: 5, message: 'Loading EPUB parser' });
    const [{ default: JSZip }, { XMLParser }] = await Promise.all([
      import('jszip'),
      import('fast-xml-parser'),
    ]);
    if (ctx.signal.aborted) throw new Error('Aborted');

    const bytes = await inputs[0]!.arrayBuffer();
    let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      throw new Error('Could not read EPUB: the file is not a valid ZIP archive.');
    }
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Reading EPUB structure' });
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      parseAttributeValue: false,
      parseTagValue: false,
      trimValues: true,
    });

    const containerEntry = zip.file('META-INF/container.xml');
    if (!containerEntry) throw new Error('Could not read EPUB: META-INF/container.xml is missing.');
    const container = asRecord(parser.parse(await containerEntry.async('string')));
    const rootfiles = child(child(container, 'container'), 'rootfiles');
    const rootfile = asArray(child(rootfiles, 'rootfile'))[0];
    const opfPath = attribute(rootfile, 'full-path');
    if (!opfPath) throw new Error('Could not read EPUB: the OPF package path is missing.');

    const opfEntry = zip.file(normalizeZipPath('', opfPath));
    if (!opfEntry) throw new Error(`Could not read EPUB: package file "${opfPath}" is missing.`);
    const packageDocument = asRecord(parser.parse(await opfEntry.async('string')));
    const packageNode = child(packageDocument, 'package');
    if (!packageNode) throw new Error('Could not read EPUB: the OPF package is invalid.');

    const metadata = child(packageNode, 'metadata');
    const title = textValues(child(metadata, 'title')).join(', ');
    const creators = textValues(child(metadata, 'creator'));

    const manifestItems = asArray(child(child(packageNode, 'manifest'), 'item'));
    const manifest = new Map<string, string>();
    for (const item of manifestItems) {
      const id = attribute(item, 'id');
      const href = attribute(item, 'href');
      if (id && href) manifest.set(id, href);
    }

    const spineItems = asArray(child(child(packageNode, 'spine'), 'itemref'));
    if (spineItems.length === 0)
      throw new Error('Could not read EPUB: the reading order is empty.');

    const chapters: string[] = [];
    for (let index = 0; index < spineItems.length; index++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      const idref = attribute(spineItems[index], 'idref');
      const href = idref ? manifest.get(idref) : undefined;
      if (!href) continue;

      const chapterPath = normalizeZipPath(opfPath, href);
      const chapterEntry = zip.file(chapterPath);
      if (!chapterEntry) continue;

      ctx.onProgress({
        stage: 'processing',
        percent: 30 + Math.floor(((index + 1) / spineItems.length) * 60),
        message: `Extracting section ${index + 1}/${spineItems.length}`,
      });
      const chapterText = xhtmlToText(await chapterEntry.async('string'));
      if (chapterText) chapters.push(chapterText);
    }

    if (chapters.length === 0) {
      throw new Error('Could not read EPUB: no readable spine content was found.');
    }

    const sections: string[] = [];
    if (params.includeMetadata !== false) {
      const metadataLines: string[] = [];
      if (title) metadataLines.push(`Title: ${title}`);
      if (creators.length > 0) metadataLines.push(`Author: ${creators.join(', ')}`);
      if (metadataLines.length > 0) sections.push(metadataLines.join('\n'));
    }
    sections.push(chapters.join('\n\n'));

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return new Blob([sections.join('\n\n')], { type: 'text/plain' });
  },

  __testFixtures: {
    valid: ['book.epub'],
    weird: [],
    expectedOutputMime: ['text/plain'],
  },
};

function asRecord(value: unknown): XmlRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as XmlRecord)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function child(value: unknown, localName: string): unknown {
  const record = asRecord(value);
  if (!record) return undefined;
  const entry = Object.entries(record).find(([name]) => name.split(':').at(-1) === localName);
  return entry?.[1];
}

function attribute(value: unknown, name: string): string | undefined {
  const raw = asRecord(value)?.[`@_${name}`];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : undefined;
}

function textValues(value: unknown): string[] {
  return asArray(value)
    .flatMap((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') return [String(entry).trim()];
      const text = asRecord(entry)?.['#text'];
      return typeof text === 'string' || typeof text === 'number' ? [String(text).trim()] : [];
    })
    .filter(Boolean);
}

function normalizeZipPath(baseFile: string, href: string): string {
  const hrefWithoutSuffix = href.split(/[?#]/, 1)[0]!.replace(/\\/g, '/');
  let decodedHref = hrefWithoutSuffix;
  try {
    decodedHref = decodeURIComponent(hrefWithoutSuffix);
  } catch {
    // Keep malformed percent escapes literal so the missing-entry error is deterministic.
  }

  const baseParts = baseFile.includes('/') ? baseFile.split('/').slice(0, -1) : [];
  const parts = decodedHref.startsWith('/') ? [] : baseParts;
  for (const part of decodedHref.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join('/');
}

function xhtmlToText(xhtml: string): string {
  const allText: string[] = [];
  const bodyText: string[] = [];
  const hiddenTags: string[] = [];
  let foundBody = false;
  let inBody = false;
  let cursor = 0;

  const append = (value: string): void => {
    if (hiddenTags.length > 0) return;
    allText.push(value);
    if (inBody) bodyText.push(value);
  };

  while (cursor < xhtml.length) {
    if (xhtml.startsWith('<!--', cursor)) {
      const commentEnd = xhtml.indexOf('-->', cursor + 4);
      cursor = commentEnd === -1 ? xhtml.length : commentEnd + 3;
      continue;
    }

    if (xhtml[cursor] !== '<') {
      const nextTag = xhtml.indexOf('<', cursor);
      const end = nextTag === -1 ? xhtml.length : nextTag;
      append(decodeBasicEntities(xhtml.slice(cursor, end)));
      cursor = end;
      continue;
    }

    const tagEnd = findTagEnd(xhtml, cursor + 1);
    if (tagEnd === -1) {
      append(decodeBasicEntities(xhtml.slice(cursor)));
      break;
    }

    const rawTag = xhtml.slice(cursor + 1, tagEnd).trim();
    const closing = rawTag.startsWith('/');
    const selfClosing = rawTag.endsWith('/');
    const nameStart = closing ? 1 : 0;
    let nameEnd = nameStart;
    while (nameEnd < rawTag.length && /[A-Za-z0-9:_-]/.test(rawTag[nameEnd]!)) nameEnd++;
    const tagName = rawTag.slice(nameStart, nameEnd).split(':').at(-1)?.toLowerCase() ?? '';

    if (tagName === 'body') {
      foundBody = true;
      inBody = !closing;
    } else if (closing && hiddenTags.at(-1) === tagName) {
      hiddenTags.pop();
    } else if (!closing && !selfClosing && ['head', 'script', 'style'].includes(tagName)) {
      hiddenTags.push(tagName);
    } else if (hiddenTags.length === 0 && tagName === 'br') {
      append('\n');
    } else if (
      hiddenTags.length === 0 &&
      [
        'address',
        'article',
        'aside',
        'blockquote',
        'div',
        'footer',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'header',
        'hr',
        'li',
        'main',
        'nav',
        'p',
        'pre',
        'section',
        'table',
        'tr',
      ].includes(tagName)
    ) {
      append('\n');
    }

    cursor = tagEnd + 1;
  }

  return normalizeText((foundBody ? bodyText : allText).join(''));
}

function findTagEnd(text: string, start: number): number {
  let quote = '';
  for (let index = start; index < text.length; index++) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  return -1;
}

function decodeBasicEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  let output = '';
  let cursor = 0;
  while (cursor < text.length) {
    if (text[cursor] !== '&') {
      output += text[cursor]!;
      cursor++;
      continue;
    }

    let semicolon = -1;
    const entityLimit = Math.min(text.length, cursor + 13);
    for (let index = cursor + 1; index < entityLimit; index++) {
      if (text[index] === ';') {
        semicolon = index;
        break;
      }
    }
    if (semicolon === -1) {
      output += '&';
      cursor++;
      continue;
    }

    const entity = text.slice(cursor + 1, semicolon);
    let decoded = named[entity.toLowerCase()];
    if (decoded === undefined && /^#\d+$/.test(entity)) {
      decoded = decodeCodePoint(Number(entity.slice(1)));
    } else if (decoded === undefined && /^#x[\da-f]+$/i.test(entity)) {
      decoded = decodeCodePoint(Number.parseInt(entity.slice(2), 16));
    }

    if (decoded === undefined) {
      output += text.slice(cursor, semicolon + 1);
    } else {
      output += decoded;
    }
    cursor = semicolon + 1;
  }
  return output;
}

function decodeCodePoint(value: number): string | undefined {
  if (!Number.isInteger(value) || value <= 0 || value > 0x10ffff) return undefined;
  if (value >= 0xd800 && value <= 0xdfff) return undefined;
  return String.fromCodePoint(value);
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
