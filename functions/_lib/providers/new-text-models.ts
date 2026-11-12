import type { Env } from '../env';
import { INFERENCE_TIMEOUTS, withTimeout } from '../timeout';

const DEEPSEEK = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
const GEMMA = '@cf/google/gemma-4-26b-a4b-it';

export class OutputTruncatedError extends Error {
  constructor() {
    super('The model output was truncated. Try shorter input.');
    this.name = 'OutputTruncatedError';
  }
}

async function completion(env: Env, model: string, system: string, user: string, reasoning: boolean): Promise<{ answer: string; reasoning: string }> {
  const result = await withTimeout(env.AI.run(model, {
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_completion_tokens: 6144,
    ...(reasoning ? { reasoning_effort: 'low' } : { chat_template_kwargs: { enable_thinking: false } }),
    stream: false,
  }), INFERENCE_TIMEOUTS.text, 'text-model');
  const obj = result as { choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown; reasoning_content?: unknown } }> } | null;
  const choice = obj?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new OutputTruncatedError();
  if (!choice || choice.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' || !choice.message.content.trim()) {
    throw new Error('Text model returned an incomplete or invalid answer');
  }
  return {
    answer: choice.message.content.trim(),
    reasoning: typeof choice.message.reasoning_content === 'string' ? choice.message.reasoning_content.trim() : '',
  };
}

export function analyze(env: Env, system: string, user: string) {
  return completion(env, DEEPSEEK, system, user, true);
}

export async function correctGrammar(env: Env, system: string, text: string): Promise<string> {
  return (await completion(env, GEMMA, system, text, false)).answer;
}
