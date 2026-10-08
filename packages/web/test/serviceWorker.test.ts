import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  precache: vi.fn(),
  match: vi.fn(),
  route: vi.fn(),
  catch: vi.fn(),
}));
vi.mock('workbox-precaching', () => ({
  cleanupOutdatedCaches: vi.fn(),
  matchPrecache: mocks.match,
  precacheAndRoute: mocks.precache,
}));
vi.mock('workbox-routing', () => ({ setCatchHandler: mocks.catch, registerRoute: mocks.route }));
vi.mock('workbox-strategies', () => ({ NetworkOnly: class NetworkOnly {} }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

it('routes uncached GET navigations after precache and serves the canonical offline page', async () => {
  vi.stubGlobal('self', {
    __WB_MANIFEST: [{ url: 'offline', revision: 'test' }],
    addEventListener: vi.fn(),
  });
  await import('../src/sw');
  expect(mocks.route).toHaveBeenCalledTimes(1);
  expect(mocks.precache.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.route.mock.invocationCallOrder[0],
  );
  const options = mocks.precache.mock.calls[0][1] as {
    urlManipulation: (args: { url: URL }) => URL[];
  };
  expect(
    options.urlManipulation({ url: new URL('https://wyreup.com/tools/compress/?source=test') })[0]
      ?.href,
  ).toBe('https://wyreup.com/tools/compress?source=test');
  expect(options.urlManipulation({ url: new URL('https://wyreup.com/') })).toEqual([]);
  const [match, , method] = mocks.route.mock.calls[0] as [
    (args: { request: { mode: string } }) => boolean,
    unknown,
    string,
  ];
  expect(method).toBe('GET');
  expect(match({ request: { mode: 'navigate' } })).toBe(true);
  expect(match({ request: { mode: 'cors' } })).toBe(false);
  const catchHandler = mocks.catch.mock.calls[0][0] as (args: {
    request: { destination: string };
  }) => Promise<Response>;
  const offline = new Response('Offline');
  mocks.match.mockImplementation((url: string) => (url === '/offline' ? offline : undefined));
  expect(await catchHandler({ request: { destination: 'document' } })).toBe(offline);
  expect((await catchHandler({ request: { destination: 'image' } })).type).toBe('error');
});
