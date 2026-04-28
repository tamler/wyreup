import type { ToolModule, ToolRunContext } from '../../types.js';

export interface RecordAudioParams {
  /** No params today; here for forward-compat (e.g. sample rate, mono/stereo). */
  _placeholder?: never;
}

export const defaultRecordAudioParams: RecordAudioParams = {};

const RecordAudioComponentStub = (): unknown => null;

/**
 * Push-to-talk audio capture. Web-only — relies on `getUserMedia` +
 * `MediaRecorder`, which CLI / MCP don't have access to. The web
 * runner handles capture interactively; this module exists so the
 * tool appears in the catalog, slots into the chain graph, and
 * declares its output mime so downstream tools (transcribe, audio-
 * enhance, convert-audio, etc.) can be suggested as next steps.
 *
 * Capture is a *primitive* — pair this with `take-photo`,
 * `record-video`, `screen-capture` to give every chain a real
 * "start from your device" entry point.
 */
export const recordAudio: ToolModule<RecordAudioParams> = {
  id: 'record-audio',
  slug: 'record-audio',
  name: 'Record Audio',
  description:
    'Push-to-talk microphone capture. Click record, talk, click stop — the recording is yours to download or chain into another tool.',
  category: 'create',
  presence: 'standalone',
  keywords: [
    'record', 'audio', 'microphone', 'mic', 'voice', 'capture', 'push-to-talk', 'memo',
  ],

  input: {
    accept: [],
    min: 0,
    max: 0,
  },
  output: {
    mime: 'audio/webm',
  },

  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'low',

  // Web-only — getUserMedia is browser-only. The CLI's `list` command
  // and the MCP server's tool registration filter on this so the tool
  // never appears where it can't run. No "use the web UI" runtime
  // failures.
  surfaces: ['web'],

  // Sensible chains for a fresh recording. Most common: transcribe it.
  // Then audio post-processing tools.
  chainSuggestions: [
    'transcribe',
    'audio-enhance',
    'convert-audio',
    'extract-audio',
    'trim-media',
  ],

  defaults: defaultRecordAudioParams,

  Component: RecordAudioComponentStub,

  // The web's RecordAudioRunner handles capture interactively and
  // emits the captured blob as the result; tool.run() is never called
  // from the web path. Because surfaces:['web'] gates this tool out
  // of CLI / MCP, run() is also never called from those surfaces.
  // The body throws as a safety net only — this should be unreachable.
  // eslint-disable-next-line @typescript-eslint/require-await
  async run(_inputs: File[], _params: RecordAudioParams, _ctx: ToolRunContext): Promise<Blob[]> {
    throw new Error(
      'record-audio is a web-only capture primitive; run() should never be reached.',
    );
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['audio/webm'],
  },
};
