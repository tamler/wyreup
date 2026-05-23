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

const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export async function chat(env: Env, system: string, user: string): Promise<string> {
  return chatWith(env, TEXT_MODEL, system, user);
}

// Same shape as chat() but with the model selectable per-call. Used by Pro
// tools that need a specific Workers AI model (Llama Guard for safety,
// DeepSeek R1 for reasoning, Kimi for long context, glm-flash for cheap
// rewrites, etc.). Vendor swap still happens in this one file — switch
// providers by replacing both bodies.
export async function chatWith(
  env: Env,
  modelId: string,
  system: string,
  user: string,
): Promise<string> {
  const res = (await env.AI.run(modelId, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  })) as { response?: string };
  if (!res || typeof res.response !== 'string') {
    throw new Error('Text model returned no response');
  }
  return res.response.trim();
}
