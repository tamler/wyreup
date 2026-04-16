export type HashAlgorithm = 'SHA-256' | 'SHA-1' | 'SHA-512';

export interface HashParams {
  /** Hash algorithms to compute. Default: ['SHA-256']. */
  algorithms: HashAlgorithm[];
}

export const defaultHashParams: HashParams = {
  algorithms: ['SHA-256'],
};

export interface HashFileResult {
  name: string;
  bytes: number;
  hashes: Partial<Record<HashAlgorithm, string>>;
}
