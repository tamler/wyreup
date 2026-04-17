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
