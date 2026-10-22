import type { AstroIntegration } from 'astro';

export interface FilePin { path: string; bytes: number; sha256: string }
export interface CoordinatedCoreProof {
  schemaVersion: 1;
  mode: 'owned-current-core-build-v1';
  runId: string;
  sourceRoot: string;
  ownedBuildRoot: string;
  sourceInputs: FilePin[];
  sourceInputsAfter: FilePin[];
  dependencyIdentities: {
    packageRoot: string;
    name: string;
    version: string;
    packageJson: FilePin;
    toolPins: FilePin[];
  }[];
  build: {
    argv: string[];
    cwd: string;
    node: FilePin & { version: string };
    environment: Partial<Record<'NODE_ENV' | 'CI' | 'TZ' | 'LANG' | 'LC_ALL' | 'PATH' | 'COREPACK_ENABLE_STRICT', string>>;
    configPin: FilePin;
    log: FilePin;
    outcome: { exitCode: 0; signal: null; exitObserved: true; closeObserved: true; logWritersSettled: true };
  };
  outputRoot: 'core-build-output';
  outputs: FilePin[];
  packageManifest: FilePin;
  sourcePathMapping: { originalPrefix: string; ownedPrefix: string; logicalPrefix: 'packages/core/' };
}
export interface BindingOptions {
  runId: string;
  observationDir: string;
  observerIdentity: { relativePath: 'packages/web/test/productionBuildBindingObserver.mjs'; bytes: number; sha256: string };
}
export const BINDING_LIMITS: Readonly<{ recordBytes: number; totalBytes: number; records: number; stringBytes: number; arrays: number; aliases: number; depth: number; visited: number }>;
export function projectBindingPolicy(environment: { config: object }): object;
export function readCoordinatedCoreProof(root: string, runId: string): Promise<{
  proof: CoordinatedCoreProof;
  packageBytes: Buffer;
  outputDirectory: string;
  proofPin: FilePin;
}>;
export function createProductionBindingObserver(options: BindingOptions): AstroIntegration;
