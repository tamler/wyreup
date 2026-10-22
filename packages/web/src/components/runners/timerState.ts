import { validatePlanningSnapshot, type CountdownSnapshot, type StopwatchSnapshot } from '@wyreup/core/execution';

export class TimerState {
  private accumulatedMs = 0;
  private startedAt = 0;
  private running = false;
  private completed = false;
  private completionPending = false;
  private clockLast = -Infinity;
  laps: { totalMs: number; deltaMs: number }[] = [];
  constructor(readonly kind: 'stopwatch' | 'countdown', private readonly now: () => number, public durationMs = 300000) {
    if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 86400000) throw new Error('Duration must be 1 second to 24 hours.');
  }
  private time() {
    const value = this.now();
    if (!Number.isFinite(value) || value < this.clockLast) throw new Error('A finite monotonic clock is required.');
    this.clockLast = value;
    return value;
  }
  get limit() { return this.kind === 'countdown' ? this.durationMs : 604800000; }
  elapsed() { return Math.min(this.limit, this.accumulatedMs + (this.running ? this.time() - this.startedAt : 0)); }
  get state(): 'running' | 'paused' | 'done' { return this.completed && this.kind === 'countdown' ? 'done' : this.running ? 'running' : 'paused'; }
  start() { if (this.running || this.completed) return; this.startedAt = this.time(); this.running = true; }
  pause() { this.accumulatedMs = this.settle(); this.running = false; }
  pauseAtLastSample() {
    if (!this.running) return;
    this.accumulatedMs = this.settle(Math.min(this.limit, this.accumulatedMs + this.clockLast - this.startedAt));
    this.running = false;
  }
  reset() { this.running = false; this.completed = false; this.completionPending = false; this.accumulatedMs = 0; this.startedAt = 0; this.laps = []; }
  private settle(elapsedMs = this.elapsed()) {
    if (!this.running || elapsedMs < this.limit) return elapsedMs;
    this.accumulatedMs = elapsedMs; this.running = false;
    if (this.kind === 'countdown') { this.completed = true; this.completionPending = true; }
    return elapsedMs;
  }
  tick(): boolean {
    this.settle(); return this.takeCompletion();
  }
  takeCompletion(): boolean { const completed = this.completionPending; this.completionPending = false; return completed; }
  lap() {
    if (this.kind !== 'stopwatch' || !this.running) throw new Error('Start the stopwatch before recording a lap.');
    if (this.laps.length >= 200) throw new Error('Maximum 200 laps.');
    const totalMs = this.settle(); const previous = this.laps.at(-1)?.totalMs ?? 0;
    this.laps = [...this.laps, { totalMs, deltaMs: totalMs - previous }];
  }
  setDuration(durationMs: number) {
    if (this.running) throw new Error('Pause before replacing the duration.');
    if (!Number.isFinite(durationMs) || durationMs < 1000 || durationMs > 86400000) throw new Error('Duration must be 1 second to 24 hours.');
    this.durationMs = durationMs; this.reset();
  }
  snapshot(): StopwatchSnapshot | CountdownSnapshot {
    const elapsedMs = this.settle();
    return this.kind === 'stopwatch' ? { version: 1, kind: 'stopwatch', state: this.state === 'running' ? 'running' : 'paused', elapsedMs, laps: this.laps.map(lap => ({ ...lap })) } : { version: 1, kind: 'countdown', state: this.state, durationMs: this.durationMs, elapsedMs };
  }
  restore(value: unknown) {
    const snapshot = validatePlanningSnapshot(value, this.kind);
    if (snapshot.kind === 'seating') throw new Error('Not a timer snapshot.');
    this.running = false; this.accumulatedMs = snapshot.elapsedMs;
    this.completed = snapshot.kind === 'countdown' && snapshot.state === 'done';
    this.completionPending = false;
    this.laps = snapshot.kind === 'stopwatch' ? snapshot.laps.map(lap => ({ ...lap })) : [];
    if (snapshot.kind === 'countdown') this.durationMs = snapshot.durationMs;
  }
}
export function timerDisplay(milliseconds: number): string {
  const total = Math.floor(milliseconds / 10); const hours = Math.floor(total / 360000); const minutes = Math.floor(total / 6000) % 60; const seconds = Math.floor(total / 100) % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(total % 100).padStart(2, '0')}`;
}
