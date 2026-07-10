// Bounded-duration wrapper for env.AI.run() and any other external
// inference call. Two failure modes we defend against:
//
//   1. A model genuinely hangs — Workers AI keeps a connection open,
//      Pages Functions sit on it until the platform wall-time limit
//      kills the whole invocation. We'd rather fail fast with a clear
//      error so the catch-block refund fires and the user gets a
//      retry-able state in seconds, not the platform timeout's worth.
//
//   2. The Pages Function itself times out — without this wrapper our
//      run.ts catch block never runs, the spend row sits as an orphan,
//      and the user has to come back later to trigger the orphan-sweep
//      refund (migration 0003). With the wrapper, the timeout throws,
//      runPro's catch inserts the refund inline, and there's no orphan.
//
// Note: aborting the promise here doesn't necessarily stop the
// underlying Workers AI compute — Cloudflare may still bill for
// neurons consumed up to that point. The complementary defense is
// per-call output limits (e.g. `max_tokens` on LLMs) so a single call
// can't run away in the first place. Both work together.

export class InferenceTimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms} ms`);
    this.name = 'InferenceTimeoutError';
  }
}

/**
 * Race `promise` against a timeout. Resolves with the promise's value
 * if it finishes first; rejects with InferenceTimeoutError if the
 * timer wins. The timer is always cleared so we don't leak a pending
 * setTimeout in the Workers runtime.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new InferenceTimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

// ── Default budgets per modality ───────────────────────────────────────────
//
// Tuned to be generous enough that legitimate inference finishes well
// inside, but tight enough that a true hang fails before the Pages
// Function wall-time. Workers AI typical latencies: text ~1-10s,
// vision ~3-15s, whisper ~5-30s per minute of audio, TTS ~1-5s,
// flux-schnell ~3-10s. Doubling those for headroom:

export const INFERENCE_TIMEOUTS = {
  /** Chat-style LLM call (Llama, DeepSeek, Kimi, GLM, etc.). */
  text: 45_000,
  /** Vision LLM (Llama-vision, image-to-text, OCR). */
  vision: 60_000,
  /** Whisper / speech-to-text. Bounded by 25 MB input cap upstream. */
  audio: 90_000,
  /** Text-to-speech (melotts). Bounded by char cap upstream. */
  tts: 60_000,
  /** Image generation (flux). Bounded by step cap upstream. */
  image: 60_000,
  /** Specialty translation (m2m100, indictrans2). */
  translate: 30_000,
  /** Object detection (DETR). */
  detection: 30_000,
} as const;

// ── Default max_tokens per LLM class ───────────────────────────────────────
//
// Without a cap, Llama 3.3 70B will happily emit 4096+ tokens on a
// loose prompt; DeepSeek R1's <think> block can balloon further. At
// $2.25-$4.88 per M output tokens that's a real cost spike. Cap so a
// single call can't blow our per-run margin by 10x.

export const MAX_TOKENS = {
  /** Most chat tools (summarize, translate, sentiment, NER, redact). */
  default: 2048,
  /** Reasoning models — DeepSeek R1, Kimi K2 — need room for <think>. */
  reasoning: 4096,
  /** Vision (already capped inline at 1024 in vision-models.ts). */
  vision: 1024,
  /** Safety classification — Llama Guard outputs ~2-5 tokens. */
  classification: 64,
} as const;
