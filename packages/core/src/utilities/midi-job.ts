import { cloneUtilityJson, type UtilityParams } from './common.js';
import { createFileWorker } from './file-job-platform.js';
import { runOwnedFileJob, type OwnedFileWorker } from './file-job.js';
import { validatePitchParams, type PitchNote, type PitchReport } from './midi-pitch.js';

export function validatePitchReport(value: unknown): PitchReport {
  const copied = cloneUtilityJson(value, '$pitch');
  if (!copied || typeof copied !== 'object' || Array.isArray(copied))
    throw new Error('Invalid pitch report.');
  const report = copied as Record<string, unknown>;
  if (
    Object.keys(report).sort().join(',') !==
      'analysisRate,duration,notes,status,unvoicedFrames,voicedFrames' ||
    report.analysisRate !== 8000 ||
    typeof report.duration !== 'number' ||
    report.duration <= 0 ||
    report.duration > 120 ||
    !Array.isArray(report.notes) ||
    report.notes.length > 20000 ||
    !['voicedFrames', 'unvoicedFrames'].every(
      (key) =>
        typeof report[key] === 'number' &&
        Number.isInteger(report[key]) &&
        report[key] >= 0 &&
        report[key] <= 3750,
    ) ||
    (report.voicedFrames as number) + (report.unvoicedFrames as number) > 3750 ||
    report.status !== (report.notes.length ? 'notes' : 'no-notes')
  )
    throw new Error('Invalid bounded pitch report.');
  let previousEnd = 0;
  for (let index = 0; index < report.notes.length; index++) {
    const note: unknown = report.notes[index];
    if (!note || typeof note !== 'object' || Array.isArray(note))
      throw new Error('Invalid pitch note.');
    const row = note as Record<string, unknown>;
    if (
      Object.keys(row).sort().join(',') !== 'confidence,end,frequency,id,note,start,velocity' ||
      row.id !== `n${index}` ||
      !['note', 'start', 'end', 'frequency', 'confidence', 'velocity'].every(
        (key) => typeof row[key] === 'number' && Number.isFinite(row[key]),
      ) ||
      !Number.isInteger(row.note) ||
      (row.note as number) < 0 ||
      (row.note as number) > 127 ||
      !Number.isInteger(row.velocity) ||
      (row.velocity as number) < 1 ||
      (row.velocity as number) > 127 ||
      (row.start as number) < previousEnd ||
      (row.end as number) <= (row.start as number) ||
      (row.end as number) > report.duration ||
      (row.frequency as number) < 80 ||
      (row.frequency as number) > 1000 ||
      (row.confidence as number) < 0.5 ||
      (row.confidence as number) > 1
    )
      throw new Error('Invalid bounded pitch note.');
    previousEnd = row.end as number;
  }
  if (new TextEncoder().encode(JSON.stringify(report)).length > 1024 * 1024)
    throw new Error('Pitch report exceeds 1 MiB.');
  return report as unknown as PitchReport;
}

export function runPitchFileJob(
  mono: Float32Array,
  provided: UtilityParams,
  signal: AbortSignal,
  factory: () => Promise<OwnedFileWorker> = createFileWorker,
): Promise<PitchReport> {
  if (signal.aborted) return Promise.reject(new Error('Pitch analysis cancelled.'));
  if (
    !(mono instanceof Float32Array) ||
    !(mono.buffer instanceof ArrayBuffer) ||
    mono.length < 1 ||
    mono.length > 960000
  )
    return Promise.reject(new Error('Pitch input exceeds 120 seconds or is not mono PCM.'));
  const params = validatePitchParams(provided);
  const bytes = new Uint8Array(new Float32Array(mono).buffer);
  return runOwnedFileJob(
    { type: 'midi-pitch', bytes, params },
    signal,
    validatePitchReport,
    factory,
  );
}

export type { PitchNote };
