import { expect, it } from 'vitest';
import { lookupDomainRegistration } from './rdap';

it('owns a transport rejection that arrives after cancellation won the race', async () => {
  let rejectLate!: (cause: Error) => void;
  const fetcher: typeof fetch = () =>
    new Promise<Response>((_, reject) => {
      rejectLate = reject;
    });
  const controller = new AbortController();
  const unhandled: unknown[] = [];
  const observe = (cause: unknown) => {
    unhandled.push(cause);
  };
  process.on('unhandledRejection', observe);
  try {
    const pending = lookupDomainRegistration('example.com', controller.signal, fetcher);
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    await rejected;
    rejectLate(new Error('late transport failure'));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(unhandled).toEqual([]);
  } finally {
    process.removeListener('unhandledRejection', observe);
  }
});

it('owns a body-read rejection after cancellation without provider requests', async () => {
  let failRead!: (cause: Error) => void;
  let beganRead!: () => void;
  const reading = new Promise<void>((resolve) => {
    beganRead = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    pull() {
      beganRead();
      return new Promise<void>((_, reject) => {
        failRead = reject;
      });
    },
  });
  let calls = 0;
  const fetcher: typeof fetch = () => {
    calls++;
    return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } }));
  };
  const controller = new AbortController();
  const pending = lookupDomainRegistration('example.com', controller.signal, fetcher);
  const rejected = expect(pending).rejects.toThrow();
  await reading;
  controller.abort();
  await rejected;
  failRead(new Error('late read failure'));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(1);
});
