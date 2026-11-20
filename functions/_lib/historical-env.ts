import type { Env } from './env';

// Types retained only by private historical unit-tested modules. These are
// not part of the deployed Pages Env and no live route imports those modules.
export interface HistoricalProviderEnv extends Env {
  AI: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  IMAGE_MODEL_TOKEN: string;
}

export interface HistoricalEmailEnv extends Env {
  ZEPTOMAIL_TOKEN: string;
  ZEPTOMAIL_SENDER: string;
  ZEPTOMAIL_SENDER_NAME?: string;
}
