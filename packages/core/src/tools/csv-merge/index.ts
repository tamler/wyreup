import type { ToolModule, ToolRunContext } from '../../types.js';

export type CsvMergeJoin = 'inner' | 'left' | 'right' | 'outer';

export interface CsvMergeParams {
  /** Key column name (with header) or 0-based index (without). */
  keyColumn?: string;
  hasHeader?: boolean;
  join?: CsvMergeJoin;
  /** Field separator. Blank → auto-detect from the left file. */
  delimiter?: string;
  /** Suffix appended to right-side columns that collide with left-side names. */
  rightSuffix?: string;
}

export const defaultCsvMergeParams: CsvMergeParams = {
  keyColumn: '',
  hasHeader: true,
  join: 'inner',
  delimiter: '',
  rightSuffix: '_r',
};

export interface CsvMergeResult {
  join: CsvMergeJoin;
  keyColumn: string;
  leftRows: number;
  rightRows: number;
  outputRows: number;
  matched: number;
  leftOnly: number;
  rightOnly: number;
}

function asIndex(token: string, header: string[] | null): number {
  if (header) {
    const idx = header.findIndex((h) => h === token);
    if (idx >= 0) return idx;
  }
  const n = Number.parseInt(token, 10);
  if (Number.isInteger(n) && n >= 0) return n;
  if (header) throw new Error(`Key column "${token}" not in header.`);
  throw new Error(`Without a header, the key column must be a 0-based index (got "${token}").`);
}

export const csvMerge: ToolModule<CsvMergeParams> = {
  id: 'csv-merge',
  slug: 'csv-merge',
  name: 'CSV Merge',
  description:
    'Join two CSVs on a key column. Inner, left, right, or outer join — colliding column names get a configurable suffix on the right side.',
  category: 'edit',
  keywords: ['csv', 'merge', 'join', 'inner', 'outer', 'left', 'combine'],

  input: {
    accept: ['text/csv', 'text/plain'],
    min: 2,
    max: 2,
    sizeLimit: 100 * 1024 * 1024,
  },
  output: {
    mime: 'text/csv',
    multiple: true,
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultCsvMergeParams,

  paramSchema: {
    keyColumn: {
      type: 'string',
      label: 'key column',
      help: 'Column name (with header) or 0-based index (without) — must exist in both files.',
      placeholder: 'id',
    },
    hasHeader: {
      type: 'boolean',
      label: 'first row is header',
    },
    join: {
      type: 'enum',
      label: 'join',
      options: [
        { value: 'inner', label: 'inner — only matching keys' },
        { value: 'left', label: 'left — keep all from file 1' },
        { value: 'right', label: 'right — keep all from file 2' },
        { value: 'outer', label: 'outer — keep everything' },
      ],
    },
    delimiter: {
      type: 'string',
      label: 'delimiter',
      help: 'Blank = auto-detect from file 1.',
      placeholder: ',',
    },
    rightSuffix: {
      type: 'string',
      label: 'right-side suffix',
      help: 'Appended to right-side column names that collide with left-side names (e.g. "_r").',
      placeholder: '_r',
    },
  },

  async run(inputs: File[], params: CsvMergeParams, ctx: ToolRunContext): Promise<Blob[]> {
    if (inputs.length !== 2) throw new Error('csv-merge requires exactly two CSV files.');
    ctx.onProgress({ stage: 'loading-deps', percent: 10, message: 'Loading CSV parser' });
    const Papa = (await import('papaparse')).default;
    if (ctx.signal.aborted) throw new Error('Aborted');

    const hasHeader = params.hasHeader ?? true;
    const join = params.join ?? 'inner';
    const delimiterOverride = params.delimiter && params.delimiter.length > 0 ? params.delimiter : undefined;
    const rightSuffix = params.rightSuffix ?? '_r';
    const keyToken = (params.keyColumn ?? '').trim();
    if (!keyToken) throw new Error('csv-merge requires a key column.');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing CSVs' });
    const leftText = await inputs[0]!.text();
    const rightText = await inputs[1]!.text();
    const leftParsed = Papa.parse<string[]>(leftText, { header: false, delimiter: delimiterOverride, skipEmptyLines: true });
    const rightParsed = Papa.parse<string[]>(rightText, { header: false, delimiter: delimiterOverride ?? leftParsed.meta.delimiter, skipEmptyLines: true });
    const leftRows = leftParsed.data;
    const rightRows = rightParsed.data;
    if (leftRows.length === 0 || rightRows.length === 0) {
      throw new Error('Both CSV files must contain at least one row.');
    }

    let leftHeader: string[] | null = null;
    let rightHeader: string[] | null = null;
    let leftData: string[][];
    let rightData: string[][];
    if (hasHeader) {
      leftHeader = leftRows[0]!;
      leftData = leftRows.slice(1);
      rightHeader = rightRows[0]!;
      rightData = rightRows.slice(1);
    } else {
      leftData = leftRows;
      rightData = rightRows;
    }

    const leftKeyIdx = asIndex(keyToken, leftHeader);
    const rightKeyIdx = asIndex(keyToken, rightHeader);

    // Build right-side index by key value.
    ctx.onProgress({ stage: 'processing', percent: 60, message: 'Joining' });
    const rightIndex = new Map<string, string[][]>();
    for (const row of rightData) {
      const k = row[rightKeyIdx] ?? '';
      const list = rightIndex.get(k) ?? [];
      list.push(row);
      rightIndex.set(k, list);
    }

    const rightColumns = rightHeader ? rightHeader.length : (rightData[0]?.length ?? 0);
    const leftColumns = leftHeader ? leftHeader.length : (leftData[0]?.length ?? 0);

    // Build merged header. Drop right-side key column (it duplicates the
    // left-side key by definition). Append rightSuffix to right-side
    // column names that collide with the left.
    let mergedHeader: string[] | null = null;
    if (leftHeader && rightHeader) {
      const leftSet = new Set(leftHeader);
      const remappedRight = rightHeader
        .map((h, i) => (i === rightKeyIdx ? null : leftSet.has(h) ? `${h}${rightSuffix}` : h))
        .filter((h): h is string => h !== null);
      mergedHeader = [...leftHeader, ...remappedRight];
    }

    function joinRow(left: string[] | null, right: string[] | null): string[] {
      const leftPart = left ?? Array.from({ length: leftColumns }, () => '');
      const rightPart = right
        ? right.filter((_, i) => i !== rightKeyIdx)
        : Array.from({ length: Math.max(0, rightColumns - 1) }, () => '');
      return [...leftPart, ...rightPart];
    }

    const matchedRightKeys = new Set<string>();
    const merged: string[][] = [];
    let matched = 0;
    let leftOnly = 0;

    for (const lrow of leftData) {
      const k = lrow[leftKeyIdx] ?? '';
      const matches = rightIndex.get(k);
      if (matches && matches.length > 0) {
        matched += matches.length;
        matchedRightKeys.add(k);
        for (const rrow of matches) merged.push(joinRow(lrow, rrow));
      } else if (join === 'left' || join === 'outer') {
        leftOnly++;
        merged.push(joinRow(lrow, null));
      }
    }

    let rightOnly = 0;
    if (join === 'right' || join === 'outer') {
      for (const [k, rows] of rightIndex) {
        if (matchedRightKeys.has(k)) continue;
        for (const rrow of rows) {
          rightOnly++;
          merged.push(joinRow(null, rrow));
          // Place the key into the left-key slot so users can still join on it.
          merged[merged.length - 1]![leftKeyIdx] = k;
        }
      }
    }

    ctx.onProgress({ stage: 'processing', percent: 90, message: 'Writing CSV' });
    const outRows = mergedHeader ? [mergedHeader, ...merged] : merged;
    const outputCsv = Papa.unparse(outRows, { delimiter: leftParsed.meta.delimiter });

    const stats: CsvMergeResult = {
      join,
      keyColumn: leftHeader ? leftHeader[leftKeyIdx]! : String(leftKeyIdx),
      leftRows: leftData.length,
      rightRows: rightData.length,
      outputRows: merged.length,
      matched,
      leftOnly,
      rightOnly,
    };

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [
      new Blob([outputCsv], { type: 'text/csv' }),
      new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' }),
    ];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['text/csv', 'application/json'],
  },
};
