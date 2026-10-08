import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  setModelCdn,
  getModelCdn,
  modelUrl,
  applyModelCdnToTransformersEnv,
} from '../../src/lib/model-cdn.js';

describe('model-cdn', () => {
  afterEach(() => {
    setModelCdn(null);
  });

  it('defaults to null (no override)', () => {
    expect(getModelCdn()).toBe(null);
  });

  it('returns the upstream URL when no base is set', () => {
    const upstream = 'https://huggingface.co/foo/model.onnx';
    expect(modelUrl('foo/model.onnx', upstream)).toBe(upstream);
  });

  it('rewrites to configured base when set', () => {
    setModelCdn('https://models.example.com');
    expect(modelUrl('foo/model.onnx', 'https://huggingface.co/foo/model.onnx')).toBe(
      'https://models.example.com/foo/model.onnx',
    );
  });

  it('strips trailing slash from base', () => {
    setModelCdn('https://models.example.com/');
    expect(modelUrl('foo/x.bin', 'https://upstream/foo/x.bin')).toBe(
      'https://models.example.com/foo/x.bin',
    );
  });

  it('strips leading slash from path', () => {
    setModelCdn('https://models.example.com');
    expect(modelUrl('/foo/x.bin', 'https://upstream/foo/x.bin')).toBe(
      'https://models.example.com/foo/x.bin',
    );
  });

  it('resets when called with null', () => {
    setModelCdn('https://models.example.com');
    expect(getModelCdn()).toBe('https://models.example.com');
    setModelCdn(null);
    expect(getModelCdn()).toBe(null);
  });

  it('resets when called with empty string', () => {
    setModelCdn('https://models.example.com');
    setModelCdn('');
    expect(getModelCdn()).toBe(null);
  });

  it('resets when called with no arguments', () => {
    setModelCdn('https://models.example.com');
    setModelCdn();
    expect(getModelCdn()).toBe(null);
  });

  it('restores each runtime host without changing its model revision template', () => {
    const first = {
      remoteHost: 'https://huggingface.co/',
      remotePathTemplate: '{model}/resolve/{revision}/',
    };
    const second = {
      remoteHost: 'https://other.example/',
      remotePathTemplate: '{model}/resolve/{revision}/',
    };
    setModelCdn('https://models.example.com');
    applyModelCdnToTransformersEnv(first);
    applyModelCdnToTransformersEnv(second);
    expect(first.remoteHost).toBe('https://models.example.com');
    expect(second.remoteHost).toBe('https://models.example.com');
    expect(first.remotePathTemplate).toBe('{model}/resolve/{revision}/');
    setModelCdn(null);
    applyModelCdnToTransformersEnv(first);
    applyModelCdnToTransformersEnv(second);
    expect(first.remoteHost).toBe('https://huggingface.co/');
    expect(second.remoteHost).toBe('https://other.example/');
  });

  it('restores the imported official runtime after an asynchronous reset', async () => {
    const { env } = await import('@huggingface/transformers');
    const originalHost = env.remoteHost;
    const originalTemplate = env.remotePathTemplate;
    setModelCdn('https://models.example.com');
    await vi.waitFor(() => expect(env.remoteHost).toBe('https://models.example.com'));
    expect(env.remotePathTemplate).toBe(originalTemplate);
    setModelCdn(null);
    await vi.waitFor(() => expect(env.remoteHost).toBe(originalHost));
  });

  it.each(['.asyncify', ''])(
    'remaps and restores the official %s WASM choice after blob caching',
    (suffix) => {
      const version = '1.31.0-dev.20260914-8d85527a0';
      const original = {
        mjs: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort-wasm-simd-threaded${suffix}.mjs`,
        wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort-wasm-simd-threaded${suffix}.wasm`,
      };
      const wasm = { wasmPaths: { ...original } };
      const env = {
        remoteHost: 'https://huggingface.co/',
        backends: { onnx: { versions: { web: version }, wasm } },
      };
      setModelCdn('https://models.wyreup.com');
      applyModelCdnToTransformersEnv(env);
      expect(wasm.wasmPaths.wasm).toBe(
        original.wasm.replace('https://cdn.jsdelivr.net/npm', 'https://models.wyreup.com'),
      );
      expect(wasm.wasmPaths.mjs).toBe(
        original.mjs.replace('https://cdn.jsdelivr.net/npm', 'https://models.wyreup.com'),
      );
      wasm.wasmPaths.mjs = 'blob:factory';
      applyModelCdnToTransformersEnv(env);
      expect(wasm.wasmPaths.mjs).toBe(
        original.mjs.replace('https://cdn.jsdelivr.net/npm', 'https://models.wyreup.com'),
      );
      setModelCdn(null);
      applyModelCdnToTransformersEnv(env);
      expect(wasm.wasmPaths).toEqual(original);
    },
  );

  it('rejects unsupported browser runtime versions and filenames while native Node remains available', () => {
    setModelCdn('https://models.wyreup.com');
    expect(() =>
      applyModelCdnToTransformersEnv({ backends: { onnx: { versions: { node: '1.30.0' } } } }),
    ).not.toThrow();
    expect(() =>
      applyModelCdnToTransformersEnv({
        backends: { onnx: { versions: { web: '999.0' }, wasm: {} } },
      }),
    ).toThrow('Unpinned');
    expect(() =>
      applyModelCdnToTransformersEnv({
        backends: {
          onnx: {
            versions: { web: '1.31.0-dev.20260914-8d85527a0' },
            wasm: {
              wasmPaths: {
                mjs: 'https://example.com/other.mjs',
                wasm: 'https://example.com/other.wasm',
              },
            },
          },
        },
      }),
    ).toThrow('Unpinned');
  });
});
