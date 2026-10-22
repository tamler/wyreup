import type { ParamFieldSchema } from '../types.js';
import { validateUtilityParams, type UtilityParams } from './common.js';

export const STL_LIMITS = Object.freeze({
  inputBytes: 20 * 1024 * 1024,
  triangles: 200000,
  layers: 2000,
  candidates: 10000000,
  segments: 1000000,
  pairs: 2000000,
  outputBytes: 64 * 1024 * 1024,
});
export const STL_EPSILON = 0.000001;
export const stlDefaults = {
  units: 'mm',
  layerHeightMm: 0.2,
  envelopeX: 200,
  envelopeY: 200,
  envelopeZ: 200,
  feedMmMin: 1200,
};
export const stlParamSchema: Record<string, ParamFieldSchema> = {
  units: {
    type: 'enum',
    label: 'STL coordinate units',
    options: [
      { value: 'mm', label: 'Millimetres' },
      { value: 'inches', label: 'Inches' },
    ],
  },
  layerHeightMm: { type: 'number', label: 'Layer height (mm)', min: 0.05, max: 10, step: 0.001 },
  envelopeX: { type: 'number', label: 'Envelope X (mm)', min: 1, max: 1000 },
  envelopeY: { type: 'number', label: 'Envelope Y (mm)', min: 1, max: 1000 },
  envelopeZ: { type: 'number', label: 'Envelope Z (mm)', min: 1, max: 1000 },
  feedMmMin: { type: 'number', label: 'Contour feed (mm/min)', min: 100, max: 10000, step: 1 },
};
export interface StlParams {
  units: 'mm' | 'inches';
  layerHeightMm: number;
  envelopeX: number;
  envelopeY: number;
  envelopeZ: number;
  feedMmMin: number;
}
export type StlPoint = [number, number];
type Vec3 = [number, number, number];
export interface StlContour {
  points: StlPoint[];
  depth: number;
  hole: boolean;
  areaMm2: number;
  perimeterMm: number;
}
export interface StlLayer {
  index: number;
  zMm: number;
  empty: boolean;
  contours: StlContour[];
  outerAreaMm2: number;
  holeAreaMm2: number;
  netAreaMm2: number;
  perimeterMm: number;
}
export interface StlContourReport {
  schema: 1;
  triangleCount: number;
  vertexCount: number;
  translationMm: Vec3;
  extentMm: Vec3;
  layerHeightMm: number;
  layerCount: number;
  partialTopMm: number;
  layers: StlLayer[];
}
export interface StlJobResult {
  report: StlContourReport;
  gcode: string;
}
export interface StlMesh {
  vertices: Float64Array;
  triangles: Uint32Array;
  translationMm: Vec3;
  extentMm: Vec3;
  components: [number, number][];
}

function fail(message: string): never {
  throw new Error(`STL: ${message}`);
}
function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('STL conversion cancelled.', 'AbortError');
}
class Budget {
  pairs = 0;
  candidates = 0;
  segments = 0;
  operations = 0;
  constructor(readonly signal: AbortSignal) {
    aborted(signal);
  }
  tick(): void {
    if ((++this.operations & 1023) === 0) aborted(this.signal);
  }
  pair(): void {
    this.tick();
    if (++this.pairs > STL_LIMITS.pairs) fail('Spatial pair budget exceeded.');
  }
  candidate(): void {
    this.tick();
    if (++this.candidates > STL_LIMITS.candidates) fail('Layer candidate budget exceeded.');
  }
}
export function validateStlParams(provided: UtilityParams): StlParams {
  const p = validateUtilityParams(stlDefaults, stlParamSchema, provided);
  const height = p.layerHeightMm as number;
  if (Math.abs(height * 1000 - Math.round(height * 1000)) > 1e-8)
    fail('Layer height must use whole microns (0.001 mm).');
  return p as unknown as StlParams;
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: Vec3): number {
  return Math.hypot(...a);
}
function point(vertices: Float64Array, id: number): Vec3 {
  return [vertices[id * 3]!, vertices[id * 3 + 1]!, vertices[id * 3 + 2]!];
}
function union(parent: Uint32Array, a: number, b: number): void {
  a = find(parent, a);
  b = find(parent, b);
  if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
}
function find(parent: Uint32Array, a: number): number {
  let root = a;
  while (parent[root] !== root) root = parent[root]!;
  while (parent[a] !== a) {
    const next = parent[a]!;
    parent[a] = root;
    a = next;
  }
  return root;
}
function parents(n: number): Uint32Array {
  return Uint32Array.from({ length: n }, (_, i) => i);
}

function readRaw(bytes: Uint8Array, budget: Budget): Float64Array {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > STL_LIMITS.inputBytes)
    fail('Select one nonempty STL of at most 20 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= 84 ? view.getUint32(80, true) : 0;
  if (bytes.length >= 84 && 84 + count * 50 === bytes.length) {
    if (!count || count > STL_LIMITS.triangles) fail('Triangle count must be 1 through 200,000.');
    const raw = new Float64Array(count * 9);
    for (let t = 0; t < count; t++) {
      budget.tick();
      const offset = 84 + t * 50;
      for (let i = 0; i < 3; i++)
        if (!Number.isFinite(view.getFloat32(offset + i * 4, true))) fail('Nonfinite normal.');
      for (let i = 0; i < 9; i++) raw[t * 9 + i] = view.getFloat32(offset + 12 + i * 4, true);
      // The fixed facet word is metadata, including vendor color bits; no color interpretation.
    }
    return raw;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('Invalid binary length or ASCII encoding.');
  }
  if (/[^\t\n\r -~]/.test(text)) fail('ASCII STL contains unsupported characters.');
  const opening = /^\s*solid(?:[ \t][^\r\n]*)?[\r\n]+/.exec(text);
  if (!opening) fail('Invalid binary length or ASCII solid declaration.');
  const tail = /(?:^|[\r\n])[ \t]*endsolid(?:[ \t][^\r\n]*)?[ \t]*(?:[\r\n][ \t\r\n]*)?$/.exec(
    text,
  );
  if (!tail || tail.index < opening[0].length) fail('Missing ASCII endsolid declaration.');
  const body = text.slice(opening[0].length, tail.index);
  const tokens = /\S+/g;
  const next = (): string => {
    budget.tick();
    return tokens.exec(body)?.[0] ?? '';
  };
  const expect = (word: string) => {
    if (next() !== word) fail(`Expected ASCII ${word}.`);
  };
  const numeric = () => {
    const token = next();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token))
      fail('Invalid ASCII number.');
    const number = Number(token);
    if (!Number.isFinite(number)) fail('Nonfinite ASCII number.');
    return number;
  };
  // Count before allocation; token grammar is checked again while filling.
  const facetToken = /\bfacet\b/g;
  let facets = 0;
  while (facetToken.exec(body)) {
    budget.tick();
    if (++facets > STL_LIMITS.triangles) fail('Triangle count must be 1 through 200,000.');
  }
  if (!facets) fail('Triangle count must be 1 through 200,000.');
  const raw = new Float64Array(facets * 9);
  for (let t = 0; t < facets; t++) {
    expect('facet');
    expect('normal');
    numeric();
    numeric();
    numeric();
    expect('outer');
    expect('loop');
    for (let v = 0; v < 3; v++) {
      expect('vertex');
      for (let axis = 0; axis < 3; axis++) raw[t * 9 + v * 3 + axis] = numeric();
    }
    expect('endloop');
    expect('endfacet');
  }
  if (next()) fail('Trailing ASCII tokens.');
  return raw;
}

function weld3(
  raw: Float64Array,
  budget: Budget,
): { vertices: Float64Array; triangles: Uint32Array } {
  const count = raw.length / 3,
    order = Uint32Array.from({ length: count }, (_, i) => i);
  order.sort(
    (a, b) =>
      raw[a * 3]! - raw[b * 3]! ||
      raw[a * 3 + 1]! - raw[b * 3 + 1]! ||
      raw[a * 3 + 2]! - raw[b * 3 + 2]! ||
      a - b,
  );
  aborted(budget.signal);
  const vertices = new Float64Array(raw.length),
    triangles = new Uint32Array(count);
  const bins = new Map<string, number[]>();
  let unique = 0;
  for (const id of order) {
    budget.tick();
    const p = point(raw, id),
      cell = p.map((x) => Math.floor(x / STL_EPSILON));
    let selected = -1;
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          const list = bins.get(`${cell[0]! + x},${cell[1]! + y},${cell[2]! + z}`);
          if (!list) continue;
          for (const candidate of list) {
            budget.pair();
            if (
              norm(sub(p, point(vertices, candidate))) <= STL_EPSILON &&
              (selected < 0 || candidate < selected)
            )
              selected = candidate;
          }
        }
    if (selected < 0) {
      selected = unique++;
      vertices.set(p, selected * 3);
      const key = cell.join(','),
        list = bins.get(key);
      if (list) list.push(selected);
      else bins.set(key, [selected]);
    }
    triangles[id] = selected;
  }
  return { vertices: vertices.subarray(0, unique * 3), triangles };
}

function topology(
  vertices: Float64Array,
  triangles: Uint32Array,
  budget: Budget,
): [number, number][] {
  const n = triangles.length / 3,
    cornerParents = parents(triangles.length),
    componentParents = parents(n);
  const edges = new Map<string, { corner: number; count: number }>(),
    duplicates = new Set<string>();
  for (let t = 0; t < n; t++) {
    budget.tick();
    const ids = [triangles[t * 3]!, triangles[t * 3 + 1]!, triangles[t * 3 + 2]!];
    if (
      new Set(ids).size !== 3 ||
      norm(
        cross(
          sub(point(vertices, ids[1]!), point(vertices, ids[0]!)),
          sub(point(vertices, ids[2]!), point(vertices, ids[0]!)),
        ),
      ) === 0
    )
      fail('Degenerate triangle.');
    const face = [...ids].sort((a, b) => a - b).join(',');
    if (duplicates.has(face)) fail('Duplicate triangle.');
    duplicates.add(face);
    for (let e = 0; e < 3; e++) {
      const corner = t * 3 + e,
        end = t * 3 + ((e + 1) % 3),
        a = triangles[corner]!,
        b = triangles[end]!;
      const key = `${Math.min(a, b)},${Math.max(a, b)}`,
        previous = edges.get(key);
      if (!previous) edges.set(key, { corner, count: 1 });
      else {
        if (++previous.count !== 2) fail('Nonmanifold edge.');
        const pc = previous.corner,
          pe = Math.floor(pc / 3) * 3 + (((pc % 3) + 1) % 3);
        if (triangles[pc] !== b || triangles[pe] !== a) fail('Inconsistent face orientation.');
        union(cornerParents, corner, pe);
        union(cornerParents, end, pc);
        union(componentParents, t, Math.floor(pc / 3));
      }
    }
  }
  for (const edge of edges.values())
    if (edge.count !== 2) fail('Open mesh edge; no repair is performed.');
  const vertexRoots = new Int32Array(vertices.length / 3).fill(-1);
  for (let c = 0; c < triangles.length; c++) {
    budget.tick();
    const v = triangles[c]!,
      root = find(cornerParents, c);
    if (vertexRoots[v] === -1) vertexRoots[v] = root;
    else if (vertexRoots[v] !== root) fail('Nonmanifold disconnected vertex fan.');
  }
  const ranges = new Map<number, [number, number]>();
  for (let t = 0; t < n; t++) {
    budget.tick();
    const root = find(componentParents, t),
      range = ranges.get(root) ?? [Infinity, -Infinity];
    for (let v = 0; v < 3; v++) {
      const z = vertices[triangles[t * 3 + v]! * 3 + 2]!;
      range[0] = Math.min(range[0], z);
      range[1] = Math.max(range[1], z);
    }
    ranges.set(root, range);
  }
  return [...ranges.values()];
}

function orient(a: StlPoint, b: StlPoint, c: StlPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function distanceToSegment(p: StlPoint, a: StlPoint, b: StlPoint): number {
  const x = b[0] - a[0],
    y = b[1] - a[1],
    d = x * x + y * y;
  const t = d ? Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / d)) : 0;
  return Math.hypot(p[0] - a[0] - t * x, p[1] - a[1] - t * y);
}
function segmentsTouch(a: StlPoint, b: StlPoint, c: StlPoint, d: StlPoint): boolean {
  if (
    Math.max(a[0], b[0]) + STL_EPSILON < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) + STL_EPSILON < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) + STL_EPSILON < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) + STL_EPSILON < Math.min(a[1], b[1])
  )
    return false;
  const o1 = orient(a, b, c),
    o2 = orient(a, b, d),
    o3 = orient(c, d, a),
    o4 = orient(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (
    Math.min(
      distanceToSegment(a, c, d),
      distanceToSegment(b, c, d),
      distanceToSegment(c, a, b),
      distanceToSegment(d, a, b),
    ) <= STL_EPSILON
  );
}
function inside(p: StlPoint, loop: StlPoint[], budget?: Budget): boolean {
  let yes = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    budget?.pair();
    const a = loop[i]!,
      b = loop[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
function planeSection(tri: Vec3[], normal: Vec3, offset: number): Vec3[] {
  const result: Vec3[] = [];
  const add = (p: Vec3) => {
    if (!result.some((q) => norm(sub(p, q)) <= STL_EPSILON)) result.push(p);
  };
  const ds = tri.map((p) => dot(p, normal) - offset);
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3,
      a = tri[i]!,
      b = tri[j]!,
      da = ds[i]!,
      db = ds[j]!;
    if (Math.abs(da) <= STL_EPSILON) add(a);
    if ((da > STL_EPSILON && db < -STL_EPSILON) || (db > STL_EPSILON && da < -STL_EPSILON)) {
      const t = da / (da - db);
      add([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
    }
  }
  return result;
}
function badTriangleIntersection(a: Vec3[], b: Vec3[], shared: Vec3[]): boolean {
  const an = cross(sub(a[1]!, a[0]!), sub(a[2]!, a[0]!)),
    bn = cross(sub(b[1]!, b[0]!), sub(b[2]!, b[0]!));
  const na = an.map((v) => v / norm(an)) as Vec3,
    nb = bn.map((v) => v / norm(bn)) as Vec3;
  const da = dot(na, a[0]!),
    db = dot(nb, b[0]!),
    direction = cross(na, nb);
  if (norm(direction) < 1e-12) {
    if (Math.abs(dot(na, b[0]!) - da) > STL_EPSILON) return false;
    const axis = na.map(Math.abs).indexOf(Math.max(...na.map(Math.abs)));
    const project = (p: Vec3): StlPoint =>
      axis === 0 ? [p[1], p[2]] : axis === 1 ? [p[0], p[2]] : [p[0], p[1]];
    const aa = a.map(project),
      bb = b.map(project),
      ss = shared.map(project);
    if (shared.length === 2) {
      const av = aa.find(
        (p) => !ss.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= STL_EPSILON),
      )!;
      const bv = bb.find(
        (p) => !ss.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= STL_EPSILON),
      )!;
      return orient(ss[0]!, ss[1]!, av) * orient(ss[0]!, ss[1]!, bv) >= 0;
    }
    for (const p of aa)
      if (!ss.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= STL_EPSILON) && inside(p, bb))
        return true;
    for (const p of bb)
      if (!ss.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= STL_EPSILON) && inside(p, aa))
        return true;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const a0 = aa[i]!,
          a1 = aa[(i + 1) % 3]!,
          b0 = bb[j]!,
          b1 = bb[(j + 1) % 3]!;
        if (!segmentsTouch(a0, a1, b0, b1)) continue;
        if (
          ss.length !== 1 ||
          distanceToSegment(ss[0]!, a0, a1) > STL_EPSILON ||
          distanceToSegment(ss[0]!, b0, b1) > STL_EPSILON
        )
          return true;
        if (
          orient(a0, a1, b0) * orient(a0, a1, b1) < 0 &&
          orient(b0, b1, a0) * orient(b0, b1, a1) < 0
        )
          return true;
        // Collinear edges meeting at their shared vertex may not overlap beyond it.
        const tolerance = STL_EPSILON * Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
        if (
          Math.abs(orient(a0, a1, b0)) <= tolerance &&
          Math.abs(orient(a0, a1, b1)) <= tolerance
        ) {
          const p = ss[0]!,
            av = Math.hypot(a0[0] - p[0], a0[1] - p[1]) > STL_EPSILON ? a0 : a1;
          const bv = Math.hypot(b0[0] - p[0], b0[1] - p[1]) > STL_EPSILON ? b0 : b1;
          if ((av[0] - p[0]) * (bv[0] - p[0]) + (av[1] - p[1]) * (bv[1] - p[1]) > 0) return true;
        }
      }
    return false;
  }
  const sa = planeSection(a, nb, db),
    sb = planeSection(b, na, da);
  if (!sa.length || !sb.length) return false;
  const unit = direction.map((v) => v / norm(direction)) as Vec3;
  const ai = sa.map((p) => dot(p, unit)),
    bi = sb.map((p) => dot(p, unit));
  const lo = Math.max(Math.min(...ai), Math.min(...bi)),
    hi = Math.min(Math.max(...ai), Math.max(...bi));
  if (hi < lo - STL_EPSILON) return false;
  if (shared.length === 2) {
    const si = shared.map((p) => dot(p, unit));
    return lo < Math.min(...si) - STL_EPSILON || hi > Math.max(...si) + STL_EPSILON;
  }
  if (shared.length === 1) {
    const s = dot(shared[0]!, unit);
    return lo < s - STL_EPSILON || hi > s + STL_EPSILON;
  }
  return true;
}
function intersections(vertices: Float64Array, triangles: Uint32Array, budget: Budget): void {
  const n = triangles.length / 3,
    bounds = new Float64Array(n * 6),
    order = Uint32Array.from({ length: n }, (_, i) => i);
  for (let t = 0; t < n; t++) {
    budget.tick();
    for (let axis = 0; axis < 3; axis++) {
      const vals = [0, 1, 2].map((v) => vertices[triangles[t * 3 + v]! * 3 + axis]!);
      bounds[t * 6 + axis] = Math.min(...vals);
      bounds[t * 6 + 3 + axis] = Math.max(...vals);
    }
  }
  order.sort((a, b) => bounds[a * 6]! - bounds[b * 6]! || a - b);
  aborted(budget.signal);
  const active: number[] = [];
  for (const t of order) {
    budget.tick();
    let kept = 0;
    for (const other of active) {
      budget.pair();
      if (bounds[other * 6 + 3]! + STL_EPSILON < bounds[t * 6]!) continue;
      active[kept++] = other;
      if (
        bounds[other * 6 + 4]! + STL_EPSILON < bounds[t * 6 + 1]! ||
        bounds[t * 6 + 4]! + STL_EPSILON < bounds[other * 6 + 1]! ||
        bounds[other * 6 + 5]! + STL_EPSILON < bounds[t * 6 + 2]! ||
        bounds[t * 6 + 5]! + STL_EPSILON < bounds[other * 6 + 2]!
      )
        continue;
      const ids = [0, 1, 2].map((v) => triangles[t * 3 + v]!),
        oids = [0, 1, 2].map((v) => triangles[other * 3 + v]!);
      const shared = ids.filter((id) => oids.includes(id)).map((id) => point(vertices, id));
      if (
        badTriangleIntersection(
          ids.map((id) => point(vertices, id)),
          oids.map((id) => point(vertices, id)),
          shared,
        )
      )
        fail(`Intersecting or touching mesh faces ${other} and ${t} are ambiguous.`);
    }
    active.length = kept;
    active.push(t);
  }
}

function parseWithBudget(bytes: Uint8Array, params: StlParams, budget: Budget): StlMesh {
  const raw = readRaw(bytes, budget),
    scale = params.units === 'inches' ? 25.4 : 1;
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < raw.length; i++) {
    budget.tick();
    const value = raw[i]! * scale;
    if (!Number.isFinite(value) || Math.abs(value) > 100000)
      fail('Scaled coordinates must be finite and within ±100,000 mm.');
    raw[i] = value;
    const a = i % 3;
    min[a] = Math.min(min[a]!, value);
    max[a] = Math.max(max[a]!, value);
  }
  const extent = max.map((v, i) => v - min[i]!) as Vec3;
  const envelopes = [params.envelopeX, params.envelopeY, params.envelopeZ];
  if (extent.some((v, i) => v > 1000 || v > envelopes[i]!))
    fail('Mesh extent exceeds the selected envelope.');
  for (let i = 0; i < raw.length; i++) {
    budget.tick();
    raw[i] = raw[i]! - min[i % 3]!;
  }
  const { vertices, triangles } = weld3(raw, budget),
    components = topology(vertices, triangles, budget);
  intersections(vertices, triangles, budget);
  aborted(budget.signal);
  return {
    vertices,
    triangles,
    translationMm: min.map((v) => (v === 0 ? 0 : -v)) as Vec3,
    extentMm: extent,
    components,
  };
}
export function parseStl(bytes: Uint8Array, provided: UtilityParams, signal: AbortSignal): StlMesh {
  return parseWithBudget(bytes, validateStlParams(provided), new Budget(signal));
}

function area(points: StlPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}
function perimeter(points: StlPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    sum += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return sum;
}
function comparePoint(a: StlPoint, b: StlPoint): number {
  return a[0] - b[0] || a[1] - b[1];
}
function canonical(points: StlPoint[], budget: Budget): StlPoint[] {
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    const next: StlPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      budget.pair();
      const p = points[i]!,
        a = points[(i + points.length - 1) % points.length]!,
        b = points[(i + 1) % points.length]!;
      // Remove one at a time so simultaneous removal cannot erase an entire straight side.
      if (!changed && distanceToSegment(p, a, b) <= STL_EPSILON) {
        changed = true;
        continue;
      }
      next.push(p);
    }
    points = next;
  }
  const signed = area(points);
  if (Math.abs(signed) <= STL_EPSILON * STL_EPSILON) fail('Degenerate contour.');
  if (signed < 0) points.reverse();
  let start = 0;
  for (let i = 1; i < points.length; i++)
    if (comparePoint(points[i]!, points[start]!) < 0) start = i;
  return [...points.slice(start), ...points.slice(0, start)];
}
function loopsFromSegments(segments: [StlPoint, StlPoint][], budget: Budget): StlContour[] {
  const flat = segments.flat(),
    order = Uint32Array.from({ length: flat.length }, (_, i) => i);
  order.sort((a, b) => comparePoint(flat[a]!, flat[b]!) || a - b);
  aborted(budget.signal);
  const nodes: StlPoint[] = [],
    ids = new Uint32Array(flat.length),
    bins = new Map<string, number[]>();
  for (const id of order) {
    budget.tick();
    const p = flat[id]!,
      x = Math.floor(p[0] / STL_EPSILON),
      y = Math.floor(p[1] / STL_EPSILON);
    let chosen = -1;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const candidate of bins.get(`${x + dx},${y + dy}`) ?? []) {
          budget.pair();
          const q = nodes[candidate]!;
          if (
            Math.hypot(p[0] - q[0], p[1] - q[1]) <= STL_EPSILON &&
            (chosen < 0 || candidate < chosen)
          )
            chosen = candidate;
        }
    if (chosen < 0) {
      chosen = nodes.length;
      nodes.push(p);
      const key = `${x},${y}`,
        list = bins.get(key);
      if (list) list.push(chosen);
      else bins.set(key, [chosen]);
    }
    ids[id] = chosen;
  }
  const edges = new Set<string>(),
    adj: number[][] = Array.from({ length: nodes.length }, () => []);
  for (let i = 0; i < segments.length; i++) {
    budget.tick();
    const a = ids[i * 2]!,
      b = ids[i * 2 + 1]!;
    if (a === b) fail('Degenerate contour segment.');
    const key = `${Math.min(a, b)},${Math.max(a, b)}`;
    if (edges.has(key)) continue;
    edges.add(key);
    adj[a]!.push(b);
    adj[b]!.push(a);
  }
  if (adj.some((neighbors) => neighbors.length !== 2))
    fail('Contour is open or branches; no repair is performed.');
  const visited = new Uint8Array(nodes.length),
    loops: StlPoint[][] = [];
  for (let start = 0; start < nodes.length; start++) {
    if (visited[start]) continue;
    const loop: StlPoint[] = [];
    let previous = -1,
      current = start;
    do {
      budget.tick();
      if (visited[current]) fail('Contour revisits a vertex.');
      visited[current] = 1;
      loop.push(nodes[current]!);
      const neighbors = adj[current]!,
        next = neighbors[0] === previous ? neighbors[1]! : neighbors[0]!;
      previous = current;
      current = next;
    } while (current !== start);
    if (loop.length < 3) fail('Contour has fewer than three vertices.');
    loops.push(loop);
  }
  // Validate intersections before simplifying or assigning nesting.
  const lines = loops.flatMap((loop, l) =>
    loop.map((p, i) => ({ p, q: loop[(i + 1) % loop.length]!, l, i, n: loop.length })),
  );
  lines.sort((a, b) => Math.min(a.p[0], a.q[0]) - Math.min(b.p[0], b.q[0]));
  const active: typeof lines = [];
  for (const line of lines) {
    let kept = 0;
    for (const other of active) {
      budget.pair();
      if (Math.max(other.p[0], other.q[0]) + STL_EPSILON < Math.min(line.p[0], line.q[0])) continue;
      active[kept++] = other;
      if (
        other.l === line.l &&
        (Math.abs(other.i - line.i) === 1 || Math.abs(other.i - line.i) === line.n - 1)
      )
        continue;
      if (segmentsTouch(line.p, line.q, other.p, other.q))
        fail('Intersecting or touching contour boundaries.');
    }
    active.length = kept;
    active.push(line);
  }
  const result = loops.map((loop) => ({
    points: canonical(loop, budget),
    depth: 0,
    hole: false,
    areaMm2: 0,
    perimeterMm: 0,
  }));
  for (let i = 0; i < result.length; i++) {
    const contour = result[i]!;
    for (let j = 0; j < result.length; j++) {
      if (i === j) continue;
      if (inside(contour.points[0]!, result[j]!.points, budget)) contour.depth++;
    }
    contour.hole = contour.depth % 2 === 1;
    contour.areaMm2 = area(contour.points);
    contour.perimeterMm = perimeter(contour.points);
  }
  result.sort(
    (a, b) =>
      comparePoint(a.points[0]!, b.points[0]!) ||
      a.areaMm2 - b.areaMm2 ||
      compareSequences(a.points, b.points),
  );
  return result;
}
function compareSequences(a: StlPoint[], b: StlPoint[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = comparePoint(a[i]!, b[i]!);
    if (order) return order;
  }
  return a.length - b.length;
}
function sliceWithBudget(mesh: StlMesh, params: StlParams, budget: Budget): StlContourReport {
  const h = Math.round(params.layerHeightMm * 1000),
    extentMicrons = Math.floor(mesh.extentMm[2] * 1000 + 1e-6),
    count = Math.floor(extentMicrons / h);
  if (count < 1 || count > STL_LIMITS.layers)
    fail('Full-height layer count must be 1 through 2,000.');
  const n = mesh.triangles.length / 3,
    first = new Int32Array(n),
    last = new Int32Array(n),
    counts = new Uint32Array(count);
  let total = 0;
  for (let t = 0; t < n; t++) {
    budget.tick();
    const zs = [0, 1, 2].map((v) => mesh.vertices[mesh.triangles[t * 3 + v]! * 3 + 2]!);
    first[t] = Math.max(0, Math.ceil((Math.min(...zs) - STL_EPSILON) / params.layerHeightMm - 0.5));
    last[t] = Math.min(
      count - 1,
      Math.floor((Math.max(...zs) + STL_EPSILON) / params.layerHeightMm - 0.5),
    );
    total += Math.max(0, last[t]! - first[t]! + 1);
    if (total > STL_LIMITS.candidates) fail('Layer candidate budget exceeded.');
    for (let layer = first[t]!; layer <= last[t]!; layer++) {
      budget.tick();
      counts[layer] = counts[layer]! + 1;
    }
  }
  const offsets = new Uint32Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i]! + counts[i]!;
  const candidates = new Uint32Array(total),
    cursor = offsets.slice(0, count);
  for (let t = 0; t < n; t++)
    for (let layer = first[t]!; layer <= last[t]!; layer++) {
      budget.tick();
      candidates[cursor[layer]!] = t;
      cursor[layer] = cursor[layer]! + 1;
    }
  const layers: StlLayer[] = [];
  for (let index = 0; index < count; index++) {
    aborted(budget.signal);
    const z = ((2 * index + 1) * h) / 2000,
      segments: [StlPoint, StlPoint][] = [];
    for (let c = offsets[index]!; c < offsets[index + 1]!; c++) {
      budget.candidate();
      const t = candidates[c]!,
        tri = [0, 1, 2].map((v) => point(mesh.vertices, mesh.triangles[t * 3 + v]!));
      if (tri.every((p) => Math.abs(p[2] - z) <= STL_EPSILON)) continue;
      const upper = tri.map((p) => p[2] > z + STL_EPSILON),
        ends: StlPoint[] = [];
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        if (upper[i] === upper[j]) continue;
        const a = tri[i]!,
          b = tri[j]!;
        if (Math.abs(a[2] - z) <= STL_EPSILON) ends.push([a[0], a[1]]);
        else if (Math.abs(b[2] - z) <= STL_EPSILON) ends.push([b[0], b[1]]);
        else {
          const f = (z - a[2]) / (b[2] - a[2]);
          ends.push([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]);
        }
      }
      if (!ends.length) continue;
      if (ends.length !== 2) fail('Ambiguous triangle-plane intersection.');
      if (Math.hypot(ends[0]![0] - ends[1]![0], ends[0]![1] - ends[1]![1]) <= STL_EPSILON) continue;
      if (++budget.segments > STL_LIMITS.segments) fail('Raw contour segment budget exceeded.');
      segments.push([ends[0]!, ends[1]!]);
    }
    if (
      !segments.length &&
      mesh.components.some(([min, max]) => z >= min - STL_EPSILON && max > z + STL_EPSILON)
    )
      fail('Layer has no closed material contour.');
    const contours = segments.length ? loopsFromSegments(segments, budget) : [];
    const outer = contours.filter((c) => !c.hole).reduce((sum, c) => sum + c.areaMm2, 0),
      holes = contours.filter((c) => c.hole).reduce((sum, c) => sum + c.areaMm2, 0);
    layers.push({
      index,
      zMm: z,
      empty: !contours.length,
      contours,
      outerAreaMm2: outer,
      holeAreaMm2: holes,
      netAreaMm2: outer - holes,
      perimeterMm: contours.reduce((sum, c) => sum + c.perimeterMm, 0),
    });
  }
  aborted(budget.signal);
  return {
    schema: 1,
    triangleCount: n,
    vertexCount: mesh.vertices.length / 3,
    translationMm: mesh.translationMm,
    extentMm: mesh.extentMm,
    layerHeightMm: params.layerHeightMm,
    layerCount: count,
    partialTopMm: Math.max(0, mesh.extentMm[2] - (count * h) / 1000),
    layers,
  };
}
export function sliceStlContours(
  mesh: StlMesh,
  provided: UtilityParams,
  signal: AbortSignal,
): StlContourReport {
  return sliceWithBudget(mesh, validateStlParams(provided), new Budget(signal));
}
function formatted(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > 100000) fail('Invalid artifact coordinate.');
  return (Math.abs(value) < 0.0000005 ? 0 : value).toFixed(6).replace(/\.?0+$/, '');
}
export function serializeStlGcode(
  report: StlContourReport,
  provided: UtilityParams,
  signal: AbortSignal,
): string {
  const params = validateStlParams(provided),
    budget = new Budget(signal);
  validateReport(report);
  let length = 0;
  const lines: string[] = [];
  const add = (line: string) => {
    budget.tick();
    length += line.length + 1;
    if (length > STL_LIMITS.outputBytes) fail('G-code exceeds 64 MiB.');
    lines.push(line);
  };
  add('; contour preview only');
  add('; no extrusion, heaters or homing');
  add('G21');
  add('G90');
  for (const layer of report.layers) {
    add(`; layer ${layer.index}`);
    add(`G0 Z${formatted(layer.zMm)}`);
    if (layer.empty) {
      add('; empty layer');
      continue;
    }
    for (const contour of layer.contours) {
      const first = contour.points[0]!;
      add(`G0 X${formatted(first[0])} Y${formatted(first[1])}`);
      for (let i = 1; i <= contour.points.length; i++) {
        const p = contour.points[i % contour.points.length]!;
        add(`G1 X${formatted(p[0])} Y${formatted(p[1])} F${params.feedMmMin}`);
      }
    }
  }
  aborted(signal);
  return `${lines.join('\n')}\n`;
}
export function buildStlContours(
  bytes: Uint8Array,
  provided: UtilityParams,
  signal: AbortSignal,
): StlJobResult {
  const params = validateStlParams(provided),
    budget = new Budget(signal),
    mesh = parseWithBudget(bytes, params, budget);
  const report = sliceWithBudget(mesh, params, budget),
    gcode = serializeStlGcode(report, params as unknown as UtilityParams, signal);
  aborted(signal);
  return { report, gcode };
}

function dataObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('Invalid worker report object.');
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail('Invalid worker report prototype.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((k) => !descriptors[k] || !('value' in descriptors[k]) || !descriptors[k].enumerable)
  )
    fail('Invalid worker report fields.');
  return value as Record<string, unknown>;
}
function dataArray(value: unknown, max: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    fail('Invalid worker report array.');
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable) fail('Invalid worker report array item.');
  }
  return value as unknown[];
}
function finite(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    fail('Invalid worker report number.');
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  const n = finite(value, min, max);
  if (!Number.isInteger(n)) fail('Invalid worker report integer.');
  return n;
}
function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(STL_EPSILON, Math.abs(b) * 1e-10);
}
function validateReport(value: unknown): StlContourReport {
  const r = dataObject(value, [
    'schema',
    'triangleCount',
    'vertexCount',
    'translationMm',
    'extentMm',
    'layerHeightMm',
    'layerCount',
    'partialTopMm',
    'layers',
  ]);
  if (r.schema !== 1) fail('Invalid report version.');
  integer(r.triangleCount, 1, STL_LIMITS.triangles);
  integer(r.vertexCount, 4, STL_LIMITS.triangles * 3);
  if ((r.vertexCount as number) > (r.triangleCount as number) * 3)
    fail('Vertex count exceeds triangle-corner bound.');
  for (const key of ['translationMm', 'extentMm']) {
    const v = dataArray(r[key], 3);
    if (v.length !== 3) fail('Invalid report vector.');
    for (const n of v)
      finite(n, key === 'extentMm' ? 0 : -100000, key === 'extentMm' ? 1000 : 100000);
  }
  const height = finite(r.layerHeightMm, 0.05, 10),
    count = integer(r.layerCount, 1, STL_LIMITS.layers);
  finite(r.partialTopMm, 0, height);
  if (Math.abs(height * 1000 - Math.round(height * 1000)) > 1e-8)
    fail('Invalid report layer quantum.');
  const extent = r.extentMm as Vec3;
  const quantum = Math.round(height * 1000);
  const expectedCount = Math.floor(Math.floor(extent[2] * 1000 + 1e-6) / quantum);
  const remainder = Math.max(0, extent[2] - (count * quantum) / 1000);
  const layers = dataArray(r.layers, STL_LIMITS.layers);
  if (layers.length !== count) fail('Incomplete all-layer report.');
  if (count !== expectedCount) fail('Layer count does not match report extent.');
  if (!close(r.partialTopMm as number, remainder)) fail('Invalid partial-top remainder.');
  let points = 0;
  for (let index = 0; index < layers.length; index++) {
    const layer = dataObject(layers[index], [
      'index',
      'zMm',
      'empty',
      'contours',
      'outerAreaMm2',
      'holeAreaMm2',
      'netAreaMm2',
      'perimeterMm',
    ]);
    if (
      layer.index !== index ||
      !close(finite(layer.zMm, 0, 1000), ((2 * index + 1) * Math.round(height * 1000)) / 2000)
    )
      fail('Invalid layer plane/order.');
    const contours = dataArray(layer.contours, STL_LIMITS.segments);
    if (layer.empty !== !contours.length) fail('Invalid empty layer flag.');
    let outer = 0,
      holes = 0,
      length = 0;
    for (const value of contours) {
      const contour = dataObject(value, ['points', 'depth', 'hole', 'areaMm2', 'perimeterMm']),
        raw = dataArray(contour.points, STL_LIMITS.segments);
      points += raw.length;
      if (raw.length < 3 || points > STL_LIMITS.segments) fail('Contour point budget exceeded.');
      const loop: StlPoint[] = raw.map((p) => {
        const xy = dataArray(p, 2);
        if (xy.length !== 2) fail('Invalid contour point.');
        return [finite(xy[0], 0, 1000), finite(xy[1], 0, 1000)];
      });
      const depth = integer(contour.depth, 0, STL_LIMITS.segments);
      if (
        loop.some((point, i) => {
          const next = loop[(i + 1) % loop.length]!;
          return (
            formatted(point[0]) === formatted(next[0]) && formatted(point[1]) === formatted(next[1])
          );
        })
      )
        fail('Contour endpoints collapse at artifact precision.');
      if (contour.hole !== (depth % 2 === 1)) fail('Invalid contour nesting.');
      const a = finite(contour.areaMm2, 0, 1000000),
        p = finite(contour.perimeterMm, 0, STL_LIMITS.segments * 1500);
      if (
        a <= 0 ||
        !close(a, area(loop)) ||
        !close(p, perimeter(loop)) ||
        loop.some(
          (point, i) =>
            comparePoint(point, loop[0]!) < 0 ||
            Math.hypot(
              point[0] - loop[(i + 1) % loop.length]![0],
              point[1] - loop[(i + 1) % loop.length]![1],
            ) <= STL_EPSILON,
        )
      )
        fail('Invalid canonical contour metrics.');
      if (contour.hole) holes += a;
      else outer += a;
      length += p;
    }
    if (
      !close(finite(layer.outerAreaMm2, 0, STL_LIMITS.segments * 1000000), outer) ||
      !close(finite(layer.holeAreaMm2, 0, STL_LIMITS.segments * 1000000), holes) ||
      !close(finite(layer.netAreaMm2, 0, STL_LIMITS.segments * 1000000), outer - holes) ||
      !close(finite(layer.perimeterMm, 0, STL_LIMITS.segments * 1500), length)
    )
      fail('Invalid layer totals.');
  }
  return value as StlContourReport;
}
export function validateStlJobResult(value: unknown, provided: UtilityParams = {}): StlJobResult {
  const result = dataObject(value, ['report', 'gcode']);
  if (
    typeof result.gcode !== 'string' ||
    result.gcode.length > STL_LIMITS.outputBytes ||
    /[^\n -~]/.test(result.gcode)
  )
    fail('Invalid bounded G-code artifact.');
  const report = validateReport(result.report),
    params = validateStlParams(provided);
  if (report.layerHeightMm !== params.layerHeightMm)
    fail('Report height does not match job params.');
  if (
    report.extentMm.some(
      (extent, axis) => extent > [params.envelopeX, params.envelopeY, params.envelopeZ][axis]!,
    )
  )
    fail('Report extent exceeds requested envelope.');
  // Compare each returned command to its report movement without generating a second artifact.
  const gcode = result.gcode;
  let position = 0;
  const line = (expected: string) => {
    const end = gcode.indexOf('\n', position);
    if (end < 0 || end - position !== expected.length || !gcode.startsWith(expected, position))
      fail('Artifact command does not match the all-layer report.');
    position = end + 1;
  };
  line('; contour preview only');
  line('; no extrusion, heaters or homing');
  line('G21');
  line('G90');
  for (const layer of report.layers) {
    line(`; layer ${layer.index}`);
    line(`G0 Z${formatted(layer.zMm)}`);
    if (layer.empty) {
      line('; empty layer');
      continue;
    }
    for (const contour of layer.contours) {
      const first = contour.points[0]!;
      line(`G0 X${formatted(first[0])} Y${formatted(first[1])}`);
      for (let i = 1; i <= contour.points.length; i++) {
        const p = contour.points[i % contour.points.length]!;
        line(`G1 X${formatted(p[0])} Y${formatted(p[1])} F${params.feedMmMin}`);
      }
    }
  }
  if (position !== gcode.length) fail('Extra artifact commands or trailing data.');
  return value as StlJobResult;
}
