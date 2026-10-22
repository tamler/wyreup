// Original geometry fixtures. The oracle dimensions are independent of the STL parser/slicer.
export type FixturePoint = [number, number, number];
export type FixtureTriangle = [FixturePoint, FixturePoint, FixturePoint];
const quad = (
  a: FixturePoint,
  b: FixturePoint,
  c: FixturePoint,
  d: FixturePoint,
): FixtureTriangle[] => [
  [a, b, c],
  [a, c, d],
];
export function box(x0 = 0, y0 = 0, z0 = 0, x1 = 10, y1 = 10, z1 = 10): FixtureTriangle[] {
  const p: FixturePoint[] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  return [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ].flatMap(([a, b, c, d]) => quad(p[a!]!, p[b!]!, p[c!]!, p[d!]!));
}
export function hollowBox(): FixtureTriangle[] {
  const outer: FixturePoint[] = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [0, 10, 0],
    ],
    inner: FixturePoint[] = [
      [3, 3, 0],
      [7, 3, 0],
      [7, 7, 0],
      [3, 7, 0],
    ];
  const top = (p: FixturePoint): FixturePoint => [p[0], p[1], 10];
  const triangles: FixtureTriangle[] = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4,
      a = outer[i]!,
      b = outer[j]!,
      c = inner[i]!,
      d = inner[j]!;
    triangles.push(
      ...quad(a, b, top(b), top(a)),
      ...quad(d, c, top(c), top(d)),
      ...quad(top(a), top(b), top(d), top(c)),
      ...quad(b, a, c, d),
    );
  }
  return triangles;
}
export function precisionNotchPrism(): FixtureTriangle[] {
  const ring: FixturePoint[] = [
    [0.00000051, 0.00000051, 0],
    [0.00000149, 0.00000149, 0],
    [10, 0, 0],
    [10, 10, 0],
    [0, 10, 0],
  ];
  const top = (p: FixturePoint): FixturePoint => [p[0], p[1], 10];
  const triangles: FixtureTriangle[] = [];
  for (const [a, b, c] of [
    [0, 1, 4],
    [1, 3, 4],
    [1, 2, 3],
  ]) {
    triangles.push(
      [ring[c!]!, ring[b!]!, ring[a!]!],
      [top(ring[a!]!), top(ring[b!]!), top(ring[c!]!)],
    );
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!,
      b = ring[(i + 1) % ring.length]!;
    triangles.push(...quad(a, b, top(b), top(a)));
  }
  return triangles;
}
export function asciiStl(triangles: FixtureTriangle[]): Uint8Array {
  return new TextEncoder().encode(
    `solid original\n${triangles.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((p) => `vertex ${p.join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n')}\nendsolid original\n`,
  );
}
export function binaryStl(
  triangles: FixtureTriangle[],
  header = 'original Wyreup fixture',
): Uint8Array {
  const bytes = new Uint8Array(84 + triangles.length * 50),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(header).subarray(0, 80));
  view.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) =>
    t.flat().forEach((n, j) => view.setFloat32(84 + i * 50 + 12 + j * 4, n, true)),
  );
  return bytes;
}
