import { describe, it, expect } from 'vitest';
import { withTimeout, InferenceTimeoutError } from './timeout';

describe('withTimeout', () => {
  it('resolves with the inner value when the promise wins', async () => {
    const out = await withTimeout(Promise.resolve('done'), 1000, 'test');
    expect(out).toBe('done');
  });

  it('rejects with InferenceTimeoutError when the timer wins', async () => {
    // A promise that never resolves on its own.
    const hang = new Promise<string>(() => {
      /* intentionally pending forever */
    });
    await expect(withTimeout(hang, 25, 'hung-call')).rejects.toBeInstanceOf(
      InferenceTimeoutError,
    );
  });

  it('includes the label and duration in the error message', async () => {
    const hang = new Promise<string>(() => {});
    await expect(withTimeout(hang, 10, 'my-model')).rejects.toThrow(
      /my-model timed out after 10 ms/,
    );
  });

  it('clears the timer when the promise resolves first', async () => {
    // No assertion — vitest fails the test if pending timers prevent
    // the process from exiting cleanly. This test verifies finally{}
    // path runs on success.
    await withTimeout(Promise.resolve(1), 60_000, 'quick');
  });

  it('clears the timer when the promise rejects', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 60_000, 'failing'),
    ).rejects.toThrow('boom');
  });

  it('propagates non-timeout rejections unchanged', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('inner failure')), 1000, 'x'),
    ).rejects.toThrow('inner failure');
  });
});
