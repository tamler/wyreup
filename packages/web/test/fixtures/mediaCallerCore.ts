import { createRegistry } from '../../../core/src/registry';
import type { ToolModule } from '../../../core/src/types';
import { splitPdf, type SplitPdfParams } from '../../../core/src/tools/split-pdf';
export { runChain } from '../../../core/src/chain/engine';
export { clearPipelineCache } from '../../../core/src/lib/transformers';
export { validateChain } from '../../../core/src/chain/validate';
export { mimeMatches, couldFlowTo } from '../../../core/src/registry';
export { fileMatchesMime } from '../../../core/src/lib/input-validation';
export type * from '../../../core/src/types';
export type * from '../../../core/src/chain/types';
export type * from '../../../core/src/chain/validate';
export { DEFAULT_RATE_LIMIT, TRIGGER_KIT_VERSION } from '../../../core/src/triggers/types';
export {
  parseTriggerKit,
  serializeTriggerKit,
  strippedForImport,
  updateTriggerRule,
} from '../../../core/src/triggers/storage';
export { matchRule, pruneFires } from '../../../core/src/triggers/match';
export const calls: string[] = [];
export const callInputs: Array<{ toolId: string; inputs: File[] }> = [];
const pending: Array<() => void> = [];
export function settleFirst() {
  pending.shift()?.();
}
const query = new URLSearchParams(location.search);
function tool(id: string, credit = false): ToolModule {
  return {
    id,
    name: id,
    slug: id,
    description: 'Controlled caller task',
    category: 'media',
    keywords: [],
    input: { min: 1, max: 2, accept: ['*/*'] },
    output: { mime: 'video/mp4' },
    defaults: {},
    memoryEstimate: 'low',
    interactive: false,
    batchable: true,
    cost: 'free',
    __testFixtures: { valid: [], weird: [], expectedOutputMime: [] },
    ...(credit
      ? {
          cost: 'credit' as const,
          creditCost:
            query.get('price') === 'unknown'
              ? undefined
              : query.get('price') === 'negative'
                ? -1
                : 3,
        }
      : {}),
    async run(inputs: File[]) {
      calls.push(id);
      callInputs.push({ toolId: id, inputs: [...inputs] });
      if (!credit) await new Promise<void>((done) => pending.push(done));
      return [new Blob(['actual controlled task result'], { type: 'video/mp4' })];
    },
  };
}
const tools = [
  tool('convert-video'),
  tool('compress-video'),
  tool('bg-remove-pro', true),
  tool('hash'),
  tool('extract-frame'),
  tool('video-speed'),
  tool('camera-shutter-count-checker'),
];
const observedSplitPdf = {
  ...splitPdf,
  async run(inputs: File[], params: unknown, ctx: Parameters<typeof splitPdf.run>[2]) {
    const outputs = await splitPdf.run(inputs, params as SplitPdfParams, ctx);
    realSplitOutputs.push(...(Array.isArray(outputs) ? outputs : [outputs]));
    return outputs;
  },
} as unknown as ToolModule;
tools.push(observedSplitPdf);
export const realSplitOutputs: Blob[] = [];
export function createDefaultRegistry() {
  return createRegistry(tools);
}
export function runPreflight() {
  return Promise.resolve({ verdict: 'clean' as const, findings: [], toolUsed: null });
}
export function readFileHeader() {
  return Promise.resolve({ hex: '00', signatureLabel: null });
}
export function detectCapabilities() {
  return Promise.resolve({ hasWebGPU: true, hasWasm: true, deviceMemoryGB: 8 });
}
export function checkToolCapabilities() {
  return { runnable: true, missing: [] };
}
