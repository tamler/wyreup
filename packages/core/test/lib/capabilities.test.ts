import { describe, it, expect } from 'vitest';
import { detectCapabilities, checkToolCapabilities } from '../../src/lib/capabilities.js';

describe('detectCapabilities (Node)', () => {
  it('returns conservative defaults under Node', async () => {
    const caps = await detectCapabilities();
    expect(caps.hasWebGPU).toBe(false);
    expect(caps.hasWasm).toBe(true);
    expect(caps.deviceMemoryGB).toBeGreaterThan(0);
  });
});

describe('checkToolCapabilities', () => {
  const webgpuOn = { hasWebGPU: true, hasWasm: true, deviceMemoryGB: 8 };
  const webgpuOff = { hasWebGPU: false, hasWasm: true, deviceMemoryGB: 8 };
  const lowMem = { hasWebGPU: true, hasWasm: true, deviceMemoryGB: 2 };

  it('universal tools always run', () => {
    expect(checkToolCapabilities({}, webgpuOff)).toEqual({ runnable: true });
  });

  it('webgpu-required blocks on non-WebGPU and surfaces a reason', () => {
    const result = checkToolCapabilities({ requires: { webgpu: 'required' } }, webgpuOff);
    expect(result.runnable).toBe(false);
    expect(result.reason).toMatch(/WebGPU/);
  });

  it('webgpu-required runs normally on WebGPU', () => {
    expect(
      checkToolCapabilities({ requires: { webgpu: 'required' } }, webgpuOn),
    ).toEqual({ runnable: true });
  });

  it('webgpu-preferred runs on WebGPU without slower flag', () => {
    expect(
      checkToolCapabilities({ requires: { webgpu: 'preferred' } }, webgpuOn),
    ).toEqual({ runnable: true });
  });

  it('webgpu-preferred runs on WASM with slower flag', () => {
    expect(
      checkToolCapabilities({ requires: { webgpu: 'preferred' } }, webgpuOff),
    ).toEqual({ runnable: true, slower: true });
  });

  it('blocks when device memory is below minMemoryGB', () => {
    const result = checkToolCapabilities({ requires: { minMemoryGB: 4 } }, lowMem);
    expect(result.runnable).toBe(false);
    expect(result.reason).toMatch(/4 GB/);
  });

  it('allows when device memory meets minMemoryGB', () => {
    expect(
      checkToolCapabilities({ requires: { minMemoryGB: 4 } }, webgpuOn),
    ).toEqual({ runnable: true });
  });
});
