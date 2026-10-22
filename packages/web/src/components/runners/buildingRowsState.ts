import {
  cloneUtilityJson,
  validateBoardFootPieces,
  validateGutterCandidates,
  validateGeneratorLoads,
  type ParamFieldSchema,
} from '@wyreup/core/execution';

export interface BuildingRowColumn {
  key: string;
  label: string;
  kind: 'number' | 'string';
}
export interface BuildingRowContract {
  key: 'pieces' | 'candidates' | 'loads';
  columns: BuildingRowColumn[];
  emptyRow: Record<string, string>;
  maxRows: number;
}
const numeric = (key: string, label: string): BuildingRowColumn => ({ key, label, kind: 'number' });
const named = (key: string, label: string): BuildingRowColumn => ({ key, label, kind: 'string' });
export function buildingRowContract(id: string): BuildingRowContract {
  if (id === 'board-foot-calculator')
    return {
      key: 'pieces',
      maxRows: 100,
      columns: [
        numeric('thicknessIn', 'Thickness (in)'),
        numeric('widthIn', 'Width (in)'),
        numeric('lengthFt', 'Length (ft)'),
        numeric('quantity', 'Quantity (whole pieces)'),
        numeric('pricePerBoardFoot', 'Price per board foot'),
      ],
      emptyRow: {
        thicknessIn: '1',
        widthIn: '12',
        lengthFt: '8',
        quantity: '1',
        pricePerBoardFoot: '0',
      },
    };
  if (id === 'gutter-size-calculator')
    return {
      key: 'candidates',
      maxRows: 32,
      columns: [
        named('name', 'Candidate name'),
        numeric('widthM', 'Flowing width (m)'),
        numeric('waterDepthM', 'Flowing water depth (m)'),
      ],
      emptyRow: { name: 'Rectangle', widthM: '0.1', waterDepthM: '0.05' },
    };
  if (id === 'generator-wattage-calculator')
    return {
      key: 'loads',
      maxRows: 100,
      columns: [
        named('name', 'Load name'),
        numeric('runningW', 'Running watts'),
        numeric('startingW', 'Starting watts (includes running)'),
        numeric('quantity', 'Quantity (whole items)'),
      ],
      emptyRow: { name: 'Load', runningW: '100', startingW: '100', quantity: '1' },
    };
  throw new Error('Unsupported building row editor.');
}
export function validateBuildingDraft(id: string, drafts: Record<string, string>[]): unknown[] {
  const contract = buildingRowContract(id),
    rows = drafts.map((row, index) =>
      Object.fromEntries(
        contract.columns.map((column): [string, string | number] => {
          const raw = row[column.key];
          if (typeof raw !== 'string' || (column.kind === 'number' && !raw.trim()))
            throw new Error(`$.${contract.key}[${index}].${column.key}: Enter a value.`);
          if (column.kind === 'string') return [column.key, raw];
          if (
            !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim()) ||
            !Number.isFinite(Number(raw))
          )
            throw new Error(`$.${contract.key}[${index}].${column.key}: Enter a finite number.`);
          return [column.key, Number(raw)];
        }),
      ),
    );
  return checkedBuildingRows(id, rows);
}
export function checkedBuildingRows(id: string, value: unknown): unknown[] {
  if (id === 'board-foot-calculator') return validateBoardFootPieces(value);
  if (id === 'gutter-size-calculator') return validateGutterCandidates(value);
  if (id === 'generator-wattage-calculator') return validateGeneratorLoads(value);
  throw new Error('Unsupported building row editor.');
}
export function buildingDrafts(id: string, value: unknown): Record<string, string>[] {
  const contract = buildingRowContract(id),
    rows = checkedBuildingRows(id, value) as Record<string, string | number>[];
  return rows.map((row) =>
    Object.fromEntries(contract.columns.map((column) => [column.key, String(row[column.key])])),
  );
}
export function parseBuildingPaste(id: string, source: string): unknown[] {
  if (new TextEncoder().encode(source).length > 1048576) throw new Error('Row paste exceeds1MiB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('Enter a valid JSON row array.');
  }
  return checkedBuildingRows(id, parsed);
}
export function buildingScalarProjection(
  id: string,
  defaults: Record<string, unknown>,
  schema: Record<string, ParamFieldSchema>,
  params: Record<string, unknown>,
) {
  const { key } = buildingRowContract(id),
    without = <T>(value: Record<string, T>) =>
      Object.fromEntries(Object.entries(value).filter(([field]) => field !== key));
  return { defaults: without(defaults), paramSchema: without(schema), params: without(params) };
}
export function buildingInputSnapshot(value: Record<string, unknown>): Record<string, unknown> {
  const copy = cloneUtilityJson(value, '$params') as Record<string, unknown>;
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}
