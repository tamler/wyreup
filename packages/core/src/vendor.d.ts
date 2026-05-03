// Minimal ambient declarations for packages without bundled types.

declare module 'culori' {
  export type Color = Record<string, unknown> & { mode: string };

  export function parse(color: string): Color | undefined;
  export function formatHex(color: Color | undefined): string | undefined;
  export function formatRgb(color: Color | undefined): string | undefined;
  export function formatHsl(color: Color | undefined): string | undefined;
  export function converter(mode: string): (color: Color | undefined) => Color | undefined;
}

declare module 'diff' {
  export function createTwoFilesPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: { context?: number },
  ): string;
}

declare module 'text-readability' {
  interface ReadabilityInstance {
    fleschReadingEase(text: string): number;
    fleschKincaidGrade(text: string): number;
    colemanLiauIndex(text: string): number;
    smogIndex(text: string): number;
    automatedReadabilityIndex(text: string): number;
    daleChallReadabilityScore(text: string): number;
    gunningFog(text: string): number;
    textStandard(text: string): string;
  }
  const readability: ReadabilityInstance;
  export default readability;
}

declare module 'shpjs' {
  interface ShpFeatureCollection {
    type: 'FeatureCollection';
    features: unknown[];
    fileName?: string;
  }
  // shpjs's default export accepts an ArrayBuffer (raw zip bytes) or a URL
  // string. We only use the buffer form. Returns one collection or an
  // array when the zip contains multiple shapefiles.
  function shp(buf: ArrayBuffer): Promise<ShpFeatureCollection | ShpFeatureCollection[]>;
  export default shp;
}
