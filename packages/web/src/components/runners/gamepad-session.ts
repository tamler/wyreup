import type { GamepadReport } from '@wyreup/core';

export interface GamepadSessionOptions {
  read: () => GamepadReport;
  publish: (report: GamepadReport) => void;
  fail: (error: unknown) => void;
  stopped: (reason: string) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  windowTarget: EventTarget;
  documentTarget: EventTarget;
  hidden: () => boolean;
}
export function createGamepadSession(options: GamepadSessionOptions) {
  let active = false,
    disposed = false,
    handle: number | null = null,
    generation = 0;
  const connection = () => refresh();
  const visibility = () => {
    if (options.hidden()) stop('Stopped because the tab is hidden.');
  };
  function stop(reason = 'Stopped.') {
    generation++;
    active = false;
    if (handle !== null) options.cancelFrame(handle);
    handle = null;
    options.windowTarget.removeEventListener('gamepadconnected', connection);
    options.windowTarget.removeEventListener('gamepaddisconnected', connection);
    options.documentTarget.removeEventListener('visibilitychange', visibility);
    options.stopped(reason);
  }
  function refresh() {
    if (!active || disposed) return;
    try {
      const result = options.read();
      if (active && !disposed) options.publish(result);
    } catch (error) {
      stop('Stopped after a reading error.');
      options.fail(error);
    }
  }
  function frame() {
    handle = null;
    const own = generation;
    if (!active || disposed) return;
    refresh();
    if (active && !disposed && generation === own) handle = options.requestFrame(frame);
  }
  function start() {
    if (disposed || active) return;
    if (options.hidden()) {
      options.stopped('Start in a visible tab.');
      return;
    }
    active = true;
    generation++;
    options.windowTarget.addEventListener('gamepadconnected', connection);
    options.windowTarget.addEventListener('gamepaddisconnected', connection);
    options.documentTarget.addEventListener('visibilitychange', visibility);
    refresh();
    if (active) handle = options.requestFrame(frame);
  }
  function dispose() {
    if (disposed) return;
    stop('Disposed.');
    disposed = true;
  }
  return { start, stop, dispose, isActive: () => active };
}
