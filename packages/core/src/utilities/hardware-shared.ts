import { UtilityInputError } from './common.js';
import { validateBuildingRows } from './building-shared.js';

export function abort(signal?: AbortSignal) {
  if (signal?.aborted)
    throw new UtilityInputError('$run', 'abort', 'Hardware calculation cancelled.');
}

export interface GeneratorLoad {
  name: string;
  runningW: number;
  startingW: number;
  quantity: number;
}
export function validateGeneratorLoads(value: unknown): GeneratorLoad[] {
  const rows = validateBuildingRows(
    value,
    'loads',
    {
      name: { type: 'string', maxLength: 120 },
      runningW: { type: 'number', min: 0, max: 1e9 },
      startingW: { type: 'number', min: 0, max: 1e9 },
      quantity: { type: 'number', min: 0, max: 10000, integer: true },
    },
    100,
  ) as unknown as GeneratorLoad[];
  for (const [i, row] of rows.entries())
    if (row.startingW < row.runningW)
      throw new UtilityInputError(
        `$.loads[${i}].startingW`,
        'bounds',
        'Starting watts include running watts and must not be smaller.',
      );
  return rows;
}

