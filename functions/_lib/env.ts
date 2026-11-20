// Shared Env shape for Pages Functions. The D1 binding name must match
// wrangler.toml's [[d1_databases]] binding (currently "DB").

// Minimal live Pages surface. Avoids forcing @cloudflare/workers-types onto
// every package in the workspace. Replace
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

export interface Env {
  // D1 remains for public domain registration lookup rate limits.
  DB: D1Database;
  // Used to derive private rate-limit keys for the public domain lookup.
  SESSION_SECRET: string;
}
