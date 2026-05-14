import type { ToolModule, ToolRunContext } from '../../types.js';
import type { CalculatorParams, AngleMode } from './types.js';

export type { CalculatorParams, AngleMode } from './types.js';
export { defaultCalculatorParams } from './types.js';

const CalculatorComponentStub = (): unknown => null;

// ── Tiny shunting-yard calculator ──────────────────────────────────────────

type TokenType = 'number' | 'op' | 'fn' | 'lparen' | 'rparen' | 'const';

interface Token {
  type: TokenType;
  value: string;
}

const FUNCTIONS = new Set(['sqrt', 'sin', 'cos', 'tan', 'log', 'ln', 'abs']);
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const PRECEDENCE: Record<string, number> = {
  '+': 1, '-': 1,
  '*': 2, '/': 2, '%': 2,
  '^': 3, '**': 3,
};

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = expr.trim();

  while (i < s.length) {
    const ch = s[i]!;

    // whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // number (including decimals)
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(s[i + 1] ?? ''))) {
      let num = '';
      while (i < s.length && (/[\d.]/.test(s[i]!))) { num += s[i]!; i++; }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // function names and constants (alpha sequences)
    if (/[a-z]/i.test(ch)) {
      let word = '';
      while (i < s.length && /[a-z]/i.test(s[i]!)) { word += s[i]!; i++; }
      const lower = word.toLowerCase();
      if (FUNCTIONS.has(lower)) {
        tokens.push({ type: 'fn', value: lower });
      } else if (lower in CONSTANTS) {
        tokens.push({ type: 'const', value: lower });
      } else {
        throw new Error(`Unknown identifier: ${word}`);
      }
      continue;
    }

    // ** (power)
    if (ch === '*' && s[i + 1] === '*') {
      tokens.push({ type: 'op', value: '**' });
      i += 2;
      continue;
    }

    // single-char operators + parens
    if ('+-*/%^'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; continue; }

    throw new Error(`Unexpected character: ${ch}`);
  }

  return tokens;
}

function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const stack: Token[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;

    if (tok.type === 'number' || tok.type === 'const') {
      output.push(tok);
      continue;
    }

    if (tok.type === 'fn') {
      stack.push(tok);
      continue;
    }

    if (tok.type === 'op') {
      // Handle unary minus: if previous token was op, lparen, or first token
      const prev = tokens[i - 1];
      if (tok.value === '-' && (!prev || prev.type === 'op' || prev.type === 'lparen')) {
        // treat as unary: insert 0 before it
        output.push({ type: 'number', value: '0' });
      }

      const prec = PRECEDENCE[tok.value] ?? 0;
      const rightAssoc = tok.value === '^' || tok.value === '**';

      while (stack.length > 0) {
        const top = stack[stack.length - 1]!;
        if (
          top.type === 'fn' ||
          (top.type === 'op' && (
            (PRECEDENCE[top.value] ?? 0) > prec ||
            (!rightAssoc && (PRECEDENCE[top.value] ?? 0) === prec)
          ))
        ) {
          output.push(stack.pop()!);
        } else {
          break;
        }
      }
      stack.push(tok);
      continue;
    }

    if (tok.type === 'lparen') {
      stack.push(tok);
      continue;
    }

    if (tok.type === 'rparen') {
      while (stack.length > 0 && stack[stack.length - 1]!.type !== 'lparen') {
        output.push(stack.pop()!);
      }
      if (stack.length === 0) throw new Error('Mismatched parentheses');
      stack.pop(); // remove lparen
      if (stack.length > 0 && stack[stack.length - 1]!.type === 'fn') {
        output.push(stack.pop()!);
      }
      continue;
    }
  }

  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.type === 'lparen') throw new Error('Mismatched parentheses');
    output.push(top);
  }

  return output;
}

function evalRPN(rpn: Token[], angleMode: AngleMode): number {
  const stack: number[] = [];

  function toRad(x: number): number {
    return angleMode === 'deg' ? (x * Math.PI) / 180 : x;
  }

  for (const tok of rpn) {
    if (tok.type === 'number') {
      const n = parseFloat(tok.value);
      if (isNaN(n)) throw new Error(`Invalid number: ${tok.value}`);
      stack.push(n);
      continue;
    }

    if (tok.type === 'const') {
      stack.push(CONSTANTS[tok.value]!);
      continue;
    }

    if (tok.type === 'fn') {
      const a = stack.pop();
      if (a === undefined) throw new Error('Not enough operands');
      switch (tok.value) {
        case 'sqrt': stack.push(Math.sqrt(a)); break;
        case 'sin':  stack.push(Math.sin(toRad(a))); break;
        case 'cos':  stack.push(Math.cos(toRad(a))); break;
        case 'tan':  stack.push(Math.tan(toRad(a))); break;
        case 'log':  if (a <= 0) throw new Error('log undefined for non-positive values'); stack.push(Math.log10(a)); break;
        case 'ln':   if (a <= 0) throw new Error('ln undefined for non-positive values'); stack.push(Math.log(a)); break;
        case 'abs':  stack.push(Math.abs(a)); break;
        default: throw new Error(`Unknown function: ${tok.value}`);
      }
      continue;
    }

    if (tok.type === 'op') {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error('Not enough operands');
      switch (tok.value) {
        case '+': stack.push(a + b); break;
        case '-': stack.push(a - b); break;
        case '*': stack.push(a * b); break;
        case '/':
          if (b === 0) throw new Error('Division by zero');
          stack.push(a / b);
          break;
        case '%': stack.push(a % b); break;
        case '^':
        case '**': stack.push(Math.pow(a, b)); break;
        default: throw new Error(`Unknown operator: ${tok.value}`);
      }
    }
  }

  if (stack.length !== 1) throw new Error('Invalid expression');
  return stack[0]!;
}

export function evaluate(expression: string, angleMode: AngleMode = 'deg'): { valid: boolean; result?: number; error?: string } {
  const expr = expression.trim();
  if (!expr) return { valid: false, error: 'Expression is empty' };
  try {
    const tokens = tokenize(expr);
    const rpn = toRPN(tokens);
    const result = evalRPN(rpn, angleMode);
    if (!isFinite(result)) return { valid: false, error: 'Result is not finite' };
    return { valid: true, result };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── ToolModule ─────────────────────────────────────────────────────────────

export const calculator: ToolModule<CalculatorParams> = {
  id: 'calculator',
  slug: 'calculator',
  name: 'Calculator',
  description: 'Evaluate arithmetic and scientific expressions locally — no server, no data sent.',
  category: 'create',
  presence: 'both',
  keywords: ['calculator', 'math', 'expression', 'arithmetic', 'scientific', 'compute'],

  input: { accept: [], min: 0, max: 0 },
  output: { mime: 'application/json', multiple: false },

  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: { expression: '', angleMode: 'deg' },

  paramSchema: {
    expression: {
      type: 'string',
      label: 'expression',
      placeholder: '2 * (3 + 4) / sqrt(2)',
      help: 'Operators: + − × ÷ % ^. Functions: sqrt, sin, cos, tan, log, ln, abs. Constants: pi, e.',
    },
    angleMode: {
      type: 'enum',
      label: 'angle mode',
      help: 'How sin/cos/tan interpret their input.',
      options: [
        { value: 'deg', label: 'degrees' },
        { value: 'rad', label: 'radians' },
      ],
    },
  },

  Component: CalculatorComponentStub,

   
  async run(
    _inputs: File[],
    params: CalculatorParams,
    ctx: ToolRunContext,
  ): Promise<Blob[]> {
    ctx.onProgress({ stage: 'processing', percent: 0, message: 'Evaluating expression' });

    const angleMode = params.angleMode ?? 'deg';
    const ev = evaluate(params.expression ?? '', angleMode);
    const output = JSON.stringify(ev, null, 2);

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([output], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};
