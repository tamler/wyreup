// Fixed dependency timing for SOURCE7 component regressions, not native scan coverage.
export * from './utilityCore';
export { validateChain } from '../../../core/src/chain/validate';
export type * from '../../../core/src/triggers/types';
import { createRegistry } from '../../../core/src/registry';
import type { ToolModule } from '../../../core/src/types';

export const source7Runs: string[] = [];
const wordCounter: ToolModule = {
  id: 'word-counter', slug: 'word-counter', name: 'Count words',
  description: 'Fixed component input fixture', category: 'text', keywords: [],
  input: { accept: ['text/plain'], min: 1, max: 1, sizeLimit: 64 },
  output: { mime: 'text/plain' }, defaults: {}, cost: 'free',
  interactive: false, batchable: false, memoryEstimate: 'low',
  __testFixtures: { valid: [], weird: [], expectedOutputMime: [] },
  run() {
    return new Promise<Blob>((resolve) => {
      source7Runs.push('word-counter');
      resolve(new Blob(['controlled result'], { type: 'text/plain' }));
    });
  },
};
export function createDefaultRegistry() { return createRegistry([wordCounter]); }
export function detectCapabilities() { return Promise.resolve({ hasWebGPU: false, hasWasm: true, deviceMemoryGB: 8 }); }
export function checkToolCapabilities() { return { runnable: true, missing: [] }; }
export function readFileHeader() { return Promise.resolve({ hex: '53 37', signatureLabel: null }); }

type ScanResult = { verdict: 'high' | 'unanalysed'; findings: Array<{ kind: string; detail: string }>; toolUsed: 'pdf-suspicious' | null };
const scans: Array<{ name: string; resolve(value: ScanResult): void; reject(reason: unknown): void; settled: boolean }> = [];
export function runPreflight(file: File) {
  return new Promise<ScanResult>((resolve, reject) => { scans.push({ name: file.name, resolve, reject, settled: false }); });
}
export function scanNames() { return scans.map(scan => scan.name); }
export function settleScan(index: number, outcome: 'high' | 'reject' | 'unanalysed') {
  const scan = scans[index];
  if (!scan || scan.settled) throw new Error('Unknown or already settled fixed scan.');
  scan.settled = true;
  if (outcome === 'reject') scan.reject(new Error('Controlled scanner failure.'));
  else scan.resolve(outcome === 'high'
    ? { verdict: 'high', findings: [{ kind: 'controlled', detail: 'Fixed high finding.' }], toolUsed: 'pdf-suspicious' }
    : { verdict: 'unanalysed', findings: [], toolUsed: null });
}
