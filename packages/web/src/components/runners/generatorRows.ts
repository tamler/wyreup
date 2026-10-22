import {
  cloneUtilityJson,
  assertUnicode,
  cspHeader,
  hreflangTags,
  nginxRedirects,
  parseTextRows,
  robotsText,
} from '@wyreup/core/execution';

export interface GeneratorColumn {
  key: string;
  label: string;
  maxLength: number;
  options?: readonly string[];
  numeric?: boolean;
}
export interface GeneratorRowContract {
  toolId: string;
  key: string;
  label: string;
  maxRows: number;
  columns: readonly GeneratorColumn[];
}
export type GeneratorRow = Record<string, string | number | null>;
export const GENERATOR_INPUT_BYTES = 100000;
export const GENERATOR_PAGE_SIZE = 20;
const column = (key: string, label: string, maxLength = 2048): GeneratorColumn => ({
  key,
  label,
  maxLength,
});
const contracts: readonly GeneratorRowContract[] = [
  {
    toolId: 'robots-txt-generator',
    key: 'groupsJson',
    label: 'User-agent rules',
    maxRows: 1000,
    columns: [
      column('userAgent', 'User agent', 256),
      { ...column('rule', 'Rule', 8), options: ['Allow', 'Disallow'] },
      column('path', 'Path (empty only for Disallow)'),
    ],
  },
  {
    toolId: 'robots-txt-generator',
    key: 'sitemapsJson',
    label: 'Sitemap URLs',
    maxRows: 20,
    columns: [column('url', 'Sitemap URL')],
  },
  {
    toolId: 'csp-header-generator',
    key: 'directivesJson',
    label: 'Directives and sources',
    maxRows: 10,
    columns: [
      {
        ...column('directive', 'Directive', 32),
        options: [
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
        ],
      },
      column('sources', 'Sources (space-separated tokens)'),
    ],
  },
  {
    toolId: 'hreflang-tag-generator',
    key: 'linksJson',
    label: 'Language and URL rows',
    maxRows: 1000,
    columns: [column('language', 'Language tag', 100), column('url', 'Alternate URL')],
  },
  {
    toolId: 'nginx-redirect-generator',
    key: 'redirectsJson',
    label: 'Redirect rows',
    maxRows: 1000,
    columns: [
      column('source', 'Exact source path'),
      column('destination', 'Destination'),
      {
        ...column('status', 'HTTP status', 3),
        numeric: true,
        options: ['301', '302', '307', '308'],
      },
    ],
  },
];

export function generatorRowContracts(toolId: string): readonly GeneratorRowContract[] {
  const matches = contracts.filter((value) => value.toolId === toolId);
  if (!matches.length) throw new Error('Unsupported generator interface.');
  return matches;
}

function budget(text: string): void {
  assertUnicode(text);
  if (
    text.length > GENERATOR_INPUT_BYTES ||
    new TextEncoder().encode(text).length > GENERATOR_INPUT_BYTES
  )
    throw new Error('Row input exceeds 100,000 UTF8 bytes.');
}

export function validateGeneratorRows(
  value: unknown,
  contract: GeneratorRowContract,
): GeneratorRow[] {
  const cloned = cloneUtilityJson(value);
  if (!Array.isArray(cloned) || cloned.length > contract.maxRows)
    throw new Error(`${contract.label}: use at most ${contract.maxRows} rows.`);
  const rows = cloned.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw new Error(`Row ${index + 1}: expected an object.`);
    const keys = Object.keys(row);
    if (
      keys.length !== contract.columns.length ||
      contract.columns.some(({ key }) => !Object.hasOwn(row, key))
    )
      throw new Error(
        `Row ${index + 1}: expected only ${contract.columns.map(({ key }) => key).join(', ')}.`,
      );
    const result: GeneratorRow = Object.create(null) as GeneratorRow;
    for (const field of contract.columns) {
      const cell = row[field.key];
      if (field.numeric) {
        if (
          typeof cell !== 'number' ||
          !Number.isInteger(cell) ||
          !field.options?.includes(String(cell))
        )
          throw new Error(`Row ${index + 1}, ${field.label}: choose 301, 302, 307 or 308.`);
      } else {
        if (typeof cell !== 'string' || cell.length > field.maxLength)
          throw new Error(
            `Row ${index + 1}, ${field.label}: enter at most ${field.maxLength} characters.`,
          );
        assertUnicode(cell);
        if (field.options && !field.options.includes(cell))
          throw new Error(`Row ${index + 1}, ${field.label}: choose a supported value.`);
      }
      result[field.key] = cell;
    }
    return result;
  });
  budget(JSON.stringify(rows));
  return rows;
}

export function encodeGeneratorRows(value: unknown, contract: GeneratorRowContract): string {
  const encoded = JSON.stringify(validateGeneratorRows(value, contract));
  // Semantic validation is performed by the actual core generator, including
  // cross-row duplicates and directive/path rules. No generator is duplicated.
  if (contract.toolId === 'robots-txt-generator')
    robotsText({
      groupsJson: '[{"userAgent":"*","rule":"Disallow","path":""}]',
      sitemapsJson: '[]',
      [contract.key]: encoded,
    });
  else if (contract.toolId === 'csp-header-generator')
    cspHeader({ directivesJson: encoded, reportOnly: false });
  else if (contract.toolId === 'hreflang-tag-generator') hreflangTags({ linksJson: encoded });
  else if (contract.toolId === 'nginx-redirect-generator')
    nginxRedirects({ redirectsJson: encoded });
  else throw new Error('Unsupported generator interface.');
  return encoded;
}

export function decodeGeneratorRows(text: unknown, contract: GeneratorRowContract): GeneratorRow[] {
  if (typeof text !== 'string') throw new Error('Expected encoded generator rows.');
  budget(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Expected valid encoded rows.');
  }
  const rows = validateGeneratorRows(parsed, contract);
  encodeGeneratorRows(rows, contract);
  return rows;
}

export function importGeneratorRows(
  text: string,
  delimiter: 'comma' | 'tab',
  contract: GeneratorRowContract,
): GeneratorRow[] {
  budget(text);
  const records = parseTextRows(text, delimiter, contract.maxRows + 1, contract.columns.length);
  const headers = records.shift();
  const names = contract.columns.map(({ key }) => key);
  if (
    !headers ||
    headers.length !== names.length ||
    new Set(headers).size !== names.length ||
    headers.some((name) => !names.includes(name))
  )
    throw new Error(`Use exactly these named headers: ${names.join(', ')}.`);
  const rows = records.map((cells, index) => {
    if (cells.length !== names.length)
      throw new Error(`Row ${index + 1}: expected ${names.length} cells.`);
    const row: GeneratorRow = Object.create(null) as GeneratorRow;
    for (const field of contract.columns) {
      const cell = cells[headers.indexOf(field.key)];
      if (field.numeric) {
        if (!field.options?.includes(cell))
          throw new Error(`Row ${index + 1}, ${field.label}: choose 301, 302, 307 or 308.`);
        row[field.key] = Number(cell);
      } else row[field.key] = cell;
    }
    return row;
  });
  encodeGeneratorRows(rows, contract);
  return rows;
}

export function exportGeneratorRows(
  value: unknown,
  delimiter: 'comma' | 'tab',
  contract: GeneratorRowContract,
): string {
  const rows = validateGeneratorRows(value, contract);
  const separator = delimiter === 'comma' ? ',' : '\t';
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return (
    [
      contract.columns.map(({ key }) => key),
      ...rows.map((row) => contract.columns.map(({ key }) => String(row[key]))),
    ]
      .map((cells) => cells.map(quote).join(separator))
      .join('\n') + '\n'
  );
}

export function newGeneratorRow(contract: GeneratorRowContract): GeneratorRow {
  const row: GeneratorRow = Object.create(null) as GeneratorRow;
  for (const field of contract.columns)
    row[field.key] = field.numeric ? Number(field.options![0]) : (field.options?.[0] ?? '');
  return row;
}
