import { describe, it, expect } from 'vitest';
import { jwtDecoder } from '../../../src/tools/jwt-decoder/index.js';
import type { ToolRunContext } from '../../../src/types.js';
import type { JwtDecoderResult } from '../../../src/tools/jwt-decoder/index.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

async function run(token: string): Promise<JwtDecoderResult> {
  const file = new File([token], 'token.txt', { type: 'text/plain' });
  const [out] = await jwtDecoder.run([file], {}, makeCtx()) as Blob[];
  return JSON.parse(await out!.text()) as JwtDecoderResult;
}

// A real HS256 JWT: header={"alg":"HS256","typ":"JWT"} payload={"sub":"1234567890","name":"John Doe","iat":1516239022}
const VALID_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('jwt-decoder — metadata', () => {
  it('has id jwt-decoder', () => {
    expect(jwtDecoder.id).toBe('jwt-decoder');
  });

  it('is in the dev category', () => {
    expect(jwtDecoder.category).toBe('dev');
  });

  it('outputs application/json', () => {
    expect(jwtDecoder.output.mime).toBe('application/json');
  });
});

describe('jwt-decoder — run()', () => {
  it('decodes a valid JWT', async () => {
    const result = await run(VALID_JWT);
    expect(result.valid).toBe(true);
    expect(result.header['alg']).toBe('HS256');
    expect(result.header['typ']).toBe('JWT');
    expect(result.payload['sub']).toBe('1234567890');
    expect(result.payload['name']).toBe('John Doe');
  });

  it('detects signature presence', async () => {
    const result = await run(VALID_JWT);
    expect(result.signaturePresent).toBe(true);
  });

  it('returns valid:false for malformed token', async () => {
    const result = await run('notavalidjwt');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('handles token with whitespace/newlines', async () => {
    const result = await run(`  ${VALID_JWT}  `);
    expect(result.valid).toBe(true);
  });

  it('detects no signature for unsigned token', async () => {
    const result = await run('eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0');
    expect(result.signaturePresent).toBe(false);
  });

  it('handles abort signal', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const ctx: ToolRunContext = {
      onProgress: () => {},
      signal: ctrl.signal,
      cache: new Map(),
      executionId: 'test',
    };
    const file = new File([VALID_JWT], 'token.txt', { type: 'text/plain' });
    await expect(jwtDecoder.run([file], {}, ctx)).rejects.toThrow('Aborted');
  });
});
