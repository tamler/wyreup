import type { ToolModule, ToolRunContext } from '../../types.js';
import { defaultVcfToCsvParams, type VcfContactRow, type VcfToCsvParams } from './types.js';

export type { VcfContactRow, VcfToCsvFormat, VcfToCsvParams } from './types.js';
export { defaultVcfToCsvParams } from './types.js';

const CSV_COLUMNS: ReadonlyArray<keyof VcfContactRow> = [
  'name',
  'given_name',
  'family_name',
  'org',
  'title',
  'emails',
  'phones',
  'address',
  'birthday',
  'url',
  'note',
];

interface VcfProperty {
  name: string;
  value: string;
}

function unfoldLines(text: string): string[] {
  const physicalLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of physicalLines) {
    if (/^[ \t]/.test(line) && lines.length > 0) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  return lines;
}

function findUnquotedColon(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    if (!quoted && line[index] === ':') return index;
  }
  return -1;
}

function parseProperty(line: string): VcfProperty | null {
  const separator = findUnquotedColon(line);
  if (separator < 1) return null;
  const declaration = line.slice(0, separator);
  const rawName = declaration.split(';', 1)[0] ?? '';
  const name = (rawName.split('.').pop() ?? '').toUpperCase();
  return name ? { name, value: line.slice(separator + 1) } : null;
}

function splitEscaped(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += `\\${character}`;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === separator) {
      parts.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  parts.push(current);
  return parts;
}

function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_match, escaped: string) => {
    if (escaped === 'n' || escaped === 'N') return '\n';
    return escaped;
  });
}

function first(properties: Map<string, string[]>, name: string): string {
  return unescapeText(properties.get(name)?.[0] ?? '');
}

function parseContacts(text: string): VcfContactRow[] {
  const contacts: VcfContactRow[] = [];
  let properties: Map<string, string[]> | null = null;

  for (const line of unfoldLines(text)) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VCARD') {
      if (properties) throw new Error('Invalid vCard: nested BEGIN:VCARD block.');
      properties = new Map();
      continue;
    }
    if (upper === 'END:VCARD') {
      if (!properties) throw new Error('Invalid vCard: END:VCARD without BEGIN:VCARD.');
      const nameParts = splitEscaped(properties.get('N')?.[0] ?? '', ';');
      const familyName = unescapeText(nameParts[0] ?? '');
      const givenName = unescapeText(nameParts[1] ?? '');
      const fullName = first(properties, 'FN') || [givenName, familyName].filter(Boolean).join(' ');
      const address = splitEscaped(properties.get('ADR')?.[0] ?? '', ';')
        .map(unescapeText)
        .filter(Boolean)
        .join(' ');

      contacts.push({
        name: fullName,
        given_name: givenName,
        family_name: familyName,
        org: splitEscaped(properties.get('ORG')?.[0] ?? '', ';')
          .map(unescapeText)
          .filter(Boolean)
          .join(' '),
        title: first(properties, 'TITLE'),
        emails: (properties.get('EMAIL') ?? []).map(unescapeText).join(';'),
        phones: (properties.get('TEL') ?? []).map(unescapeText).join(';'),
        address,
        birthday: first(properties, 'BDAY'),
        url: first(properties, 'URL'),
        note: first(properties, 'NOTE'),
      });
      properties = null;
      continue;
    }
    if (!properties || line === '') continue;
    const property = parseProperty(line);
    if (!property || property.name === 'VERSION') continue;
    const values = properties.get(property.name) ?? [];
    values.push(property.value);
    properties.set(property.name, values);
  }

  if (properties) throw new Error('Invalid vCard: missing END:VCARD.');
  if (contacts.length === 0) throw new Error('Invalid vCard: no complete VCARD blocks found.');
  return contacts;
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function contactsToCsv(contacts: VcfContactRow[]): string {
  const rows = contacts.map((contact) =>
    CSV_COLUMNS.map((column) => escapeCsv(contact[column])).join(','),
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

export const vcfToCsv: ToolModule<VcfToCsvParams> = {
  id: 'vcf-to-csv',
  slug: 'vcf-to-csv',
  name: 'vCard to CSV',
  description:
    'Convert vCard 3.0 and 4.0 contact fields to CSV or JSON. Repeated email addresses and phone numbers are joined with semicolons; unsupported properties are ignored.',
  llmDescription:
    'Convert one or more BEGIN:VCARD blocks into a fixed-column CSV contact table or a JSON array. Handles folded lines, property parameters, common escaped text, structured N and ADR fields, and repeated EMAIL and TEL values. It does not decode quoted-printable or base64 property values.',
  category: 'convert',
  categories: ['convert', 'export'],
  keywords: ['vcf', 'vcard', 'contacts', 'address book', 'csv', 'json', 'email', 'phone', 'export'],

  input: {
    accept: ['text/vcard', 'text/x-vcard', 'text/plain'],
    min: 1,
    max: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'text/csv', multiple: false },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultVcfToCsvParams,

  paramSchema: {
    format: {
      type: 'enum',
      label: 'output format',
      help: 'Choose a CSV table or a JSON array with the same contact fields.',
      options: [
        { value: 'csv', label: 'CSV' },
        { value: 'json', label: 'JSON' },
      ],
    },
  },

  async run(inputs: File[], params: VcfToCsvParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 1) throw new Error('vcf-to-csv accepts exactly one vCard file.');
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 20, message: 'Reading contacts' });
    const contacts = parseContacts(await inputs[0]!.text());
    const format = params.format ?? 'csv';
    if (format !== 'csv' && format !== 'json') {
      throw new Error(`Invalid output format: ${String(format)}.`);
    }
    const output = format === 'json' ? JSON.stringify(contacts, null, 2) : contactsToCsv(contacts);
    const mime = format === 'json' ? 'application/json' : 'text/csv';

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([output], { type: mime })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/csv', 'application/json'],
  },
};
