import { parseTextRows } from '@wyreup/core/execution';

export interface MarkdownTableView {
  headers: string[];
  rows: string[][];
}
export const MARKDOWN_TABLE_PAGE_SIZE = 25;

// The shared parser supplies actual strings and limits. This projection only
// pads cells and chooses display headers; it never parses or serializes Markdown.
export function prepareMarkdownTablePreview(
  input: string,
  params: Record<string, unknown>,
): MarkdownTableView {
  if (typeof params.delimiter !== 'string' || typeof params.hasHeader !== 'boolean')
    throw new Error('Choose a table delimiter and header setting.');
  const parsed = parseTextRows(input, params.delimiter);
  const width = Math.max(...parsed.map((row) => row.length));
  const rows = parsed.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
  const headers = params.hasHeader
    ? rows.shift()!
    : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  return { headers, rows };
}

export function markdownCellLines(cell: string): string[] {
  return cell.split(/\r\n?|\n/);
}
