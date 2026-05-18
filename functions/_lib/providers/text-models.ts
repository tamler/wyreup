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
  const res = (await env.AI.run(TEXT_MODEL, {
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
