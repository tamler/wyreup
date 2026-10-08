/** Decode uploaded bytes for Transformers.js in Node and browsers. */
export async function transformerImage(blob: Blob) {
  const { RawImage } = await import('@huggingface/transformers');
  return RawImage.fromBlob(blob);
}
