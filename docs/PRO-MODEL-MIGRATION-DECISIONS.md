# Pro model migration decisions

This branch is not release-ready until authorized provider checks establish runtime schemas, model access, hosting, terms, privacy, output quality and actual billing. No paid calls were made for this change. Incorrect provider contracts can cause refunded runs and count towards the shared daily failure limit.

Model quality and speed are UNTESTED. Paid benchmarks have not been authorized.

Credit prices remain provisional: grammar 1, analysis 3, speech 2. A speech request accepts at most 500 raw and NFKC-normalized UTF-8 bytes. At Cloudflare's published $0.03 per 1,000 characters, 500 billable characters cost $0.015. Half of the assumed lowest net revenue for two credits is approximately $0.01614, so headroom is narrow. Provider counting, minimums and rounding are unverified. TTS is limited to English and Spanish; French, Chinese, Japanese and Korean are currently unavailable.

Input limits are reduced: grammar now accepts 4,000 UTF-8 bytes; analysis accepts 34,000 document bytes and 1,500 question bytes. Both raw and NFKC-normalized sizes must fit. Previously the server accepted up to 100,000 UTF-16 code units per text field. These changes and the speech language reduction are breaking consumer behavior; the changeset proposes major bumps for core, CLI and MCP.

`minimax/speech-2.8-turbo` is listed as a third-party model, with a different provider and URL output. It is not silently used; its data handling, terms and price require separate review. No credentials were added.

For grammar, the model prices are $0.10 per million input tokens and $0.30 per million output tokens. Assuming at most one input token per byte, 800 prompt/template tokens, and a 6,144-token completion, the nominal bound is $0.0023232. For analysis, $0.30 input and $1.20 output per million give $0.0182628 for 34,000 document bytes, 1,500 question bytes, 800 overhead and 6,144 completion tokens. Tokenizer, template overhead, reasoning-token accounting and timeout billing remain provider assumptions, not proven maximums.

Both text requests retain a 45-second deadline while permitting up to 6,144 completion tokens. Actual latency and behavior at this cap are unknown; a timed-out request may continue billing after refund. Five failed or pending runs can block all Pro tools for that user until the UTC day resets. The mismatch, response schemas, input options and timeout behavior must be tested with explicit spending authorization before release; do not label the mocks as runtime verification.

Model schemas and prices: [DeepSeek V4.1](https://developers.cloudflare.com/workers-ai/models/deepseek-v4.1-flash-1017/), [Gemma 4](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/), [Aura 2 English](https://developers.cloudflare.com/workers-ai/models/aura-2-en/), [Aura 2 Spanish](https://developers.cloudflare.com/workers-ai/models/aura-2-es/), and [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/). Recheck before release.
