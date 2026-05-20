// Shared Env shape for Pages Functions. The D1 binding name must match
// wrangler.toml's [[d1_databases]] binding (currently "DB").

// Minimal D1 + Workers AI surface we actually use. Avoids forcing
// @cloudflare/workers-types onto every package in the workspace. Replace
// with the real type if/when functions/ becomes a proper workspace package.
export interface D1Result<T = unknown> {
  results?: T[];
  meta: { changes?: number; duration?: number; rows_read?: number; rows_written?: number };
  success: boolean;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

// Workers AI binding — `env.AI.run(model, input)` with the binding declared
// in wrangler.toml as [ai] binding = "AI". Returns whatever the model emits;
// typed loosely here, narrowed at call sites.
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  // D1
  DB: D1Database;

  // Workers AI binding (declared in wrangler.toml under [ai])
  AI: AiBinding;

  // Secrets (CF Pages → Settings → Environment variables, encrypted)
  SESSION_SECRET: string;
  LS_API_KEY: string;
  LS_STORE_ID: string;
  LS_WEBHOOK_SECRET: string;

  // ZeptoMail (Zoho transactional email — HTTP API, works from Workers)
  ZEPTOMAIL_TOKEN: string;          // "Zoho-enczapikey ..." value
  ZEPTOMAIL_SENDER: string;         // verified from address, e.g. noreply@wyreup.com
  ZEPTOMAIL_SENDER_NAME?: string;   // display name, defaults to "Wyreup"

  // External image-model provider (current backend swappable per project
  // need — see functions/_lib/providers/image-models.ts for the wrapper
  // and replace that one file when switching vendors).
  IMAGE_MODEL_TOKEN: string;
  // Workers AI (text + transcription) uses the `AI` binding declared in
  // wrangler.toml — not a secret.

  // Plain env (non-secret) — set in CF Pages env, or `wrangler pages dev` will
  // inherit from .dev.vars during local development.
  APP_ORIGIN?: string;              // defaults to https://wyreup.com
  LS_VARIANT_STARTER?: string;      // LS variant IDs for the 3 packs
  LS_VARIANT_STANDARD?: string;
  LS_VARIANT_POWER?: string;
  LS_VARIANT_MONTHLY?: string;      // LS variant ID for the $8/mo subscription

  // Comma-separated list of emails allowed to access /api/admin/*.
  // Treat as a secret — its disclosure alone doesn't grant access (the
  // owner still needs the matching API key), but there's no reason to
  // expose the operator set publicly either.
  ADMIN_EMAILS?: string;
}

export function isAdminEmail(email: string, env: Env): boolean {
  const list = (env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export function appOrigin(env: Env): string {
  return env.APP_ORIGIN || 'https://wyreup.com';
}
