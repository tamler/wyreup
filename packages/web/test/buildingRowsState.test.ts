import { describe, expect, it, vi } from 'vitest';
const { coreFixture } = vi.hoisted(() => {
  let fixture: Promise<Record<string, unknown>> | undefined;
  return {
    coreFixture: () =>
      (fixture ??= (async () => ({
        ...(await import('../../core/src/utilities/common')),
        ...(await import('../../core/src/utilities/building')),
        ...(await import('../../core/src/utilities/hardware')),
      }))()),
  };
});
vi.mock('@wyreup/core', () => coreFixture());
vi.mock('@wyreup/core/execution', () => coreFixture());
import {
  buildingDrafts,
  buildingInputSnapshot,
  buildingRowContract,
  buildingScalarProjection,
  parseBuildingPaste,
  validateBuildingDraft,
} from '../src/components/runners/buildingRowsState';
describe('actual building row validation and immutable snapshots', () => {
  it.each(['board-foot-calculator', 'gutter-size-calculator', 'generator-wattage-calculator'])(
    'roundtrips typed %s rows without mutation/coercion',
    (id) => {
      const draft = buildingRowContract(id).emptyRow;
      const typed = validateBuildingDraft(id, [{ ...draft }]);
      expect(buildingDrafts(id, typed)).toEqual([draft]);
      expect(parseBuildingPaste(id, JSON.stringify(typed))).toEqual(typed);
      const snapshot = buildingInputSnapshot({ rows: typed });
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen((snapshot.rows as unknown[])[0])).toBe(true);
      expect(snapshot.rows).not.toBe(typed);
    },
  );
  it('retains zero, rejects blank/bad numeric/fractional counts and exact row paths', () => {
    const row = buildingRowContract('board-foot-calculator').emptyRow;
    expect(
      validateBuildingDraft('board-foot-calculator', [{ ...row, quantity: '0' }]),
    ).toMatchObject([{ quantity: 0 }]);
    for (const quantity of ['', 'NaN', '$2', '1.5'])
      expect(() => validateBuildingDraft('board-foot-calculator', [{ ...row, quantity }])).toThrow(
        /\$\.pieces\[0\]\.quantity/,
      );
    expect(() => parseBuildingPaste('board-foot-calculator', '[{"thicknessIn":"1"}]')).toThrow();
    expect(() =>
      parseBuildingPaste(
        'generator-wattage-calculator',
        '[{"name":"x","runningW":20,"startingW":10,"quantity":1}]',
      ),
    ).toThrow(/startingW/);
  });
  it.each(['board-foot-calculator', 'gutter-size-calculator', 'generator-wattage-calculator'])(
    'enforces %s exact keys/count caps and empty behavior',
    (id) => {
      const contract = buildingRowContract(id),
        row = validateBuildingDraft(id, [contract.emptyRow])[0];
      expect(() =>
        parseBuildingPaste(id, JSON.stringify([{ ...(row as object), extra: 1 }])),
      ).toThrow(/extra/);
      expect(() =>
        parseBuildingPaste(id, JSON.stringify(new Array(contract.maxRows + 1).fill(row))),
      ).toThrow();
      expect(parseBuildingPaste(id, '[]')).toEqual([]);
    },
  );
  it('separates scalar defaults/schema/params and bounds optional paste', () => {
    expect(
      buildingScalarProjection(
        'generator-wattage-calculator',
        { loads: [], headroom: 25 },
        { loads: { type: 'json' }, headroom: { type: 'number' } },
        { loads: [], headroom: 30 },
      ),
    ).toEqual({
      defaults: { headroom: 25 },
      paramSchema: { headroom: { type: 'number' } },
      params: { headroom: 30 },
    });
    expect(() => parseBuildingPaste('board-foot-calculator', 'not json')).toThrow(/JSON/);
    expect(() => parseBuildingPaste('board-foot-calculator', ' '.repeat(1048577))).toThrow(/1MiB/);
  });
});
