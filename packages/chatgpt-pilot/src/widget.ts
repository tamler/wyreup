import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { configuredOutputOrigins, inspectDownloadUrl } from '../scripts/output-delivery.mjs';

const MAX_BYTES = 7 * 1024 * 1024;
const MAX_ENVELOPE = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = 20_000;
type Output = { name: string; mimeType: string; bytes: number; base64: string; sha256: string };
type FileHelpers = {
  uploadFile(file: File, options: { library: false }): unknown;
  getFileDownloadUrl(options: { fileId: string }): unknown;
  openExternal(options: { href: string; redirectUrl: false }): unknown;
};
const extension = (window as Window & { openai?: Partial<FileHelpers> }).openai;
const helpers = extension && typeof extension.uploadFile === 'function'
  && typeof extension.getFileDownloadUrl === 'function' && typeof extension.openExternal === 'function'
  ? Object.freeze({ uploadFile: extension.uploadFile.bind(extension), getFileDownloadUrl: extension.getFileDownloadUrl.bind(extension),
    openExternal: extension.openExternal.bind(extension) }) : undefined;
let outputOrigins: readonly string[] = [];
let configurationValid = true;
try {
  const raw = document.getElementById('wyreup-output-origins')?.textContent;
  if (raw !== undefined && raw !== null) {
    if (raw.length > 4096) throw new Error('Invalid output configuration');
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('Invalid output configuration');
    outputOrigins = configuredOutputOrigins(values.join(','));
    if (outputOrigins.length !== values.length || outputOrigins.some((origin, index) => origin !== values[index])) throw new Error('Invalid output configuration');
  }
} catch { configurationValid = false; }
const root = document.getElementById('wyreup-result');
if (!root) throw new Error('Missing result mount');
const style = document.createElement('style');
style.textContent = 'body{margin:0;font:15px/1.5 system-ui,sans-serif;color:light-dark(#172332,#edf3fa);background:light-dark(#fff,#172332);color-scheme:light dark}section{padding:20px;max-width:640px}h2{font-size:19px;margin:0 0 12px}p{margin:10px 0}button{font:inherit;padding:9px 16px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer}button:focus-visible{outline:3px solid #4084e6;outline-offset:3px}button:disabled{opacity:.5;cursor:default}.disclosure{font-size:13px;opacity:.85}';
document.head.append(style);
const section = document.createElement('section');
const heading = document.createElement('h2');
heading.textContent = 'Wyreup file result';
const details = document.createElement('p');
details.id = 'details';
const status = document.createElement('p');
status.id = 'status';
status.setAttribute('role', 'status');
status.setAttribute('aria-live', 'polite');
status.textContent = 'Waiting for the file result.';
const download = document.createElement('button');
download.id = 'download';
download.type = 'button';
download.textContent = 'Download file';
download.disabled = true;
const openDownload = document.createElement('button');
openDownload.id = 'open-download';
openDownload.type = 'button';
openDownload.textContent = 'Open download';
const verification = document.createElement('details');
verification.id = 'file-verification';
const verificationLabel = document.createElement('summary');
verificationLabel.textContent = 'File verification (SHA-256)';
const digest = document.createElement('code');
digest.id = 'output-sha256';
digest.style.overflowWrap = 'anywhere';
verification.append(verificationLabel, digest);
const privacy = document.createElement('p');
privacy.className = 'disclosure';
privacy.textContent = 'Inputs and output bytes pass through OpenAI, including this download. Processing runs on the operator’s host. Wyreup keeps no server-side job files. This mounted ChatGPT card retains the result until cancellation or teardown; OpenAI retention policies apply.';
const limits = document.createElement('p');
limits.className = 'disclosure';
limits.textContent = 'Compression can convert PNG to JPEG and lose transparency. Metadata removal re-encodes pixels and preserves orientation; it does not redact visible content. PDF merging preserves document contents and does not sanitize active content.';
section.append(heading, details, status, download, privacy, limits);
root.append(section);

const app = new App({ name: 'Wyreup private pilot', version: '0.1.0' }, {});
let output: Output | undefined;
let received = false;
let generation = 0;
let pending = false;
let controller: AbortController | undefined;
let route: 'standard' | 'optional' | undefined;
let outputId: string | undefined;
let signedUrl: string | undefined;
let preparedAt = 0;
let preparedTimer: ReturnType<typeof setTimeout> | undefined;
let uploadOutstanding = false;
let optionalAttempt = 0;
const localCancellations = new Set<() => void>();
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function removePrepared() {
  if (preparedTimer !== undefined) clearTimeout(preparedTimer);
  preparedTimer = undefined;
  signedUrl = undefined;
  preparedAt = 0;
  openDownload.remove();
}
function optionalButton() {
  download.textContent = outputId ? 'Refresh download URL' : 'Prepare download with OpenAI';
  download.disabled = !output || pending || uploadOutstanding;
}
function clear(message: string) {
  received = true;
  generation++;
  controller?.abort();
  controller = undefined;
  output = undefined;
  outputId = undefined;
  uploadOutstanding = false;
  optionalAttempt++;
  for (const cancel of Array.from(localCancellations)) cancel();
  removePrepared();
  verification.remove();
  digest.textContent = '';
  pending = false;
  download.disabled = true;
  details.textContent = '';
  status.textContent = message;
}
function bounded(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_ENVELOPE;
}
function validOutput(value: unknown): value is Output {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'base64,bytes,mimeType,name,sha256') return false;
  const names: Record<string, string[]> = {
    'image/jpeg': ['compressed.jpg', 'metadata-removed.jpg'],
    'image/png': ['compressed.png', 'metadata-removed.png'],
    'image/webp': ['compressed.webp', 'metadata-removed.webp'],
    'application/pdf': ['merged.pdf'],
  };
  return typeof value.mimeType === 'string' && typeof value.name === 'string'
    && (names[value.mimeType]?.includes(value.name) ?? false)
    && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= MAX_BYTES
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
    && typeof value.base64 === 'string' && value.base64.length === 4 * Math.ceil(value.bytes / 3)
    && value.base64.endsWith('='.repeat((3 - value.bytes % 3) % 3))
    && !/[^A-Za-z0-9+/]/.test(value.base64.slice(0, value.base64.length - (3 - value.bytes % 3) % 3))
    && (value.bytes % 3 === 0 || ('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      .indexOf(value.base64.charAt(value.base64.length - (value.bytes % 3 === 1 ? 3 : 2)))
      & (value.bytes % 3 === 1 ? 15 : 3)) === 0);
}
async function handleResult(result: Parameters<NonNullable<typeof app.ontoolresult>>[0]): Promise<void> {
  if (received) return;
  received = true;
  const current = generation;
  try {
    if (!bounded(result)) throw new Error('Oversized result');
    const structured = result.structuredContent;
    if (result.isError || !object(structured) || structured.status !== 'success') {
      const code = object(structured) && typeof structured.code === 'string' ? structured.code : 'TOOL_ERROR';
      const host = object(structured) && code === 'FILE_HOST_NOT_ENABLED' && typeof structured.downloadHost === 'string'
        && /^[a-z0-9.-]{1,253}$/.test(structured.downloadHost) ? ' Upload hostname: ' + structured.downloadHost + '.' : '';
      clear('File processing failed (' + code.replace(/[^A-Z_]/g, '').slice(0, 64) + '). No download is available.' + host);
      return;
    }
    const candidate = result._meta?.output;
    if (!validOutput(candidate) || !object(structured.output)
      || structured.output.name !== candidate.name || structured.output.mimeType !== candidate.mimeType
      || structured.output.bytes !== candidate.bytes || structured.targetReached === false
      || typeof structured.operation !== 'string'
      || !['compress_image_to_size', 'strip_image_metadata', 'merge_pdfs'].includes(structured.operation)) throw new Error('Invalid output');
    const prefix = structured.operation === 'compress_image_to_size' ? 'compressed.'
      : structured.operation === 'strip_image_metadata' ? 'metadata-removed.' : 'merged.';
    if (!candidate.name.startsWith(prefix) || (structured.operation === 'merge_pdfs') !== (candidate.mimeType === 'application/pdf')) throw new Error('Mismatched output operation');
    if (structured.operation === 'compress_image_to_size' && (structured.targetReached !== true
      || typeof structured.targetBytes !== 'number' || !Number.isSafeInteger(structured.targetBytes)
      || structured.targetBytes < 10 * 1024 || structured.targetBytes > 10240 * 1024
      || candidate.bytes > structured.targetBytes)) throw new Error('Invalid compression target');
    const bytes = Uint8Array.from(atob(candidate.base64), (character) => character.charCodeAt(0));
    if (bytes.length !== candidate.bytes) throw new Error('Length mismatch');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) => value.toString(16).padStart(2, '0')).join('');
    if (hash !== candidate.sha256) throw new Error('Checksum mismatch');
    if (current !== generation) return;
    output = Object.freeze({ ...candidate });
    details.textContent = candidate.name + ' · ' + candidate.bytes.toLocaleString() + ' bytes · ' + candidate.mimeType;
    digest.textContent = candidate.sha256;
    details.after(verification);
    if (!app.getHostCapabilities()?.downloadFile) {
      if (helpers && configurationValid) {
        route = 'optional';
        status.textContent = 'File verified. Prepare download with OpenAI uploads these verified output bytes again without requesting Library saving. OpenAI retention applies.';
        privacy.textContent += ' Closing this card cannot cancel remote uploads; rerunning may create another remote copy.';
        optionalButton();
        return;
      }
      status.textContent = !configurationValid ? 'Output delivery configuration is invalid. No download is available.'
        : 'Unsupported host: this ChatGPT host does not offer file downloads. Try a host with the standard download-file capability.';
      return;
    }
    route = 'standard';
    status.textContent = 'File verified. Choose Download file to ask ChatGPT to save it.';
    download.disabled = false;
  } catch {
    if (current === generation) clear('Result validation failed. No download is available.');
  }
}
app.ontoolresult = (result) => { void handleResult(result); };
app.ontoolcancelled = () => clear('Cancelled. The result has been cleared.');
app.onteardown = () => { clear('Closed. The result has been cleared.'); return {}; };
app.onerror = () => {};
app.onclose = () => clear('Connection lost. Download failed; reconnect and run the tool again.');
window.addEventListener('pagehide', () => clear('Closed. The result has been cleared.'), { once: true });
async function handleDownload(): Promise<void> {
  if (!output || pending || download.disabled) return;
  const current = generation;
  const selected = output;
  const params = { contents: [{ type: 'resource' as const, resource: { uri: 'file:///' + selected.name, mimeType: selected.mimeType, blob: selected.base64 } }] };
  if (!bounded({ jsonrpc: '2.0', id: Number.MAX_SAFE_INTEGER, method: 'ui/download-file', params })) {
    clear('Download failed: output exceeds the supported envelope limit.');
    return;
  }
  pending = true;
  download.disabled = true;
  controller = new AbortController();
  status.textContent = 'Waiting for ChatGPT to handle the download.';
  try {
    const response = await app.downloadFile(params, { timeout: DOWNLOAD_TIMEOUT, signal: controller.signal });
    if (current !== generation) return;
    status.textContent = response.isError ? 'Download failed or was denied. Choose Download file to retry explicitly.' : 'ChatGPT accepted the download. Check your downloads for the file.';
  } catch {
    if (current === generation) status.textContent = 'Download failed, timed out, or was cancelled. Choose Download file to retry explicitly.';
  } finally {
    if (current === generation) { pending = false; controller = undefined; download.disabled = !output; }
  }
}
function acceptedId(value: unknown): string | undefined {
  if (!object(value)) return undefined;
  const id = value.fileId;
  return typeof id === 'string' && id.length > 0 && id.length <= 256
    && !Array.from(id).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ? id : undefined;
}
function withinDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); localCancellations.delete(cancel); };
    const cancel = () => { stop(); reject(new Error('Local action cancelled or timed out')); };
    const timer = setTimeout(cancel, Math.max(0, deadline - Date.now()));
    localCancellations.add(cancel);
    promise.then(value => { stop(); resolve(value); }, () => { stop(); reject(new Error('Host request failed')); });
  });
}
async function prepareDownload(): Promise<void> {
  if (!output || !helpers || pending || uploadOutstanding || download.disabled) return;
  let selected: Output | undefined = output;
  const current = generation;
  const attempt = ++optionalAttempt;
  const active = () => selected !== undefined && current === generation && output === selected && attempt === optionalAttempt;
  const cancelPreparation = () => { selected = undefined; localCancellations.delete(cancelPreparation); };
  localCancellations.add(cancelPreparation);
  const deadline = Date.now() + DOWNLOAD_TIMEOUT;
  let finished = false;
  pending = true;
  removePrepared();
  optionalButton();
  status.textContent = outputId ? 'Refreshing the download URL without uploading again.' : 'Preparing the verified file with OpenAI. Cancellation cannot undo a remote upload.';
  try {
    if (!outputId) {
      if (!selected) return;
      const bytes = Uint8Array.from(atob(selected.base64), character => character.charCodeAt(0));
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
      if (!active()) return;
      if (bytes.length !== selected.bytes || hash !== selected.sha256 || Date.now() >= deadline) throw new Error('Invalid output');
      const file = new File([bytes], selected.name, { type: selected.mimeType });
      uploadOutstanding = true;
      let uploaded: Promise<unknown>;
      try { uploaded = Promise.resolve(helpers.uploadFile(file, { library: false })); }
      catch { uploadOutstanding = false; throw new Error('Upload failed'); }
      const observed = uploaded.then(value => {
        if (finished) localCancellations.delete(cancelPreparation);
        if (!active()) return undefined;
        uploadOutstanding = false;
        const id = acceptedId(value);
        if (id) outputId = id;
        if (finished) {
          pending = false;
          optionalButton();
          status.textContent = id ? 'Upload completed after timeout. Choose Refresh download URL explicitly; no new upload is needed.'
            : 'The upload settled without a usable ID. A remote copy may exist. Choose Prepare download with OpenAI explicitly to try again.';
        }
        return id;
      }, () => {
        if (finished) localCancellations.delete(cancelPreparation);
        if (active()) {
          uploadOutstanding = false;
          if (finished) {
            pending = false;
            optionalButton();
            status.textContent = 'The upload settled without a usable ID. A remote copy may exist. Choose Prepare download with OpenAI explicitly to try again.';
          }
        }
        throw new Error('Upload failed');
      });
      const id = await withinDeadline(observed, deadline);
      if (!active()) return;
      if (!id) throw new Error('Invalid upload response');
    }
    const fileId = outputId;
    if (!fileId || !active() || Date.now() >= deadline) throw new Error('Preparation timed out');
    const response = await withinDeadline(Promise.resolve(helpers.getFileDownloadUrl({ fileId })), deadline);
    if (!active()) return;
    const destination = inspectDownloadUrl(object(response) ? response.downloadUrl : undefined, outputOrigins);
    if (!destination.url) {
      removePrepared();
      status.textContent = 'Download destination not enabled. Output origin: ' + destination.origin + '. No link was opened. Ask the operator to approve this exact origin, then refresh explicitly.';
      return;
    }
    signedUrl = destination.url;
    preparedAt = Date.now();
    download.after(openDownload);
    openDownload.disabled = false;
    status.textContent = 'Download prepared. Choose Open download to ask OpenAI to open it. A saved file has not yet been verified.';
    preparedTimer = setTimeout(() => {
      if (!active()) return;
      removePrepared();
      status.textContent = 'Download preparation expired. Choose Refresh download URL; the existing output ID is reused.';
      optionalButton();
    }, DOWNLOAD_TIMEOUT);
  } catch {
    if (active()) {
      removePrepared();
      status.textContent = uploadOutstanding ? 'Preparation timed out while the upload is still outstanding. Another upload is blocked in this card; a remote copy may exist.'
        : outputId ? 'Preparation failed or timed out. Choose Refresh download URL explicitly to reuse the existing output without uploading again.'
          : 'Preparation failed or timed out. A remote copy may exist. Choose Prepare download with OpenAI explicitly to try again.';
    }
  } finally {
    finished = true;
    if (!uploadOutstanding) localCancellations.delete(cancelPreparation);
    if (active()) { pending = uploadOutstanding; optionalButton(); }
  }
}
async function openPreparedDownload(): Promise<void> {
  if (!output || !helpers || pending || !signedUrl || openDownload.disabled) return;
  const current = generation;
  const attempt = ++optionalAttempt;
  const original = signedUrl;
  try {
    if (Date.now() - preparedAt >= DOWNLOAD_TIMEOUT) throw new Error('Expired preparation');
    const destination = inspectDownloadUrl(original, outputOrigins);
    if (!destination.url || destination.url !== original) throw new Error('Unapproved destination');
  } catch {
    removePrepared();
    status.textContent = 'Download preparation expired or is invalid. Choose Refresh download URL; the existing output ID is reused.';
    return;
  }
  pending = true;
  optionalButton();
  openDownload.disabled = true;
  status.textContent = 'Asking OpenAI to open the prepared download.';
  try {
    const response = helpers.openExternal({ href: original, redirectUrl: false });
    removePrepared();
    const outcome = await withinDeadline(Promise.resolve(response), Date.now() + DOWNLOAD_TIMEOUT);
    if (current !== generation || attempt !== optionalAttempt) return;
    if (outcome === false || (object(outcome) && outcome.isError === true)) throw new Error('Opening denied');
    status.textContent = 'Download request submitted to OpenAI. Check your downloads; a saved file has not been verified.';
  } catch {
    if (current === generation && attempt === optionalAttempt) status.textContent = 'Opening failed or timed out. Choose Refresh download URL explicitly; no new upload is needed.';
  } finally {
    if (current === generation && attempt === optionalAttempt) { removePrepared(); pending = false; optionalButton(); }
  }
}
download.addEventListener('click', () => { void (route === 'optional' ? prepareDownload() : handleDownload()); });
openDownload.addEventListener('click', () => { void openPreparedDownload(); });
void app.connect(new PostMessageTransport(window.parent, window.parent)).catch(() => clear('Connection failed. Reconnect and run the tool again.'));
