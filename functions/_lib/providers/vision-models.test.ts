import { describe, it, expect, vi } from 'vitest';
import { visionPrompt, detectObjects } from './vision-models';
import type { Env } from '../env';

function mockEnv(aiResult: unknown): Env {
  return { AI: { run: vi.fn().mockResolvedValue(aiResult) } } as unknown as Env;
}

describe('visionPrompt', () => {
  it('returns the trimmed response string', async () => {
    const env = mockEnv({ response: '  hello text  ' });
    const out = await visionPrompt(env, new Uint8Array([1, 2, 3]), 'extract text');
    expect(out).toBe('hello text');
  });

  it('throws when the model returns no response', async () => {
    const env = mockEnv({ tool_calls: [] });
    await expect(visionPrompt(env, new Uint8Array([1]), 'x')).rejects.toThrow(
      'Vision model returned no response',
    );
  });

  it('converts imageBytes to a plain number array before calling AI.run', async () => {
    const env = mockEnv({ response: 'ok' });
    await visionPrompt(env, new Uint8Array([10, 20]), 'x');
    const call = (env.AI.run as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { image: unknown[] },
    ];
    expect(call[1].image).toEqual([10, 20]);
  });
});

describe('detectObjects', () => {
  it('passes through a detection array', async () => {
    const dets = [{ score: 0.9, label: 'cat', box: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } }];
    const env = mockEnv(dets);
    const out = await detectObjects(env, new Uint8Array([1]));
    expect(out).toEqual(dets);
  });

  it('throws when the model does not return an array', async () => {
    const env = mockEnv({ error: 'nope' });
    await expect(detectObjects(env, new Uint8Array([1]))).rejects.toThrow(
      'Detection model returned no array',
    );
  });

  it('throws when array elements have an unexpected shape', async () => {
    const env = mockEnv([{ label: 'cat' }]);
    await expect(detectObjects(env, new Uint8Array([1]))).rejects.toThrow(
      'Detection model returned unexpected object shape',
    );
  });

  it('converts imageBytes to a plain number array before calling AI.run', async () => {
    const env = mockEnv([]);
    await detectObjects(env, new Uint8Array([10, 20]));
    const call = (env.AI.run as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { image: unknown[] },
    ];
    expect(call[1].image).toEqual([10, 20]);
  });
});
