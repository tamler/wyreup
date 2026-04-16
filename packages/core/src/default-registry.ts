import { createRegistry, type ToolRegistry } from './registry.js';
import { compress } from './tools/compress/index.js';
import { convert } from './tools/convert/index.js';
import { stripExif } from './tools/strip-exif/index.js';
import { imageToPdf } from './tools/image-to-pdf/index.js';
import { mergePdf } from './tools/merge-pdf/index.js';
import { splitPdf } from './tools/split-pdf/index.js';
import { rotatePdf } from './tools/rotate-pdf/index.js';
import { reorderPdf } from './tools/reorder-pdf/index.js';
import { pageNumbersPdf } from './tools/page-numbers-pdf/index.js';
import type { ToolModule } from './types.js';

/**
 * All first-party Wyreup tools, in presentation order.
 * Typed as ToolModule<any> because TypeScript's function parameter
 * contravariance makes it hard to hold Params-parameterized tools in
 * a single heterogeneous array without losing type safety on each one.
 */
export const defaultTools: ToolModule<any>[] = [
  compress,
  convert,
  stripExif,
  imageToPdf,
  mergePdf,
  splitPdf,
  rotatePdf,
  reorderPdf,
  pageNumbersPdf,
];

export function createDefaultRegistry(): ToolRegistry {
  return createRegistry(defaultTools as ToolModule[]);
}
