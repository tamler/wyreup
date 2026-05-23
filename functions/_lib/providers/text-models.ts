// Text-model provider wrapper.
//
// One file, one vendor — replace the body when switching backends. Public
// signature (`chat`) is what the rest of the code imports, so swaps don't
// ripple beyond this module.
//
// Current backend: Cloudflare Workers AI (Llama 3.3 70B). The env.AI
// binding ships with the Pages Functions runtime — no token needed. When
// volume justifies the switch, replace the body with a Groq call and add
// TEXT_MODEL_TOKEN to env.ts; the abstraction means nothing else changes.

import type { Env } from '../env';
import { withTimeout, INFERENCE_TIMEOUTS, MAX_TOKENS } from '../timeout';

const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export interface ChatOptions {
  /** Cap the model's output token count. Default 2048 (MAX_TOKENS.default). */
  maxTokens?: number;
  /** Per-call timeout override (ms). Default 45_000 (INFERENCE_TIMEOUTS.text). */
  timeoutMs?: number;
}

export async function chat(
  env: Env,
  system: string,
  user: string,
  opts: ChatOptions = {},
): Promise<string> {
  return chatWith(env, TEXT_MODEL, system, user, opts);
}

// Same shape as chat() but with the model selectable per-call. Used by Pro
// tools that need a specific Workers AI model (Llama Guard for safety,
// DeepSeek R1 for reasoning, Kimi for long context, glm-flash for cheap
// rewrites, etc.). Vendor swap still happens in this one file — switch
// providers by replacing both bodies.
//
// Bounded on two axes by default:
//   - `max_tokens` caps cost-per-call so a runaway generation can't 10x
//     the inference bill on a 2-credit tool.
//   - The withTimeout wrapper bounds wall-time so a hung call fails
//     fast — runPro's catch block then inserts the refund inline
//     rather than relying on the orphan-spend sweep to clean up later.
export async function chatWith(
  env: Env,
  modelId: string,
  system: string,
  user: string,
  opts: ChatOptions = {},
): Promise<string> {
  const max_tokens = opts.maxTokens ?? MAX_TOKENS.default;
  const timeoutMs = opts.timeoutMs ?? INFERENCE_TIMEOUTS.text;
  const res = (await withTimeout(
    env.AI.run(modelId, {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens,
    }),
    timeoutMs,
    `text-model (${modelId})`,
  )) as { response?: string };
  if (!res || typeof res.response !== 'string') {
    throw new Error('Text model returned no response');
  }
  return res.response.trim();
}
