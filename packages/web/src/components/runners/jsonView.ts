export type Primitive = string | number | boolean | null;

export type FlatEntry = [string, Primitive];
export type PrimitiveArrayEntry = [string, Primitive[]];

export interface FlatJsonView {
  kind: 'flat';
  entries: FlatEntry[];
}

export interface TableJsonView {
  kind: 'table';
  columns: string[];
  rows: Record<string, Primitive>[];
}

export interface PrimitiveSection {
  kind: 'primitive';
  key: string;
  value: Primitive;
}

export interface PrimitiveArraySection {
  kind: 'primitive-array';
  key: string;
  values: Primitive[];
}

export interface FlatSection {
  kind: 'flat';
  key: string;
  entries: FlatEntry[];
}

export interface TableSection {
  kind: 'table';
  key: string;
  table: TableJsonView;
}

export interface GroupSection {
  kind: 'group';
  key: string;
  entries: (FlatEntry | PrimitiveArrayEntry)[];
}

export type JsonSection =
  | PrimitiveSection
  | PrimitiveArraySection
  | FlatSection
  | TableSection
  | GroupSection;

export interface SectionsJsonView {
  kind: 'sections';
  sections: JsonSection[];
}

export type JsonView = FlatJsonView | TableJsonView | SectionsJsonView;

const MAX_FLAT_KEYS = 40;
const MAX_ARRAY_ITEMS = 50;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 8;
const MAX_RENDERED_LEAVES = 300;

const UNIT_LABELS = new Set(['bytes', 'hours', 'milliseconds', 'minutes', 'percent', 'seconds']);

function isPrimitive(value: unknown): value is Primitive {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function objectEntries(value: unknown): [string, unknown][] | null {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return null;
  return Object.entries(value as Record<string, unknown>);
}

function classifyFlat(value: unknown): FlatJsonView | null {
  const entries = objectEntries(value);
  if (!entries || entries.length === 0 || entries.length > MAX_FLAT_KEYS) return null;
  if (!entries.every(([, entry]) => isPrimitive(entry))) return null;
  return { kind: 'flat', entries: entries as FlatEntry[] };
}

function classifyTable(value: unknown): TableJsonView | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_TABLE_ROWS) return null;

  const rows: Record<string, Primitive>[] = [];
  const columns: string[] = [];
  const columnSet = new Set<string>();
  let commonKeys: Set<string> | null = null;

  for (const valueRow of value) {
    const entries = objectEntries(valueRow);
    if (!entries || !entries.every(([, entry]) => isPrimitive(entry))) return null;

    const row = Object.fromEntries(entries) as Record<string, Primitive>;
    const rowKeys = new Set(Object.keys(row));
    const candidateKeys: Set<string> = commonKeys ?? rowKeys;
    commonKeys = new Set([...candidateKeys].filter((key) => rowKeys.has(key)));

    for (const key of rowKeys) {
      if (!columnSet.has(key)) {
        columnSet.add(key);
        columns.push(key);
      }
    }
    if (columns.length > MAX_TABLE_COLUMNS) return null;
    rows.push(row);
  }

  if (!commonKeys || commonKeys.size === 0) return null;
  return { kind: 'table', columns, rows };
}

function classifyGroup(value: unknown): GroupSection['entries'] | null {
  const entries = objectEntries(value);
  if (!entries || entries.length === 0 || entries.length > MAX_FLAT_KEYS) return null;

  const groupEntries: GroupSection['entries'] = [];
  let hasArray = false;
  for (const [key, entry] of entries) {
    if (isPrimitive(entry)) {
      groupEntries.push([key, entry]);
      continue;
    }
    if (
      Array.isArray(entry) &&
      entry.length <= MAX_ARRAY_ITEMS &&
      entry.every((item) => isPrimitive(item))
    ) {
      hasArray = true;
      groupEntries.push([key, entry]);
      continue;
    }
    return null;
  }

  return hasArray ? groupEntries : null;
}

function renderedLeafCount(view: JsonView): number {
  if (view.kind === 'flat') return view.entries.length;
  if (view.kind === 'table') {
    return view.rows.reduce((total, row) => total + Object.keys(row).length, 0);
  }

  return view.sections.reduce((total, section) => {
    if (section.kind === 'primitive') return total + 1;
    if (section.kind === 'primitive-array') return total + section.values.length;
    if (section.kind === 'flat') return total + section.entries.length;
    if (section.kind === 'table') return total + renderedLeafCount(section.table);
    return (
      total +
      section.entries.reduce(
        (groupTotal, [, entry]) => groupTotal + (Array.isArray(entry) ? entry.length : 1),
        0,
      )
    );
  }, 0);
}

function classifySections(value: unknown): SectionsJsonView | null {
  const entries = objectEntries(value);
  if (!entries || entries.length === 0) return null;

  const sections: JsonSection[] = [];
  let hasNestedValue = false;
  for (const [key, entry] of entries) {
    if (isPrimitive(entry)) {
      sections.push({ kind: 'primitive', key, value: entry });
      continue;
    }

    hasNestedValue = true;
    if (
      Array.isArray(entry) &&
      entry.length <= MAX_ARRAY_ITEMS &&
      entry.every((item) => isPrimitive(item))
    ) {
      sections.push({ kind: 'primitive-array', key, values: entry });
      continue;
    }

    const flat = classifyFlat(entry);
    if (flat) {
      sections.push({ kind: 'flat', key, entries: flat.entries });
      continue;
    }

    const table = classifyTable(entry);
    if (table) {
      sections.push({ kind: 'table', key, table });
      continue;
    }

    const group = classifyGroup(entry);
    if (group) {
      sections.push({ kind: 'group', key, entries: group });
      continue;
    }

    return null;
  }

  return hasNestedValue ? { kind: 'sections', sections } : null;
}

export function classifyJsonValue(value: unknown): JsonView | null {
  const view = classifyFlat(value) ?? classifyTable(value) ?? classifySections(value);
  if (!view || renderedLeafCount(view) > MAX_RENDERED_LEAVES) return null;
  return view;
}

export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

  const unit = words.at(-1);
  if (unit && UNIT_LABELS.has(unit) && words.length > 1) {
    const label = words.slice(0, -1).join(' ');
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} (${unit})`;
  }

  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');
}

export function formatValue(value: Primitive): string {
  if (typeof value === 'number') return value.toLocaleString();
  if (value === null) return '—';
  return String(value);
}
