import { describe, expect, it } from 'vitest';
import { createGamepadSession } from '../src/components/runners/gamepad-session';
describe('owned gamepad polling lifecycle', () => {
  it('does not poll before gesture and removes frames/listeners on hide, stop and dispose', () => {
    let reads = 0,
      hidden = false,
      next = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const win = new EventTarget(),
      doc = new EventTarget(),
      reports: unknown[] = [],
      stops: string[] = [];
    const session = createGamepadSession({
      read: () => {
        reads++;
        return { status: 'no-device', deadZone: 0.1, devices: [] };
      },
      publish: (r) => reports.push(r),
      fail: () => {
        throw new Error('Unexpected failure');
      },
      stopped: (r) => stops.push(r),
      requestFrame: (fn) => {
        frames.set(++next, fn);
        return next;
      },
      cancelFrame: (id) => {
        frames.delete(id);
      },
      windowTarget: win,
      documentTarget: doc,
      hidden: () => hidden,
    });
    expect(reads).toBe(0);
    session.start();
    session.start();
    expect(reads).toBe(1);
    expect(frames.size).toBe(1);
    win.dispatchEvent(new Event('gamepadconnected'));
    expect(reads).toBe(2);
    const abandoned = [...frames.values()][0];
    hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    abandoned(10);
    win.dispatchEvent(new Event('gamepaddisconnected'));
    expect(reads).toBe(2);
    hidden = false;
    session.start();
    expect(reads).toBe(3);
    session.dispose();
    session.start();
    expect(reads).toBe(3);
    expect(frames.size).toBe(0);
    expect(reports).toHaveLength(3);
    expect(stops).toContain('Stopped because the tab is hidden.');
  });
  it('stops visibly on a reading error without rescheduling', () => {
    let errors = 0,
      frames = 0;
    const session = createGamepadSession({
      read: () => {
        throw new Error('Policy denied');
      },
      publish: () => {
        throw new Error('No report');
      },
      fail: () => {
        errors++;
      },
      stopped: () => {},
      requestFrame: () => ++frames,
      cancelFrame: () => {},
      windowTarget: new EventTarget(),
      documentTarget: new EventTarget(),
      hidden: () => false,
    });
    session.start();
    expect(errors).toBe(1);
    expect(frames).toBe(0);
    expect(session.isActive()).toBe(false);
    session.dispose();
  });
});
