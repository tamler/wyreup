import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { downloadFile } from './download.js';
import { LIMITS, PilotError } from './limits.js';
import type { ImageArguments, JobResult, MergeArguments, Operation, WorkerRequest, WorkerResponse } from './types.js';

export interface JobDependencies {
  download: typeof downloadFile;
  workerUrl: URL;
}

async function transform(request: WorkerRequest, signal: AbortSignal, workerUrl: URL): Promise<JobResult> {
  if (signal.aborted) throw new PilotError('CANCELLED');
  let worker: Worker | undefined;
  let expired = false;
  let timeoutReject: ((error: PilotError) => void) | undefined;
  const timer = setTimeout(() => {
    expired = true;
    timeoutReject?.(new PilotError('WORKER_TIMEOUT'));
  }, LIMITS.workerMs);
  let onAbort: (() => void) | undefined;
  try {
    worker = new Worker(workerUrl, {
      workerData: request, transferList: request.inputs, env: {}, execArgv: [],
      stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: LIMITS.workerHeapMb, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    worker.stdout.resume();
    worker.stderr.resume();
    const owned = worker;
    const response = await new Promise<WorkerResponse>((resolve, reject) => {
      let settled = false;
      const fail = (error: PilotError): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      timeoutReject = fail;
      onAbort = (): void => fail(new PilotError('CANCELLED'));
      signal.addEventListener('abort', onAbort, { once: true });
      owned.once('error', () => fail(new PilotError('PROCESSING_FAILED')));
      owned.once('exit', () => fail(new PilotError('PROCESSING_FAILED')));
      owned.once('message', (message: WorkerResponse) => {
        if (settled) return;
        settled = true;
        resolve(message);
      });
      if (signal.aborted) onAbort();
      else if (expired) fail(new PilotError('WORKER_TIMEOUT'));
    });
    if (!response.ok) throw new PilotError(response.code, undefined, response.target);
    if (signal.aborted) throw new PilotError('CANCELLED');
    const bytes = new Uint8Array(response.bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength <= 0 || bytes.byteLength > LIMITS.outputBytes ||
        bytes.byteLength !== response.details.output.bytes || sha256 !== response.sha256) {
      throw new PilotError('PROCESSING_FAILED');
    }
    return { details: response.details, output: { ...response.details.output, base64: Buffer.from(bytes).toString('base64'), sha256 } };
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    // Do not release the single-flight slot until this owned worker has exited.
    if (worker) await worker.terminate();
    request.inputs.length = 0;
  }
}

export function createJobController(
  hosts: ReadonlySet<string>,
  dependencies: JobDependencies = { download: downloadFile, workerUrl: new URL('./worker.js', import.meta.url) },
): { run: (operation: Operation, args: ImageArguments | MergeArguments, signal: AbortSignal) => Promise<JobResult> } {
  let busy = false;
  return {
    async run(operation, args, signal) {
      if (busy) throw new PilotError('BUSY');
      busy = true;
      const inputs: ArrayBuffer[] = [];
      try {
        if (signal.aborted) throw new PilotError('CANCELLED');
        const references = 'files' in args ? args.files : [args.file];
        const budget = { remaining: LIMITS.requestBytes };
        for (const reference of references) {
          inputs.push(await dependencies.download(reference.download_url, hosts, budget, signal));
        }
        const imageArgs = 'file' in args ? args : undefined;
        return await transform({ operation, inputs, targetKb: imageArgs?.target_kb ?? 200, allowDownscale: imageArgs?.allow_downscale ?? true }, signal, dependencies.workerUrl);
      } finally {
        inputs.length = 0;
        busy = false;
      }
    },
  };
}
