import type { ToolModule, ToolRunContext } from '../../types.js';

export interface RegexVisualizeParams {
  /** The regex pattern. Required. Accepts /literal/flags or bare pattern. */
  pattern?: string;
}

export const defaultRegexVisualizeParams: RegexVisualizeParams = {
  pattern: '',
};

// Layout constants. Tight defaults — the diagram should fit in a typical
// tool panel without horizontal scrolling for most real regexes.
const PAD = 8;
const BOX_H = 32;
const BOX_GAP = 8;
const ROW_GAP = 12;
const CHAR_W = 8;
const MIN_BOX_W = 36;
const FONT = '13px ui-monospace, SFMono-Regular, Menlo, monospace';

type Box = {
  label: string;
  /** Visual hint for fill / stroke. */
  kind: 'literal' | 'class' | 'assertion' | 'special' | 'group' | 'alt' | 'rep';
  /** Optional nested layout (groups, repetitions, alternations). */
  inner?: Layout;
  /** Repetition quantifier label, drawn under the wrapped box. */
  quantifier?: string;
  /** Alternation rows (vertical stack of layouts). */
  alternatives?: Layout[];
};

type Layout = {
  boxes: Box[];
  /** Computed pixel width once measured. */
  width: number;
  height: number;
};

// ──── AST → layout ──────────────────────────────────────────────────────────

interface AstNode {
  type: string;
  [k: string]: unknown;
}

function labelFor(node: AstNode): string {
  switch (node.type) {
    case 'Char': {
      const value = node.value as string;
      const kind = node.kind as string;
      if (kind === 'meta') return `\\${value.replace(/^\\/, '')}`;
      if (kind === 'control') return `^${value}`;
      if (kind === 'hex' || kind === 'unicode' || kind === 'oct') return value;
      if (value === ' ') return '␣';
      return value;
    }
    case 'Assertion': {
      const kind = node.kind as string;
      if (kind === '^') return 'start';
      if (kind === '$') return 'end';
      if (kind === '\\b') return 'word boundary';
      if (kind === '\\B') return 'not word boundary';
      if (kind === 'Lookahead') return (node.negative ? 'not followed by' : 'followed by');
      if (kind === 'Lookbehind') return (node.negative ? 'not preceded by' : 'preceded by');
      return kind;
    }
    case 'Backreference': {
      const ref = node.reference as string | number | undefined;
      return `\\${ref ?? ''}`;
    }
    default:
      return node.type;
  }
}

function characterClassLabel(node: AstNode): string {
  const negative = Boolean(node.negative);
  const exprs = (node.expressions ?? []) as AstNode[];
  const parts = exprs.map((e) => {
    if (e.type === 'ClassRange') {
      const from = e.from as AstNode;
      const to = e.to as AstNode;
      return `${labelFor(from)}-${labelFor(to)}`;
    }
    return labelFor(e);
  });
  return `[${negative ? '^' : ''}${parts.join('')}]`;
}

function quantifierLabel(rep: AstNode): string {
  const q = rep.quantifier as AstNode;
  const kind = q.kind as string;
  const greedy = q.greedy === false ? '?' : '';
  if (kind === '+') return `1 or more${greedy}`;
  if (kind === '*') return `0 or more${greedy}`;
  if (kind === '?') return `optional${greedy}`;
  if (kind === 'Range') {
    const from = q.from as number;
    const to = q.to as number | null | undefined;
    if (to === undefined || to === null) return `${from} or more${greedy}`;
    if (from === to) return `exactly ${from}`;
    return `${from} to ${to}${greedy}`;
  }
  return kind;
}

function layoutOf(node: AstNode): Layout {
  switch (node.type) {
    case 'Alternative': {
      const exprs = (node.expressions ?? []) as AstNode[];
      const boxes = exprs.flatMap((e) => layoutOf(e).boxes);
      return measure({ boxes, width: 0, height: 0 });
    }
    case 'Disjunction': {
      const left = node.left as AstNode | null;
      const right = node.right as AstNode | null;
      const alts: Layout[] = [];
      if (left) alts.push(layoutOf(left));
      if (right) alts.push(layoutOf(right));
      // Flatten nested disjunctions into a single vertical stack.
      const flat: Layout[] = [];
      for (const a of alts) {
        if (a.boxes.length === 1 && a.boxes[0]!.kind === 'alt' && a.boxes[0]!.alternatives) {
          flat.push(...a.boxes[0]!.alternatives);
        } else {
          flat.push(a);
        }
      }
      return measure({ boxes: [{ label: '', kind: 'alt', alternatives: flat }], width: 0, height: 0 });
    }
    case 'Group': {
      const expr = node.expression as AstNode | null;
      const inner = expr ? layoutOf(expr) : { boxes: [], width: 0, height: 0 };
      const isCapturing = Boolean(node.capturing);
      const name = node.name as string | undefined;
      const label = name ? `(?<${name}>...)` : isCapturing ? `(group)` : `(?:...)`;
      return measure({ boxes: [{ label, kind: 'group', inner }], width: 0, height: 0 });
    }
    case 'Repetition': {
      const expr = node.expression as AstNode;
      const inner = layoutOf(expr);
      return measure({
        boxes: [{ label: '', kind: 'rep', inner, quantifier: quantifierLabel(node) }],
        width: 0,
        height: 0,
      });
    }
    case 'CharacterClass':
      return measure({ boxes: [{ label: characterClassLabel(node), kind: 'class' }], width: 0, height: 0 });
    case 'Char':
      return measure({ boxes: [{ label: labelFor(node), kind: 'literal' }], width: 0, height: 0 });
    case 'Assertion':
      return measure({ boxes: [{ label: labelFor(node), kind: 'assertion' }], width: 0, height: 0 });
    case 'Backreference':
      return measure({ boxes: [{ label: labelFor(node), kind: 'special' }], width: 0, height: 0 });
    default:
      return measure({ boxes: [{ label: node.type, kind: 'special' }], width: 0, height: 0 });
  }
}

function textWidth(label: string): number {
  return Math.max(MIN_BOX_W, label.length * CHAR_W + PAD * 2);
}

function measure(layout: Layout): Layout {
  let w = 0;
  let h = BOX_H;
  for (const box of layout.boxes) {
    if (box.kind === 'alt' && box.alternatives) {
      let maxInnerW = 0;
      let totalH = 0;
      for (const a of box.alternatives) {
        if (a.width === 0) measure(a);
        maxInnerW = Math.max(maxInnerW, a.width);
        totalH += a.height + ROW_GAP;
      }
      totalH -= ROW_GAP;
      // Width contribution including frame padding.
      w += maxInnerW + PAD * 2;
      h = Math.max(h, totalH + PAD * 2);
    } else if (box.kind === 'group' && box.inner) {
      if (box.inner.width === 0) measure(box.inner);
      const labelW = textWidth(box.label);
      const innerW = box.inner.width + PAD * 2;
      const blockW = Math.max(labelW, innerW);
      w += blockW;
      h = Math.max(h, box.inner.height + BOX_H + PAD);
    } else if (box.kind === 'rep' && box.inner) {
      if (box.inner.width === 0) measure(box.inner);
      const qW = textWidth(box.quantifier ?? '');
      const blockW = Math.max(box.inner.width + PAD * 2, qW);
      w += blockW;
      h = Math.max(h, box.inner.height + BOX_H + PAD);
    } else {
      w += textWidth(box.label);
    }
    w += BOX_GAP;
  }
  if (layout.boxes.length > 0) w -= BOX_GAP;
  layout.width = w;
  layout.height = h;
  return layout;
}

// ──── SVG rendering ─────────────────────────────────────────────────────────

const STYLES: Record<Box['kind'], { fill: string; stroke: string; text: string }> = {
  literal: { fill: '#fff', stroke: '#666', text: '#222' },
  class: { fill: '#fff3d6', stroke: '#b78b00', text: '#5a4400' },
  assertion: { fill: '#e6f0ff', stroke: '#3060b0', text: '#1a3a70' },
  special: { fill: '#f0f0f0', stroke: '#888', text: '#444' },
  group: { fill: 'transparent', stroke: '#888', text: '#444' },
  alt: { fill: 'transparent', stroke: '#888', text: '#444' },
  rep: { fill: 'transparent', stroke: '#888', text: '#444' },
};

function renderLayout(layout: Layout, x: number, y: number, lines: string[]): void {
  let cursor = x;
  const baseY = y + (layout.height - BOX_H) / 2;
  for (const box of layout.boxes) {
    if (box.kind === 'alt' && box.alternatives) {
      const maxInnerW = Math.max(...box.alternatives.map((a) => a.width));
      const totalH = box.alternatives.reduce((acc, a) => acc + a.height + ROW_GAP, 0) - ROW_GAP;
      const frameY = y + (layout.height - totalH) / 2 - PAD;
      lines.push(
        `<rect x="${cursor}" y="${frameY}" width="${maxInnerW + PAD * 2}" height="${totalH + PAD * 2}" rx="6" fill="none" stroke="#999" stroke-dasharray="3 3"/>`,
      );
      let altY = frameY + PAD;
      for (const a of box.alternatives) {
        renderLayout(a, cursor + PAD, altY, lines);
        altY += a.height + ROW_GAP;
      }
      cursor += maxInnerW + PAD * 2 + BOX_GAP;
    } else if (box.kind === 'group' && box.inner) {
      const labelW = textWidth(box.label);
      const innerW = box.inner.width + PAD * 2;
      const blockW = Math.max(labelW, innerW);
      const groupY = y + (layout.height - (box.inner.height + BOX_H + PAD)) / 2;
      lines.push(
        `<text x="${cursor + blockW / 2}" y="${groupY + BOX_H * 0.6}" font-family="${FONT}" font-size="11" fill="${STYLES.group.text}" text-anchor="middle">${escapeXml(box.label)}</text>`,
      );
      lines.push(
        `<rect x="${cursor}" y="${groupY + BOX_H}" width="${blockW}" height="${box.inner.height + PAD}" rx="6" fill="none" stroke="${STYLES.group.stroke}"/>`,
      );
      renderLayout(box.inner, cursor + (blockW - box.inner.width) / 2, groupY + BOX_H + PAD / 2, lines);
      cursor += blockW + BOX_GAP;
    } else if (box.kind === 'rep' && box.inner) {
      const qW = textWidth(box.quantifier ?? '');
      const blockW = Math.max(box.inner.width + PAD * 2, qW);
      const innerY = y + (layout.height - (box.inner.height + BOX_H + PAD)) / 2;
      lines.push(
        `<rect x="${cursor}" y="${innerY}" width="${blockW}" height="${box.inner.height + PAD}" rx="6" fill="none" stroke="${STYLES.rep.stroke}" stroke-dasharray="2 4"/>`,
      );
      renderLayout(box.inner, cursor + (blockW - box.inner.width) / 2, innerY + PAD / 2, lines);
      lines.push(
        `<text x="${cursor + blockW / 2}" y="${innerY + box.inner.height + BOX_H * 0.6 + PAD / 2}" font-family="${FONT}" font-size="11" fill="${STYLES.rep.text}" text-anchor="middle" font-style="italic">${escapeXml(box.quantifier ?? '')}</text>`,
      );
      cursor += blockW + BOX_GAP;
    } else {
      const w = textWidth(box.label);
      const style = STYLES[box.kind];
      lines.push(
        `<rect x="${cursor}" y="${baseY}" width="${w}" height="${BOX_H}" rx="4" fill="${style.fill}" stroke="${style.stroke}"/>`,
      );
      lines.push(
        `<text x="${cursor + w / 2}" y="${baseY + BOX_H * 0.65}" font-family="${FONT}" font-size="13" fill="${style.text}" text-anchor="middle">${escapeXml(box.label)}</text>`,
      );
      cursor += w + BOX_GAP;
    }
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface VisualizeResult {
  svg: string;
  /** AST node count — useful for "is this regex too complex" thresholds. */
  nodeCount: number;
}

export function visualizeRegex(pattern: string): VisualizeResult {
  // Accept either /pattern/flags form or bare pattern.
  let toParse = pattern.trim();
  if (!toParse) throw new Error('regex-visualize requires a non-empty pattern.');
  if (!toParse.startsWith('/')) toParse = `/${toParse}/`;

  let parsed: AstNode;
  try {
    // regexp-tree is a CJS module shipped via npm — wrap the require
    // so consumers (web bundler / Node) both work.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tree = require('regexp-tree') as { parse: (s: string) => AstNode };
    parsed = tree.parse(toParse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse regex: ${msg}`);
  }

  const body = parsed.body as AstNode | undefined;
  if (!body) {
    return { svg: emptySvg('empty pattern'), nodeCount: 0 };
  }

  const layout = layoutOf(body);
  let nodeCount = 0;
  const count = (n: AstNode): void => {
    nodeCount++;
    for (const v of Object.values(n)) {
      if (v && typeof v === 'object') {
        if (Array.isArray(v)) v.forEach((c) => { if (c && typeof c === 'object') count(c as AstNode); });
        else if ('type' in v) count(v as AstNode);
      }
    }
  };
  count(body);

  const lines: string[] = [];
  renderLayout(layout, PAD, PAD, lines);
  const totalW = layout.width + PAD * 2;
  const totalH = layout.height + PAD * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}">${lines.join('')}</svg>`;

  return { svg, nodeCount };
}

function emptySvg(message: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 32" width="200" height="32"><text x="100" y="22" font-family="${FONT}" font-size="12" fill="#888" text-anchor="middle">${escapeXml(message)}</text></svg>`;
}

export const regexVisualize: ToolModule<RegexVisualizeParams> = {
  id: 'regex-visualize',
  slug: 'regex-visualize',
  name: 'Regex Visualize',
  description:
    'Render a regex pattern as an SVG diagram. Each part of the pattern becomes a labeled box; groups nest, alternations stack vertically, repetitions show their quantifier underneath. Chains after regex-tester for the "what does this thing actually do?" hand-off.',
  category: 'inspect',
  keywords: ['regex', 'regexp', 'visualize', 'diagram', 'railroad', 'svg', 'pattern'],

  input: {
    accept: ['text/plain'],
    min: 0,
    max: 1,
    sizeLimit: 64 * 1024,
  },
  output: { mime: 'image/svg+xml' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultRegexVisualizeParams,

  paramSchema: {
    pattern: {
      type: 'string',
      label: 'regex pattern',
      help: 'Accepts /pattern/flags or a bare pattern. Required.',
      placeholder: '/^[a-z]+(?:-[a-z]+)*$/',
      multiline: true,
    },
  },

  async run(inputs: File[], params: RegexVisualizeParams, ctx: ToolRunContext): Promise<Blob[]> {
    let pattern = params.pattern ?? '';
    if (!pattern.trim() && inputs.length === 1) {
      pattern = (await inputs[0]!.text()).trim();
    }
    if (!pattern.trim()) {
      throw new Error('regex-visualize requires a "pattern" parameter or a single text input.');
    }
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Rendering' });
    const result = visualizeRegex(pattern);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([result.svg], { type: 'image/svg+xml' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['image/svg+xml'],
  },
};
