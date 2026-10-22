export interface FilePin {
  path: string;
  bytes: number;
  sha256: string;
}

export type DomainProviderScenario = 'ok' | 'provider-rate-limited' | 'provider-error';

export interface DomainFunctionsInspection {
  outboundCalls: number;
  unexpectedOutbound: number;
  requests: {
    dependency: 'bootstrap' | 'registry' | 'unexpected';
    method: string;
    scenario: DomainProviderScenario;
    headers: { accept: string | null; authorization: string | null; cookie: string | null; referer: string | null };
  }[];
  counters: { route: 'domain-age'; window_start: number; scope_key: string; count: number }[];
  leaseCount: number;
  clock: { now_seconds: number; window_start: number };
  expectedLoopbackDigest: string;
  realBindings: { database: boolean; secret: boolean };
}

export interface DomainFunctionsHost {
  url: string;
  manifest: string;
  setProviderScenario(scenario: DomainProviderScenario): Promise<{ scenario: DomainProviderScenario }>;
  resetAdmission(): Promise<{ reset: true }>;
  inspect(): Promise<DomainFunctionsInspection>;
  close(): Promise<void>;
}

export function startDomainFunctionsHost(options: {
  projectDir: string;
  distDir: string;
  evidenceDir: string;
  expectedCoreDistPins: FilePin[];
  callerAbortSignal?: AbortSignal;
  deadlineAt?: number;
  fault?: 'none' | 'missing-secret' | 'missing-database';
}): Promise<DomainFunctionsHost>;
