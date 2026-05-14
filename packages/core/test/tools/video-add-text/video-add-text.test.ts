/**
 * video-add-text tests
 *
 * 1. Metadata — always run.
 * 2. Helper functions (positionToXY, escapeDrawtext, hexToFfmpegColor, buildDrawtextFilter) — always run.
 * 3. run() — requires ffmpeg.wasm. Skipped in Node.
 */

import { describe, it, expect } from 'vitest';
import {
  videoAddText,
  defaultVideoAddTextParams,
  positionToXY,
  escapeDrawtext,
  hexToFfmpegColor,
  buildDrawtextFilter,
} from '../../../src/tools/video-add-text/index.js';

describe('video-add-text — metadata', () => {
  it('has id "video-add-text"', () => expect(videoAddText.id).toBe('video-add-text'));
  it('category is "media"', () => expect(videoAddText.category).toBe('media'));
  it('accepts video/*', () => expect(videoAddText.input.accept).toContain('video/*'));
  it('output mime is video/mp4', () => expect(videoAddText.output.mime).toBe('video/mp4'));
  it('installSize is 30 MB', () => expect(videoAddText.installSize).toBe(30_000_000));
  it('installGroup is "ffmpeg"', () => expect(videoAddText.installGroup).toBe('ffmpeg'));
  it('memoryEstimate is "high"', () => expect(videoAddText.memoryEstimate).toBe('high'));
  it('cost is "free"', () => expect(videoAddText.cost).toBe('free'));
  it('batchable is false', () => expect(videoAddText.batchable).toBe(false));
  it('defaults fontSize is 32', () => expect(defaultVideoAddTextParams.fontSize).toBe(32));
  it('defaults position is bottom', () => expect(defaultVideoAddTextParams.position).toBe('bottom'));
  it('defaults fontColor is #FFFFFF', () => expect(defaultVideoAddTextParams.fontColor).toBe('#FFFFFF'));
  it('defaults startSeconds is 0', () => expect(defaultVideoAddTextParams.startSeconds).toBe(0));
  it('defaults crf is 23', () => expect(defaultVideoAddTextParams.crf).toBe(23));
});

describe('video-add-text — positionToXY()', () => {
  it('top -> centered x, y near top', () => {
    const { x, y } = positionToXY('top');
    expect(x).toContain('w-text_w');
    expect(y).toBe('20');
  });

  it('bottom -> centered x, y near bottom', () => {
    const { x, y } = positionToXY('bottom');
    expect(x).toContain('w-text_w');
    expect(y).toContain('h-text_h');
  });

  it('center -> both centered', () => {
    const { x, y } = positionToXY('center');
    expect(x).toContain('w-text_w');
    expect(y).toContain('h-text_h');
  });

  it('top-left -> x=20, y=20', () => {
    const { x, y } = positionToXY('top-left');
    expect(x).toBe('20');
    expect(y).toBe('20');
  });

  it('top-right -> x near right edge', () => {
    const { x } = positionToXY('top-right');
    expect(x).toContain('w-text_w');
  });

  it('bottom-left -> y near bottom', () => {
    const { y } = positionToXY('bottom-left');
    expect(y).toContain('h-text_h');
  });

  it('bottom-right -> x and y near right-bottom', () => {
    const { x, y } = positionToXY('bottom-right');
    expect(x).toContain('w-text_w');
    expect(y).toContain('h-text_h');
  });
});

describe('video-add-text — escapeDrawtext()', () => {
  it('escapes single quotes', () => {
    expect(escapeDrawtext("it's")).toContain("\\'");
  });

  it('escapes colons', () => {
    expect(escapeDrawtext('time: 12:00')).toContain('\\:');
  });

  it('escapes backslashes', () => {
    expect(escapeDrawtext('a\\b')).toContain('\\\\');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeDrawtext('Hello World')).toBe('Hello World');
  });
});

describe('video-add-text — hexToFfmpegColor()', () => {
  it('converts #FFFFFF to 0xFFFFFF', () => {
    expect(hexToFfmpegColor('#FFFFFF')).toBe('0xFFFFFF');
  });

  it('converts shorthand #FFF to 0xFFFFFF', () => {
    expect(hexToFfmpegColor('#FFF')).toBe('0xFFFFFF');
  });

  it('converts #000000 to 0x000000', () => {
    expect(hexToFfmpegColor('#000000')).toBe('0x000000');
  });
});

describe('video-add-text — buildDrawtextFilter()', () => {
  it('includes the text value', () => {
    const f = buildDrawtextFilter({ text: 'Hello', position: 'bottom', fontSize: 32, fontColor: '#FFFFFF' });
    expect(f).toContain("text='Hello'");
  });

  it('includes fontsize', () => {
    const f = buildDrawtextFilter({ text: 'Hi', fontSize: 48, fontColor: '#FFFFFF' });
    expect(f).toContain('fontsize=48');
  });

  it('includes box when backgroundColor is set', () => {
    const f = buildDrawtextFilter({ text: 'Hi', fontColor: '#FFFFFF', backgroundColor: '#000000', backgroundOpacity: 0.5 });
    expect(f).toContain('box=1');
    expect(f).toContain('boxcolor=');
  });

  it('no box when backgroundColor is not set', () => {
    const f = buildDrawtextFilter({ text: 'Hi', fontColor: '#FFFFFF' });
    expect(f).not.toContain('box=1');
  });

  it('includes enable expression for durationSeconds', () => {
    const f = buildDrawtextFilter({ text: 'Hi', fontColor: '#FFFFFF', startSeconds: 2, durationSeconds: 3 });
    expect(f).toContain('enable=');
    expect(f).toContain('between');
  });

  it('includes enable expression for startSeconds > 0 only', () => {
    const f = buildDrawtextFilter({ text: 'Hi', fontColor: '#FFFFFF', startSeconds: 5 });
    expect(f).toContain('enable=');
    expect(f).toContain('gte');
  });

  it('no enable expression when startSeconds=0 and no duration', () => {
    const f = buildDrawtextFilter({ text: 'Hi', fontColor: '#FFFFFF', startSeconds: 0 });
    expect(f).not.toContain('enable=');
  });
});

// run() skipped in Node — ffmpeg.wasm requires SharedArrayBuffer (COOP/COEP) and CDN fetch.
