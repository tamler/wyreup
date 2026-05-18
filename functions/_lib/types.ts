// Pages Functions handler shape. Hand-rolled to avoid pulling in
// @cloudflare/workers-types as a workspace dep.

import type { Env } from './env';

export interface PagesFunctionContext<E = Env, P extends string = string> {
  request: Request;
  env: E;
  params: Record<P, string | string[]>;
  data: Record<string, unknown>;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  waitUntil(promise: Promise<unknown>): void;
}

export type PagesFunction<E = Env, P extends string = string> = (
  context: PagesFunctionContext<E, P>,
) => Response | Promise<Response>;
