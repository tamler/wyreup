import { cloneUtilityJson } from '@wyreup/core/execution';

export interface GradientView {
  css: string;
  firstPickerHex: string;
  secondPickerHex: string;
}
const numeric = '(\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)';
const rgba = `rgba\\(${numeric}, ${numeric}, ${numeric}, ${numeric}\\)`;
const canonicalGradient = new RegExp(
  `^linear-gradient\\(${numeric}deg, ${rgba} ${numeric}%, ${rgba} ${numeric}%\\)$`,
);

function bounded(text: string, min: number, max: number, integer = false): number {
  const value = Number(text);
  if (
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error('Generator returned an invalid gradient component.');
  return value;
}
function opaqueHex(channels: number[]): string {
  return '#' + channels.map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function prepareGradientResult(text: string): GradientView {
  if (text.length > 32768 || new TextEncoder().encode(text).length > 32768)
    throw new Error('Gradient result exceeds 32 KiB.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Expected a JSON gradient result.');
  }
  const value = cloneUtilityJson(parsed);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.css !== 'string'
  )
    throw new Error('Expected only the generated CSS value.');
  const match = canonicalGradient.exec(value.css);
  if (!match) throw new Error('Expected a canonical two-color RGBA linear gradient.');
  bounded(match[1], 0, 360);
  const first = [2, 3, 4].map((index) => bounded(match[index], 0, 255, true));
  bounded(match[5], 0, 1);
  const stop1 = bounded(match[6], 0, 100);
  const second = [7, 8, 9].map((index) => bounded(match[index], 0, 255, true));
  bounded(match[10], 0, 1);
  if (stop1 > bounded(match[11], 0, 100)) throw new Error('Generated gradient stops are reversed.');
  return { css: value.css, firstPickerHex: opaqueHex(first), secondPickerHex: opaqueHex(second) };
}

export function opaquePickerValue(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : '#000000';
}
export function pickerGradientParams(
  params: Record<string, unknown>,
  field: 'color1' | 'color2',
  value: string,
): Record<string, unknown> {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Choose an opaque sRGB hex color.');
  const cloned = cloneUtilityJson(params);
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned))
    throw new Error('Expected gradient parameters.');
  return { ...cloned, [field]: value.toLowerCase() };
}
