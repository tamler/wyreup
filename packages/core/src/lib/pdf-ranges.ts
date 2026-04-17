/**
 * Shared helper for parsing page range specs used by pdf-extract-pages,
 * pdf-delete-pages, and other tools that accept mixed number/string page specs.
 *
 * Accepts an array of values like [1, 3, "5-8", 10] and returns a sorted,
 * deduplicated array of 1-indexed page numbers. Throws with a clear message
 * if any entry is out of bounds or malformed.
 */
export function parseRangeSpec(
  pages: (number | string)[],
  pageCount: number,
): number[] {
  if (pages.length === 0) {
    throw new Error('pages must not be empty.');
  }

  const result = new Set<number>();

  for (const entry of pages) {
    if (typeof entry === 'number') {
      const n = entry;
      if (!Number.isInteger(n) || n < 1 || n > pageCount) {
        throw new Error(
          `Page number ${n} is out of range (document has ${pageCount} page${pageCount === 1 ? '' : 's'}).`,
        );
      }
      result.add(n);
    } else {
      const rangeMatch = entry.match(/^(\d+)-(\d+)$/);
      if (rangeMatch) {
        const start = parseInt(rangeMatch[1]!, 10);
        const end = parseInt(rangeMatch[2]!, 10);
        if (start < 1 || end < start || end > pageCount) {
          throw new Error(
            `Range "${entry}" is invalid for a ${pageCount}-page document (pages are 1-indexed).`,
          );
        }
        for (let p = start; p <= end; p++) {
          result.add(p);
        }
      } else {
        const singleMatch = entry.match(/^(\d+)$/);
        if (singleMatch) {
          const n = parseInt(singleMatch[1]!, 10);
          if (n < 1 || n > pageCount) {
            throw new Error(
              `Page number ${n} is out of range (document has ${pageCount} page${pageCount === 1 ? '' : 's'}).`,
            );
          }
          result.add(n);
        } else {
          throw new Error(
            `Invalid page spec "${entry}". Expected a number (e.g. 3) or a range (e.g. "5-8").`,
          );
        }
      }
    }
  }

  return Array.from(result).sort((a, b) => a - b);
}
