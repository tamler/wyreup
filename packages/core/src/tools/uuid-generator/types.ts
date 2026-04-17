export interface UuidGeneratorParams {
  /** UUID version. Currently only v4 is supported. Default 4. */
  version?: 4;
  /** Number of UUIDs to generate. Default 1. */
  count?: number;
}

export const defaultUuidGeneratorParams: UuidGeneratorParams = {
  version: 4,
  count: 1,
};
