import { assertUnicode, type ToolModule, type ToolProgress } from '@wyreup/core/execution';

export const LIVE_TEXT_BYTES = 1024 * 1024;
export const LIVE_TEXT_IDS = [
  'word-counter',
  'json-formatter',
  'json-path',
  'markdown-to-html',
] as const;
export type LiveTextStatus = 'idle' | 'waiting' | 'running' | 'done' | 'error';
export type LiveTextModule = Pick<ToolModule<Record<string, unknown>>, 'id' | 'cost' | 'run'>;
export interface LiveTextSnapshot {
  status: LiveTextStatus;
  error: string;
  blob: Blob | null;
  text: string;
  progress: ToolProgress;
}

export function allowsEmptyText(id: string, params: Record<string, unknown>): boolean {
  return (
    id === 'word-counter' ||
    id === 'markdown-to-html' ||
    id === 'remove-duplicate-lines-online' ||
    id === 'javascript-minifier' ||
    (id === 'number-base-converter' && params.conversionKind === 'utf8-bytes')
  );
}

export function checkTextUnicode(id: string, params: Record<string, unknown>, text: string): void {
  if (
    id === 'word-counter' ||
    (id === 'number-base-converter' && params.conversionKind === 'utf8-bytes')
  )
    assertUnicode(text);
}

export function createLiveTextSession(options: {
  id: string;
  load: () => Promise<LiveTextModule>;
  publish: (snapshot: LiveTextSnapshot) => void;
  prepare?: (blob: Blob, text: string) => { blob: Blob; text: string };
  schedule?: typeof setTimeout;
  unschedule?: typeof clearTimeout;
}) {
  if (!LIVE_TEXT_IDS.some((id) => id === options.id))
    throw new Error('This tool does not support automatic local runs.');
  const schedule = options.schedule ?? setTimeout;
  const unschedule = options.unschedule ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let generation = 0;
  let disposed = false;
  let snapshot: LiveTextSnapshot = {
    status: 'idle',
    error: '',
    blob: null,
    text: '',
    progress: { stage: 'processing' },
  };
  const publish = (patch: Partial<LiveTextSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    if (!disposed) options.publish(snapshot);
  };
  const invalidate = () => {
    generation++;
    if (timer !== null) unschedule(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };
  const current = (own: number) => !disposed && own === generation;
  async function run(own: number, text: string, params: Record<string, unknown>) {
    if (!current(own)) return;
    timer = null;
    const abort = new AbortController();
    controller = abort;
    publish({
      status: 'running',
      progress: { stage: 'processing', message: 'Calculating locally…' },
    });
    try {
      const module = await options.load();
      if (!current(own)) return;
      if (module.id !== options.id || module.cost === 'credit')
        throw new Error('Automatic runs require the selected free local tool.');
      const result = await module.run(
        [new File([text], 'input.txt', { type: 'text/plain' })],
        params,
        {
          signal: abort.signal,
          cache: new Map(),
          executionId: crypto.randomUUID(),
          onProgress: (progress) => {
            if (current(own)) publish({ progress });
          },
        },
      );
      if (!current(own)) return;
      const outputs = Array.isArray(result) ? result : [result];
      const blob = outputs[0];
      if (outputs.length !== 1 || !blob) throw new Error('Expected one text result.');
      if (blob.size > LIVE_TEXT_BYTES)
        throw new Error('Live output exceeds 1 MiB. Use the file tool for larger work.');
      const output = await blob.text();
      if (!current(own)) return;
      const prepared = options.prepare ? options.prepare(blob, output) : { blob, text: output };
      if (
        prepared.blob.size > LIVE_TEXT_BYTES ||
        new TextEncoder().encode(prepared.text).length > LIVE_TEXT_BYTES
      )
        throw new Error('Live output exceeds 1 MiB. Use the file tool for larger work.');
      publish({ status: 'done', blob: prepared.blob, text: prepared.text });
    } catch (error) {
      if (current(own))
        publish({
          status: 'error',
          error: error instanceof Error ? error.message : 'Calculation failed.',
        });
    } finally {
      if (current(own)) controller = null;
    }
  }
  return {
    update(text: string, params: Record<string, unknown>, valid: boolean) {
      if (disposed) return;
      invalidate();
      publish({
        status: 'idle',
        error: '',
        blob: null,
        text: '',
        progress: { stage: 'processing' },
      });
      if (
        !valid ||
        ((options.id === 'json-formatter' || options.id === 'json-path') && text.trim() === '')
      )
        return;
      try {
        checkTextUnicode(options.id, params, text);
        if (new TextEncoder().encode(text).length > LIVE_TEXT_BYTES)
          throw new Error('Live input exceeds 1 MiB. Use the file tool for larger work.');
      } catch (error) {
        publish({
          status: 'error',
          error: error instanceof Error ? error.message : 'Check the input.',
        });
        return;
      }
      publish({ status: 'waiting' });
      const own = generation;
      const capturedParams = { ...params };
      timer = schedule(() => {
        void run(own, text, capturedParams);
      }, 300);
    },
    cancel() {
      invalidate();
      publish({ status: 'idle', error: '', blob: null, text: '' });
    },
    dispose() {
      disposed = true;
      invalidate();
    },
  };
}
