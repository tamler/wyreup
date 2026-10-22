export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
  }
}

/** Enforce the actual streamed byte count, regardless of Content-Length. */
export async function readJsonObject(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('Content-Length')) > maxBytes) {
    await request.body?.cancel();
    throw new RequestBodyError('Request body too large', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestBodyError('JSON object required', 400);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new RequestBodyError('Request body too large', 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new RequestBodyError('JSON object required', 400);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError('Invalid JSON body', 400);
  } finally {
    reader.releaseLock();
  }
}
