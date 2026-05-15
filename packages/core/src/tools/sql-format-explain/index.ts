import type { ToolModule, ToolRunContext } from '../../types.js';

export interface SqlFormatExplainParams {
  language?: 'sql' | 'postgresql' | 'mysql' | 'sqlite' | 'bigquery';
}

export const defaultSqlFormatExplainParams: SqlFormatExplainParams = {
  language: 'sql',
};

export interface SqlAnnotation {
  clause: string;
  text: string;
  explanation: string;
}

export interface SqlFormatExplainResult {
  formatted: string;
  statementType: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'WITH' | 'OTHER';
  annotations: SqlAnnotation[];
  summary: string;
}

// Top-level clause keywords. Order matters for splitting — longer phrases first.
const CLAUSE_KEYWORDS = [
  'WITH',
  'SELECT',
  'INSERT INTO',
  'UPDATE',
  'DELETE FROM',
  'FROM',
  'INNER JOIN',
  'LEFT OUTER JOIN',
  'LEFT JOIN',
  'RIGHT OUTER JOIN',
  'RIGHT JOIN',
  'FULL OUTER JOIN',
  'FULL JOIN',
  'CROSS JOIN',
  'JOIN',
  'WHERE',
  'GROUP BY',
  'HAVING',
  'ORDER BY',
  'LIMIT',
  'OFFSET',
  'UNION ALL',
  'UNION',
  'INTERSECT',
  'EXCEPT',
  'SET',
  'VALUES',
  'RETURNING',
];

const AGGREGATE_FNS = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT', 'STRING_AGG', 'ARRAY_AGG'];

function detectStatementType(sql: string): SqlFormatExplainResult['statementType'] {
  const head = sql.trimStart().toUpperCase();
  if (head.startsWith('WITH')) return 'WITH';
  if (head.startsWith('SELECT')) return 'SELECT';
  if (head.startsWith('INSERT')) return 'INSERT';
  if (head.startsWith('UPDATE')) return 'UPDATE';
  if (head.startsWith('DELETE')) return 'DELETE';
  return 'OTHER';
}

/** Split formatted SQL into top-level clause chunks. Naive — sufficient for common queries. */
function splitClauses(sql: string): { keyword: string; body: string }[] {
  const upper = sql.toUpperCase();
  // Find positions of every clause keyword at line starts (formatter aligns these).
  const hits: { keyword: string; start: number }[] = [];
  for (const kw of CLAUSE_KEYWORDS) {
    const re = new RegExp(`(?:^|\\n)\\s*${kw.replace(/ /g, '\\s+')}\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(upper)) !== null) {
      // Offset to where the keyword itself starts (after the leading newline/spaces).
      const kwStart = m.index + m[0].toUpperCase().indexOf(kw);
      // Skip if this keyword appears inside a longer match we already recorded.
      if (hits.some((h) => h.start === kwStart)) continue;
      hits.push({ keyword: kw, start: kwStart });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  // Dedupe overlapping keywords (e.g. "LEFT JOIN" overlapping "JOIN").
  const cleaned: { keyword: string; start: number }[] = [];
  for (const h of hits) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && h.start < prev.start + prev.keyword.length) continue;
    cleaned.push(h);
  }
  const chunks: { keyword: string; body: string }[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const cur = cleaned[i]!;
    const end = cleaned[i + 1]?.start ?? sql.length;
    const fullClause = sql.slice(cur.start, end).trim();
    const body = fullClause.slice(cur.keyword.length).trim();
    chunks.push({ keyword: cur.keyword, body });
  }
  return chunks;
}

function aggregatesIn(body: string): string[] {
  const upper = body.toUpperCase();
  const found: string[] = [];
  for (const fn of AGGREGATE_FNS) {
    if (new RegExp(`\\b${fn}\\s*\\(`).test(upper) && !found.includes(fn)) found.push(fn);
  }
  return found;
}

function explainClause(keyword: string, body: string): string {
  const kw = keyword.toUpperCase();
  switch (kw) {
    case 'WITH': {
      const cteNames = Array.from(body.matchAll(/(\w+)\s+AS\s*\(/gi)).map((m) => m[1]);
      return cteNames.length
        ? `Defines common table expression${cteNames.length > 1 ? 's' : ''}: ${cteNames.join(', ')}.`
        : 'Defines a common table expression (CTE).';
    }
    case 'SELECT': {
      const distinct = /^DISTINCT\b/i.test(body);
      const aggs = aggregatesIn(body);
      const cols = body.replace(/^DISTINCT\s+/i, '');
      const isStar = cols.trim() === '*';
      const baseSelect = isStar
        ? 'Selects every column from the source.'
        : `Returns ${distinct ? 'unique combinations of ' : ''}these expressions: ${cols.replace(/\s+/g, ' ').slice(0, 200)}${cols.length > 200 ? '…' : ''}.`;
      if (aggs.length > 0) {
        return `${baseSelect} Aggregates used: ${aggs.join(', ')}.`;
      }
      return baseSelect;
    }
    case 'INSERT INTO':
      return `Inserts new rows into ${body.split(/\s+/)[0] ?? 'the target table'}.`;
    case 'UPDATE':
      return `Updates rows in ${body.split(/\s+/)[0] ?? 'the target table'}.`;
    case 'DELETE FROM':
      return `Deletes rows from ${body.split(/\s+/)[0] ?? 'the target table'}.`;
    case 'FROM':
      return `Reads from ${body.replace(/\s+/g, ' ').slice(0, 120)}.`;
    case 'INNER JOIN':
    case 'JOIN':
      return `Inner-joins ${body.split(/\s+ON\s+/i)[0] ?? body} — only keeps rows where the join condition matches.`;
    case 'LEFT JOIN':
    case 'LEFT OUTER JOIN':
      return `Left-joins ${body.split(/\s+ON\s+/i)[0] ?? body} — keeps every row from the left side; right-side columns are NULL when no match.`;
    case 'RIGHT JOIN':
    case 'RIGHT OUTER JOIN':
      return `Right-joins ${body.split(/\s+ON\s+/i)[0] ?? body} — keeps every row from the right side; left-side columns are NULL when no match.`;
    case 'FULL JOIN':
    case 'FULL OUTER JOIN':
      return `Full-outer-joins ${body.split(/\s+ON\s+/i)[0] ?? body} — keeps unmatched rows from both sides.`;
    case 'CROSS JOIN':
      return `Cartesian-joins ${body} — every row from one side paired with every row from the other.`;
    case 'WHERE':
      return `Filters to rows where ${body.replace(/\s+/g, ' ').slice(0, 160)}.`;
    case 'GROUP BY':
      return `Groups rows by ${body.replace(/\s+/g, ' ')}. Aggregates apply within each group.`;
    case 'HAVING':
      return `Keeps only groups where ${body.replace(/\s+/g, ' ').slice(0, 160)}.`;
    case 'ORDER BY':
      return `Sorts the result by ${body.replace(/\s+/g, ' ')}.`;
    case 'LIMIT': {
      const n = body.match(/\d+/)?.[0];
      return n ? `Returns at most ${n} rows.` : 'Limits the row count.';
    }
    case 'OFFSET': {
      const n = body.match(/\d+/)?.[0];
      return n ? `Skips the first ${n} rows.` : 'Skips initial rows.';
    }
    case 'UNION':
      return 'Concatenates results, removing duplicates.';
    case 'UNION ALL':
      return 'Concatenates results, keeping duplicates.';
    case 'INTERSECT':
      return 'Keeps only rows present in both sets.';
    case 'EXCEPT':
      return 'Keeps rows from the left set that do not appear in the right set.';
    case 'SET':
      return `Assigns column values: ${body.replace(/\s+/g, ' ').slice(0, 160)}.`;
    case 'VALUES':
      return `Supplies row values: ${body.replace(/\s+/g, ' ').slice(0, 160)}.`;
    case 'RETURNING':
      return `Returns these columns from the affected rows: ${body.replace(/\s+/g, ' ').slice(0, 160)}.`;
    default:
      return body.replace(/\s+/g, ' ').slice(0, 160);
  }
}

function buildSummary(type: SqlFormatExplainResult['statementType'], annotations: SqlAnnotation[]): string {
  const has = (kw: string) => annotations.some((a) => a.clause === kw);
  if (type === 'SELECT') {
    const parts: string[] = ['Read query'];
    if (annotations.some((a) => a.clause.includes('JOIN'))) parts.push('with joins');
    if (has('GROUP BY')) parts.push('with grouping/aggregation');
    if (has('WHERE')) parts.push('with filtering');
    if (has('ORDER BY')) parts.push('with sorting');
    if (has('LIMIT')) parts.push('with row limit');
    return parts.join(', ') + '.';
  }
  if (type === 'INSERT') return 'Insert statement — adds new rows.';
  if (type === 'UPDATE') return 'Update statement — modifies existing rows.';
  if (type === 'DELETE') return 'Delete statement — removes rows.';
  if (type === 'WITH') return 'CTE-led query — defines named intermediate results before the main statement.';
  return 'SQL statement.';
}

export async function explainSql(
  sql: string,
  language: SqlFormatExplainParams['language'] = 'sql',
): Promise<SqlFormatExplainResult> {
  const input = (sql ?? '').trim();
  if (!input) {
    throw new Error('sql-format-explain requires non-empty SQL input.');
  }
  const { format } = await import('sql-formatter');
  let formatted: string;
  try {
    formatted = format(input, { language, keywordCase: 'upper', tabWidth: 2 });
  } catch (e) {
    throw new Error(`Failed to format SQL: ${(e as Error).message}`);
  }

  const statementType = detectStatementType(formatted);
  const chunks = splitClauses(formatted);
  const annotations: SqlAnnotation[] = chunks.map((c) => ({
    clause: c.keyword.toUpperCase(),
    text: c.body,
    explanation: explainClause(c.keyword, c.body),
  }));
  const summary = buildSummary(statementType, annotations);

  return { formatted, statementType, annotations, summary };
}

export const sqlFormatExplain: ToolModule<SqlFormatExplainParams> = {
  id: 'sql-format-explain',
  slug: 'sql-format-explain',
  name: 'SQL Format + Explain',
  description:
    'Format a SQL query and break it down into plain-English clause-by-clause annotations. Identifies SELECT/FROM/JOIN/WHERE/GROUP BY/HAVING/ORDER BY/LIMIT, aggregates, joins, CTEs, and statement type.',
  llmDescription:
    'Take a SQL query, return pretty-printed SQL plus structured annotations: each clause (SELECT/FROM/JOIN/WHERE/etc.) with its body and a plain-English meaning. Useful for explaining queries to non-DBAs or auditing complex statements. Output is JSON.',
  category: 'dev',
  keywords: ['sql', 'explain', 'format', 'annotate', 'query', 'database', 'breakdown'],

  input: {
    accept: ['text/plain', 'application/sql'],
    min: 1,
    max: 1,
    sizeLimit: 1 * 1024 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultSqlFormatExplainParams,

  paramSchema: {
    language: {
      type: 'enum',
      label: 'Dialect',
      options: [
        { value: 'sql', label: 'Standard SQL' },
        { value: 'postgresql', label: 'PostgreSQL' },
        { value: 'mysql', label: 'MySQL' },
        { value: 'sqlite', label: 'SQLite' },
        { value: 'bigquery', label: 'BigQuery' },
      ],
    },
  },

  async run(inputs: File[], params: SqlFormatExplainParams, ctx: ToolRunContext): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Parsing SQL' });
    const text = await inputs[0]!.text();
    const result = await explainSql(text, params.language ?? 'sql');
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
