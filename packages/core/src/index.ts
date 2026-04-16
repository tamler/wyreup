// Wyreup core — tool library public API

export const WYREUP_CORE_VERSION = '0.0.0';

export type {
  ToolModule,
  ToolCategory,
  ToolPresence,
  ToolInputSpec,
  ToolOutputSpec,
  ToolProgress,
  ToolRunContext,
  ToolComponentProps,
  MemoryEstimate,
  MimePattern,
} from './types.js';

export type { ComponentType } from './ui-types.js';

export {
  runChain,
  MAX_CHAIN_DEPTH,
  ChainError,
  type Chain,
  type ChainStep,
} from './chain/engine.js';

export type { SavedChain } from './chain/types.js';

export { detectCycle } from './chain/cycle.js';

export { createRegistry, mimeMatches, type ToolRegistry } from './registry.js';

export { getRuntimeAdapter, type RuntimeAdapter } from './runtime/types.js';

export { detectFormat, getCodec, type ImageFormat, type Codec } from './lib/codecs.js';

export { compress, type CompressParams, defaultCompressParams } from './tools/compress/index.js';
