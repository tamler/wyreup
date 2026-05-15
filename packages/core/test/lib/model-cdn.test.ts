import { describe, it, expect, afterEach } from 'vitest';
import { setModelCdn, getModelCdn, modelUrl } from '../../src/lib/model-cdn.js';

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
});
