import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  buildStlContours,
  parseStl,
  serializeStlGcode,
  validateStlJobResult,
  validateStlParams,
} from '../../src/utilities/stl-contours.js';
import {
  asciiStl,
  binaryStl,
  box,
  hollowBox,
  precisionNotchPrism,
} from '../fixtures/catalog-files/stl-fixtures.js';
import type { FixtureTriangle } from '../fixtures/catalog-files/stl-fixtures.js';

const signal = () => new AbortController().signal;
const build = (
  triangles: FixtureTriangle[],
  params: Record<string, unknown> = {},
  binary = false,
) =>
  buildStlContours(
    binary ? binaryStl(triangles) : asciiStl(triangles),
    { layerHeightMm: 2, ...params },
    signal(),
  );
// Separate strict artifact reader: it knows only the permitted command grammar, not slicer helpers.
function readGcode(text: string) {
  const layers: { z: number; loops: [number, number][][] }[] = [];
  let loop: [number, number][] | null = null;
  for (const line of text.trimEnd().split('\n')) {
    if (line.startsWith(';')) continue;
    if (line === 'G21' || line === 'G90') continue;
    let m = /^G0 Z(\d+(?:\.\d+)?)$/.exec(line);
    if (m) {
      layers.push({ z: Number(m[1]), loops: [] });
      loop = null;
      continue;
    }
    m = /^G0 X(\d+(?:\.\d+)?) Y(\d+(?:\.\d+)?)$/.exec(line);
    if (m) {
      loop = [[Number(m[1]), Number(m[2])]];
      layers.at(-1)!.loops.push(loop);
      continue;
    }
    m = /^G1 X(\d+(?:\.\d+)?) Y(\d+(?:\.\d+)?) F(\d+)$/.exec(line);
    expect(m, `Unexpected command ${line}`).not.toBeNull();
    expect(loop).not.toBeNull();
    expect(Number(m![3])).toBe(1200);
    loop!.push([Number(m![1]), Number(m![2])]);
  }
  for (const layer of layers)
    for (const points of layer.loops) expect(points.at(-1)).toEqual(points[0]);
  return layers;
}
describe('strict STL contour preview', () => {
  it.each([false, true])('independent cube all five layers, binary=%s', (binary) => {
    const result = build(box(), {}, binary);
    expect(result.report.triangleCount).toBe(12);
    expect(result.report.vertexCount).toBe(8);
    expect(result.report.layerCount).toBe(5);
    expect(result.report.partialTopMm).toBe(0);
    expect(result.report.translationMm).toEqual([0, 0, 0]);
    for (const layer of result.report.layers) {
      expect(layer.contours[0]!.points).toEqual([
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]);
      expect(layer.netAreaMm2).toBe(100);
      expect(layer.perimeterMm).toBe(40);
    }
    expect(readGcode(result.gcode).map((l) => l.z)).toEqual([1, 3, 5, 7, 9]);
    expect(readGcode(result.gcode).map((l) => l.loops)).toEqual(
      Array.from({ length: 5 }, () => [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ]),
    );
    expect(validateStlJobResult(result, { layerHeightMm: 2 })).toBe(result);
  });
  it('hollow solid has independently known outer, hole and net areas', () => {
    const result = build(hollowBox());
    for (const layer of result.report.layers) {
      expect(layer.contours.map((c) => [c.depth, c.hole, c.areaMm2])).toEqual([
        [0, false, 100],
        [1, true, 16],
      ]);
      expect(layer.netAreaMm2).toBe(84);
      expect(layer.perimeterMm).toBe(56);
    }
    expect(readGcode(result.gcode)[0]!.loops).toHaveLength(2);
  });
  it('disconnected solids and genuine vertical gap retain every layer', () => {
    const disjoint = build([...box(), ...box(20, 0, 0, 30, 10, 10)]);
    expect(disjoint.report.layers[0]!.netAreaMm2).toBe(200);
    expect(disjoint.report.layers[0]!.contours).toHaveLength(2);
    const gap = build([...box(0, 0, 0, 10, 10, 2), ...box(0, 0, 8, 10, 10, 10)]);
    expect(gap.report.layers.map((l) => l.empty)).toEqual([false, true, true, true, false]);
    expect(readGcode(gap.gcode).map((l) => [l.z, l.loops.length])).toEqual([
      [1, 1],
      [3, 0],
      [5, 0],
      [7, 0],
      [9, 1],
    ]);
  });
  it('exact inch conversion, partial top and XYZ translation are disclosed', () => {
    const inches = build(box(0, 0, 0, 1, 1, 1), { units: 'inches' });
    expect(inches.report.extentMm).toEqual([25.4, 25.4, 25.4]);
    expect(inches.report.layers[0]!.netAreaMm2).toBeCloseTo(645.16, 8);
    expect(inches.report.layers[0]!.perimeterMm).toBeCloseTo(101.6, 8);
    expect(inches.report.partialTopMm).toBeCloseTo(1.4, 8);
    const translated = build(box(99990, 99990, 99990, 100000, 100000, 100000));
    expect(translated.report.translationMm).toEqual([-99990, -99990, -99990]);
    expect(translated.gcode).toBe(build(box()).gcode);
  });
  it('prescribed micron floor tolerates representation noise without negative partial top', () => {
    const result = build(box(0, 0, 0, 10, 10, 9.999999999999998));
    expect(result.report.layerCount).toBe(5);
    expect(result.report.partialTopMm).toBe(0);
    expect(readGcode(result.gcode).map((layer) => layer.z)).toEqual([1, 3, 5, 7, 9]);
  });
  it('binary solid header including hostile commands is never copied', () => {
    const bytes = binaryStl(box(), 'solid secret-header\nM104 S300\n');
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < 12; i++) view.setUint16(84 + i * 50 + 48, 65535, true);
    const result = buildStlContours(bytes, { layerHeightMm: 2 }, signal());
    expect(result.gcode).not.toMatch(/M104|secret-header|solid/);
    expect(readGcode(result.gcode)).toHaveLength(5);
  });
  it('static original fixture matches an independently authored golden artifact', async () => {
    const bytes = new Uint8Array(
      await readFile(new URL('../fixtures/catalog-files/stl-cube.stl', import.meta.url)),
    );
    const expected = await readFile(
      new URL('../fixtures/catalog-files/stl-cube.expected.gcode', import.meta.url),
      'utf8',
    );
    expect(buildStlContours(bytes, { layerHeightMm: 2 }, signal()).gcode).toBe(expected);
  });
  it('finite normals, finite vertices, exact binary lengths and triangle caps are strict', () => {
    const bytes = binaryStl(box()),
      view = new DataView(bytes.buffer);
    view.setFloat32(84, NaN, true);
    expect(() => buildStlContours(bytes, {}, signal())).toThrow(/normal/);
    view.setFloat32(84, 0, true);
    view.setFloat32(96, Infinity, true);
    expect(() => buildStlContours(bytes, {}, signal())).toThrow(/finite/);
    expect(() => buildStlContours(binaryStl(box()).subarray(0, 683), {}, signal())).toThrow(
      /binary|ASCII/,
    );
    const excessive = new Uint8Array(84 + 200001 * 50);
    new DataView(excessive.buffer).setUint32(80, 200001, true);
    expect(() => buildStlContours(excessive, {}, signal())).toThrow(/Triangle count/);
  });
  it('strict malformed input, unknown params, quantum and envelope errors', () => {
    expect(() => buildStlContours(new Uint8Array(85), {}, signal())).toThrow(/binary|ASCII/);
    expect(() => buildStlContours(asciiStl(box()).subarray(0, 100), {}, signal())).toThrow(
      /endsolid/,
    );
    expect(() => validateStlParams({ bogus: true })).toThrow(/Unknown/);
    expect(() => validateStlParams({ layerHeightMm: 0.2001 })).toThrow(/microns/);
    expect(() => build(box(), { envelopeX: 5 })).toThrow(/envelope/);
    expect(() => build(box(100001, 0, 0, 100011, 10, 10))).toThrow(/100,000/);
    expect(() => build(box(), { layerHeightMm: 0.05, envelopeZ: 5 })).toThrow(/envelope/);
    expect(() => build(box(0, 0, 0, 10, 10, 0.01))).toThrow(/layer count/);
    expect(() => build(box(0, 0, 0, 10, 10, 101), { layerHeightMm: 0.05 })).toThrow(/layer count/);
  });
  it('duplicate, degenerate, open, flipped and touching vertex fans reject', () => {
    expect(() => build([...box(), box()[0]!])).toThrow(/Duplicate/);
    expect(() =>
      build([
        [
          [0, 0, 0],
          [0, 0, 0],
          [1, 1, 1],
        ],
      ]),
    ).toThrow(/Degenerate/);
    expect(() => build(box().slice(1))).toThrow(/Open/);
    const flipped = box();
    flipped[0] = [flipped[0]![0], flipped[0]![2], flipped[0]![1]];
    expect(() => build(flipped)).toThrow(/orientation/);
    expect(() => build([...box(), ...box(10, 10, 10, 20, 20, 20)])).toThrow(/vertex fan/);
  });
  it('actual Euclidean welding does not close a two-epsilon face gap', () => {
    const triangles = box();
    const face = triangles[4]!;
    face[0] = [face[0][0], face[0][1], face[0][2] + 0.0000021];
    expect(() => build(triangles)).toThrow(/Open/);
    const near = box();
    near[4]![0] = [near[4]![0][0] + 0.0000003, near[4]![0][1] + 0.0000003, near[4]![0][2]];
    expect(parseStl(asciiStl(near), { layerHeightMm: 2 }, signal()).vertices.length / 3).toBe(8);
  });
  it('overlapping closed solids and touching separate boundaries reject', () => {
    expect(() => build([...box(), ...box(5, 5, 0, 15, 15, 10)])).toThrow(
      /Intersecting|Nonmanifold/,
    );
    expect(() => build([...box(), ...box(10, 0, 0, 20, 10, 10)])).toThrow(
      /Duplicate|Nonmanifold|orientation/,
    );
  });
  it('half-open on-plane faces are deterministic and do not fabricate gap contours', () => {
    const exact = build([...box(0, 0, 0, 10, 10, 1), ...box(20, 0, 1, 30, 10, 10)]);
    expect(exact.report.layers[0]!.contours).toHaveLength(1);
    expect(exact.report.layers[0]!.contours[0]!.points).toEqual([
      [20, 0],
      [30, 0],
      [30, 10],
      [20, 10],
    ]);
  });
  it('abort checks happen before input and within bounded batches', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => buildStlContours(asciiStl(box()), {}, controller.signal)).toThrow(/cancelled/);
    let checks = 0;
    const scripted = {
      get aborted() {
        return ++checks >= 3;
      },
    } as AbortSignal;
    const many = Array.from({ length: 30 }, (_, i) => box(i * 3, 0, 0, i * 3 + 1, 1, 1)).flat();
    expect(() => buildStlContours(asciiStl(many), {}, scripted)).toThrow(/cancelled/);
    expect(checks).toBe(3);
  });
  it('bounded spatial sweep rejects excessive candidate work', () => {
    const many = Array.from({ length: 200 }, (_, i) => box(0, i * 3, 0, 1, i * 3 + 1, 1)).flat();
    expect(() => build(many, { layerHeightMm: 0.5, envelopeY: 1000 })).toThrow(/pair budget/);
  });
  it('preflights packed candidate allocation on independent separated tall cubes', () => {
    const tall = Array.from({ length: 626 }, (_, i) => box(i, 0, 0, i + 0.5, 1, 100)).flat();
    expect(() => build(tall, { layerHeightMm: 0.05, envelopeX: 1000 })).toThrow(
      /Layer candidate budget/,
    );
  });
  it('worker result rejects commands, malformed report fields and accessors', () => {
    const result = build(box());
    expect(() =>
      validateStlJobResult(
        { ...result, gcode: result.gcode + 'M104 S300\n' },
        { layerHeightMm: 2 },
      ),
    ).toThrow(/command/);
    expect(() =>
      validateStlJobResult(
        { ...result, report: { ...result.report, layerCount: 6 } },
        { layerHeightMm: 2 },
      ),
    ).toThrow(/Incomplete/);
    expect(() =>
      validateStlJobResult(
        { ...result, report: { ...result.report, extra: true } },
        { layerHeightMm: 2 },
      ),
    ).toThrow(/fields/);
    const hostile = {
      report: result.report,
      get gcode() {
        throw new Error('getter executed');
      },
    };
    expect(() => validateStlJobResult(hostile, { layerHeightMm: 2 })).toThrow(/fields/);
    expect(() =>
      validateStlJobResult(
        { ...result, gcode: result.gcode.replace('X10 Y10', 'X9 Y10') },
        { layerHeightMm: 2 },
      ),
    ).toThrow(/match/);
    expect(() =>
      validateStlJobResult(
        { ...result, gcode: result.gcode.replace(/F1200/g, 'F1300') },
        { layerHeightMm: 2 },
      ),
    ).toThrow(/match/);
    expect(
      validateStlJobResult(build(box(), { feedMmMin: 1300 }), {
        feedMmMin: 1300,
        layerHeightMm: 2,
      }),
    ).toBeDefined();
  });
  it('six-decimal artifact precision cannot collapse distinct contour endpoints', () => {
    // Synthetic strict report oracle: raw adjacent distance is 1.385929e-6 mm, above welding epsilon.
    // Both endpoints nevertheless serialize to X0.000001 Y0.000001 at the required precision.
    const result = build(box());
    const points: [number, number][] = [
      [0, 10],
      [0.00000051, 0.00000051],
      [0.00000149, 0.00000149],
      [10, 0],
      [10, 10],
    ];
    const areaMm2 = 99.99999;
    const perimeterMm =
      Math.hypot(0.00000051, 10 - 0.00000051) +
      Math.SQRT2 * 0.00000098 +
      Math.hypot(10 - 0.00000149, 0.00000149) +
      20;
    const report = {
      ...result.report,
      layers: result.report.layers.map((layer) => ({
        ...layer,
        contours: [{ points, depth: 0, hole: false, areaMm2, perimeterMm }],
        outerAreaMm2: areaMm2,
        netAreaMm2: areaMm2,
        perimeterMm,
      })),
    };
    expect(() => serializeStlGcode(report, { layerHeightMm: 2 }, signal())).toThrow(
      /precision|collapse/i,
    );
  });
  it('parent rejects job/report height mismatch', () => {
    expect(() => validateStlJobResult(build(box()), { layerHeightMm: 3 })).toThrow(
      /height|params/i,
    );
  });
  it('parent rejects internally consistent truncated layer artifacts', () => {
    const result = build(box());
    const report = { ...result.report, layerCount: 4, layers: result.report.layers.slice(0, 4) };
    const gcode = result.gcode.slice(0, result.gcode.indexOf('; layer 4'));
    expect(() => validateStlJobResult({ report, gcode }, { layerHeightMm: 2 })).toThrow(
      /count|extent/i,
    );
  });
  it('parent rejects incorrect positive partial-top remainder', () => {
    const result = build(box());
    expect(() =>
      validateStlJobResult(
        { ...result, report: { ...result.report, partialTopMm: 1 } },
        { layerHeightMm: 2 },
      ),
    ).toThrow(/remainder|partial/i);
  });
  it('parent rejects report extent beyond the requested envelope', () => {
    expect(() => validateStlJobResult(build(box()), { layerHeightMm: 2, envelopeX: 5 })).toThrow(
      /envelope|extent/i,
    );
  });
  it('parent rejects vertex count above the triangle-corner bound', () => {
    const result = build(box());
    expect(() =>
      validateStlJobResult(
        { ...result, report: { ...result.report, vertexCount: 37 } },
        { layerHeightMm: 2 },
      ),
    ).toThrow(/vertex|triangle/i);
  });
  it('original notch prism remains unsupported by the reviewed mesh ambiguity policy', () => {
    const triangles = precisionNotchPrism();
    expect(triangles).toHaveLength(16);
    expect(() => parseStl(asciiStl(triangles), { layerHeightMm: 2 }, signal())).toThrow(
      /faces 2 and 14 are ambiguous/,
    );
  });
});
