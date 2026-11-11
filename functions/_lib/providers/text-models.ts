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

export const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export interface ChatOptions {
  /** Cap the model's output token count. Default 2048 (MAX_TOKENS.default). */
  maxTokens?: number;
  /** Per-call timeout override (ms). Default 45_000 (INFERENCE_TIMEOUTS.text). */
  timeoutMs?: number;
  /**
   * For OpenAI-style models with a reasoning switch (DeepSeek V4.1 Flash,
   * Gemma 4, GLM 4.7 Flash): sets `chat_template_kwargs.enable_thinking`
   * and also sends `max_completion_tokens`, which bounds reasoning plus
   * answer tokens together. Leave undefined for older models.
   */
  thinking?: boolean;
}

export interface ChatDetail {
  /** Final answer text, trimmed. Empty when the model spent its budget reasoning. */
  content: string;
  /** Reasoning trace, trimmed. Empty when the model returned none. */
  reasoning: string;
  /**
   * True when the provider reported `finish_reason: 'length'`: the output
   * budget ran out and the answer is incomplete. Callers must not present
   * it as a whole result.
   */
  truncated: boolean;
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
// DeepSeek V4.1 Flash for reasoning, Gemma 4 for grammar, glm-flash for
// cheap rewrites, etc.). Vendor swap still happens in this one file:
// switch providers by replacing these bodies.
//
// Bounded on two axes by default:
//   - `max_tokens` caps cost-per-call so a runaway generation can't 10x
//     the inference bill on a 2-credit tool.
//   - The withTimeout wrapper bounds wall-time so a hung call fails
//     fast; runPro's catch block then inserts the refund inline
//     rather than relying on the orphan-spend sweep to clean up later.
export async function chatWith(
  env: Env,
  modelId: string,
  system: string,
  user: string,
  opts: ChatOptions = {},
): Promise<string> {
  return (await runChat(env, modelId, system, user, opts)).raw;
}

/**
 * Like chatWith() but splits the reasoning trace from the answer. The trace
 * comes from `message.reasoning_content` / `message.reasoning` on
 * OpenAI-style responses, or from a leading <think>...</think> block.
 */
export async function chatWithDetail(
  env: Env,
  modelId: string,
  system: string,
  user: string,
  opts: ChatOptions = {},
): Promise<ChatDetail> {
  const { raw, reasoning, truncated } = await runChat(env, modelId, system, user, opts);
  const think = raw.match(/<think>([\s\S]*?)<\/think>/i);
  return {
    content: raw.replace(/<think>[\s\S]*?<\/think>/i, '').trim(),
    reasoning: [reasoning, think?.[1]?.trim() ?? ''].filter(Boolean).join('\n\n'),
    truncated,
  };
}

async function runChat(
  env: Env,
  modelId: string,
  system: string,
  user: string,
  opts: ChatOptions,
): Promise<{ raw: string; reasoning: string; truncated: boolean }> {
  const max_tokens = opts.maxTokens ?? MAX_TOKENS.default;
  const timeoutMs = opts.timeoutMs ?? INFERENCE_TIMEOUTS.text;
  const payload: Record<string, unknown> = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens,
  };
  if (opts.thinking !== undefined) {
    payload.max_completion_tokens = max_tokens;
    payload.chat_template_kwargs = { enable_thinking: opts.thinking };
  }
  const res = await withTimeout(env.AI.run(modelId, payload), timeoutMs, `text-model (${modelId})`);
  return parseChatResponse(res);
}

// Workers AI returns `{ response }` for older models and an OpenAI-style
// `{ choices: [{ message: { content } }] }` for newer ones (Gemma 4, GLM
// 4.7 Flash, DeepSeek V4.1 Flash). `content` may be null when the whole
// budget went to reasoning; that comes back as an empty string here.
export function parseChatResponse(res: unknown): {
  raw: string;
  reasoning: string;
  truncated: boolean;
} {
  const obj = (res ?? {}) as {
    response?: unknown;
    choices?: Array<{
      message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown };
      finish_reason?: unknown;
    }>;
  };
  if (typeof obj.response === 'string') {
    return { raw: obj.response.trim(), reasoning: '', truncated: false };
  }
  const choice = Array.isArray(obj.choices) ? obj.choices[0] : undefined;
  const message = choice?.message;
  const truncated = choice?.finish_reason === 'length';
  if (message && typeof message === 'object') {
    const content = message.content;
    const trace = message.reasoning_content ?? message.reasoning;
    const reasoning = typeof trace === 'string' ? trace.trim() : '';
    if (typeof content === 'string') return { raw: content.trim(), reasoning, truncated };
    if (content === null || content === undefined) {
      if (reasoning) return { raw: '', reasoning, truncated };
    }
  }
  throw new Error('Text model returned no response');
}
