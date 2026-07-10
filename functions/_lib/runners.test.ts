import { describe, it, expect, vi } from 'vitest';
import { __readImageBytes, __isDisallowedHost, readImageRef, runPro } from './runners';
import type { Env } from './env';

// A 1x1 PNG, base64.
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function aiEnv(result: unknown) {
  return { AI: { run: vi.fn().mockResolvedValue(result) } } as unknown as Env;
}

describe('ocr-hq runner', () => {
  it('returns extracted text', async () => {
    const env = aiEnv({ response: 'INVOICE 2024' });
    const out = (await runPro('ocr-hq', { imageBase64: TINY_PNG }, env)) as { text: string };
    expect(out.text).toBe('INVOICE 2024');
  });

  it('rejects a missing image', async () => {
    const env = aiEnv({ response: 'x' });
    await expect(runPro('ocr-hq', {}, env)).rejects.toThrow('imageBase64 required');
  });
});

describe('image-describe runner', () => {
  it('returns a description', async () => {
    const env = aiEnv({ response: 'A red bicycle leaning on a wall.' });
    const out = (await runPro('image-describe', { imageBase64: TINY_PNG }, env)) as {
      description: string;
    };
    expect(out.description).toBe('A red bicycle leaning on a wall.');
  });
});

describe('analyze-chart runner', () => {
  it('returns an analysis', async () => {
    const env = aiEnv({ response: 'Bar chart: sales rose Q1 to Q4.' });
    const out = (await runPro('analyze-chart', { imageBase64: TINY_PNG }, env)) as {
      analysis: string;
    };
    expect(out.analysis).toBe('Bar chart: sales rose Q1 to Q4.');
  });
});

describe('image-q-and-a runner', () => {
  it('returns an answer to the question', async () => {
    const env = aiEnv({ response: 'Three people are visible.' });
    const out = (await runPro(
      'image-q-and-a',
      { imageBase64: TINY_PNG, question: 'How many people?' },
      env,
    )) as { answer: string };
    expect(out.answer).toBe('Three people are visible.');
  });

  it('rejects a missing question', async () => {
    const env = aiEnv({ response: 'x' });
    await expect(runPro('image-q-and-a', { imageBase64: TINY_PNG }, env)).rejects.toThrow(
      "'question'",
    );
  });
});

describe('read-handwriting runner', () => {
  it('returns transcribed handwriting', async () => {
    const env = aiEnv({ response: 'Meeting at 3pm' });
    const out = (await runPro('read-handwriting', { imageBase64: TINY_PNG }, env)) as {
      text: string;
    };
    expect(out.text).toBe('Meeting at 3pm');
  });
});

describe('detect-objects runner', () => {
  it('returns detected objects sorted by score', async () => {
    const env = aiEnv([
      { score: 0.5, label: 'dog', box: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } },
      { score: 0.9, label: 'cat', box: { xmin: 2, ymin: 2, xmax: 3, ymax: 3 } },
    ]);
    const out = (await runPro('detect-objects', { imageBase64: TINY_PNG }, env)) as {
      objects: { label: string; score: number }[];
      count: number;
    };
    expect(out.objects[0].label).toBe('cat');
    expect(out.objects.length).toBe(2);
    expect(out.count).toBe(2);
  });
});

describe('translate-image runner', () => {
  it('OCRs then translates, returning both', async () => {
    // First AI.run = vision OCR, second = text translation.
    const run = vi
      .fn()
      .mockResolvedValueOnce({ response: 'Hola mundo' })
      .mockResolvedValueOnce({ response: 'Hello world' });
    const env = { AI: { run } } as unknown as Env;
    const out = (await runPro(
      'translate-image',
      { imageBase64: TINY_PNG, target: 'English' },
      env,
    )) as { sourceText: string; translation: string; target: string };
    expect(out.sourceText).toBe('Hola mundo');
    expect(out.translation).toBe('Hello world');
    expect(out.target).toBe('English');
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('transcribe-and-translate runner', () => {
  it('transcribes then translates', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Bonjour le monde' }) // whisper
      .mockResolvedValueOnce({ response: 'Hello world' }); // translate
    const env = { AI: { run } } as unknown as Env;
    // 'QUJD' = base64 of "ABC" — any non-empty payload works; AI.run is mocked.
    const out = (await runPro(
      'transcribe-and-translate',
      { audioBase64: 'QUJD', target: 'English' },
      env,
    )) as { transcript: string; translation: string; target: string };
    expect(out.transcript).toBe('Bonjour le monde');
    expect(out.translation).toBe('Hello world');
    expect(out.target).toBe('English');
  });

  it('rejects missing audio', async () => {
    const env = aiEnv({ text: 'x' });
    await expect(runPro('transcribe-and-translate', { target: 'English' }, env)).rejects.toThrow(
      'audioBase64 required',
    );
  });
});

describe('__readImageBytes', () => {
  it('decodes a valid base64 image', () => {
    const bytes = __readImageBytes({ imageBase64: TINY_PNG });
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('throws when imageBase64 is missing', () => {
    expect(() => __readImageBytes({})).toThrow('imageBase64 required');
  });

  it('throws when the image exceeds the size cap', () => {
    const huge = 'A'.repeat(20 * 1024 * 1024);
    expect(() => __readImageBytes({ imageBase64: huge })).toThrow('exceeds');
  });
});

describe('regex-from-text-pro runner', () => {
  it('parses the model JSON into a regex result', async () => {
    const env = aiEnv({
      response: '{"pattern":"\\\\d+","flags":"g","explanation":"one or more digits"}',
    });
    const out = (await runPro('regex-from-text-pro', { description: 'match numbers' }, env)) as {
      pattern: string;
      flags: string;
      fullRegex: string;
    };
    expect(out.pattern).toBe('\\d+');
    expect(out.flags).toBe('g');
    expect(out.fullRegex).toBe('/\\d+/g');
  });

  it('rejects a missing description', async () => {
    const env = aiEnv({ response: '{}' });
    await expect(runPro('regex-from-text-pro', {}, env)).rejects.toThrow("'description'");
  });

  it('throws on unparseable model output', async () => {
    const env = aiEnv({ response: 'not json at all' });
    await expect(runPro('regex-from-text-pro', { description: 'x' }, env)).rejects.toThrow(
      'unparseable',
    );
  });
});

describe('cron-from-text-pro runner', () => {
  it('parses the model JSON into a cron result', async () => {
    const env = aiEnv({
      response: '{"cron":"0 9 * * 1","explanation":"every Monday at 9am"}',
    });
    const out = (await runPro(
      'cron-from-text-pro',
      { description: 'every monday at 9am' },
      env,
    )) as { cron: string; explanation: string };
    expect(out.cron).toBe('0 9 * * 1');
    expect(out.explanation).toBe('every Monday at 9am');
  });
});

describe('pdf-summarize runner', () => {
  it('returns a summary of the document text', async () => {
    const env = aiEnv({ response: 'The document covers quarterly results.' });
    const out = (await runPro('pdf-summarize', { text: 'Long document text here.' }, env)) as {
      summary: string;
    };
    expect(out.summary).toBe('The document covers quarterly results.');
  });

  it('rejects missing document text', async () => {
    const env = aiEnv({ response: 'x' });
    await expect(runPro('pdf-summarize', {}, env)).rejects.toThrow("'text'");
  });
});

describe('pdf-q-and-a runner', () => {
  it('returns an answer to the question', async () => {
    const env = aiEnv({ response: 'The total is $420.' });
    const out = (await runPro(
      'pdf-q-and-a',
      { text: 'Invoice. Total: $420.', question: 'What is the total?' },
      env,
    )) as { answer: string };
    expect(out.answer).toBe('The total is $420.');
  });

  it('rejects a missing question', async () => {
    const env = aiEnv({ response: 'x' });
    await expect(runPro('pdf-q-and-a', { text: 'some document' }, env)).rejects.toThrow(
      "'question'",
    );
  });
});

describe('readImageRef SSRF validation', () => {
  it('accepts a public https URL', () => {
    expect(readImageRef({ image: 'https://example.com/cat.png' })).toBe(
      'https://example.com/cat.png',
    );
  });

  it('accepts a data:image/ URL', () => {
    const data = `data:image/png;base64,${TINY_PNG}`;
    expect(readImageRef({ image: data })).toBe(data);
  });

  it('rejects an http:// URL', () => {
    expect(() => readImageRef({ image: 'http://example.com/cat.png' })).toThrow('public host');
  });

  it('rejects the cloud metadata IP', () => {
    expect(() => readImageRef({ image: 'https://169.254.169.254/latest/meta-data/' })).toThrow(
      'public host',
    );
  });

  it('rejects https://localhost', () => {
    expect(() => readImageRef({ image: 'https://localhost/x' })).toThrow('public host');
  });

  it('blocks private and loopback hosts', () => {
    for (const h of [
      'localhost',
      'host.local',
      '127.0.0.1',
      '10.1.2.3',
      '172.16.5.5',
      '172.31.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fc00::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(__isDisallowedHost(h)).toBe(true);
    }
  });

  it('allows public hosts', () => {
    for (const h of ['example.com', '8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1']) {
      expect(__isDisallowedHost(h)).toBe(false);
    }
  });
});
