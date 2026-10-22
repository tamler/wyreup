import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import process from 'node:process';

const run = process.env.CATALOG_BROWSER_RUN;
if (process.env.CATALOG_BROWSER_BINDING_FAILURE_REGRESSION !== 'run-native' ||
    !run || !/^[a-zA-Z0-9-]{1,100}$/.test(run))
  throw new Error('The explicit native browser binding regression command is required.');

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const missingFont = '/__catalog-binding-failure-regression__.woff2';
const launch = chromium.launch.bind(chromium);
chromium.launch = async function (options) {
  const browser = await launch(options);
  const newContext = browser.newContext.bind(browser);
  const close = browser.close.bind(browser);
  let armed = false;
  /** @type {Promise<void> | undefined} */
  let injection;
  /** @type {{ url: string, status: number, resourceType: string, fromServiceWorker: boolean } | undefined} */
  let response;
  /** @type {{ loaded: boolean, error?: { name: string, message: string } } | undefined} */
  let fontLoadOutcome;
  /** @type {{ name?: string, message: string } | undefined} */
  let injectionFailure;
  browser.newContext = async function (contextOptions) {
    const context = await newContext(contextOptions);
    const contextClose = context.close.bind(context);
    /** @type {Promise<void> | undefined} */
    let contextInjection;
    context.close = async function (closeOptions) {
      if (contextInjection) await contextInjection;
      await contextClose(closeOptions);
    };
    context.on('page', (page) => {
      if (armed) return;
      armed = true;
      page.on('domcontentloaded', () => {
        if (injection || new URL(page.url()).hostname !== '127.0.0.1' ||
            new URL(page.url()).pathname !== '/tools/stopwatch/') return;
        contextInjection = injection = (async () => {
          const observed = page.waitForResponse((item) =>
            new URL(item.url()).pathname === missingFont &&
            item.request().resourceType() === 'font', { timeout: 10000 });
          await Promise.all([
            observed.then((item) => {
              response = { url: item.url(), status: item.status(),
                resourceType: item.request().resourceType(), fromServiceWorker: item.fromServiceWorker() };
            }),
            page.evaluate(async (href) => {
              try {
                await new FontFace('CatalogBindingFailureRegression', 'url("' + href + '")').load();
                return { loaded: true };
              } catch (error) {
                if (!(error instanceof Error) || !error.name || !error.message)
                  throw new Error('Actual native FontFace rejection details unavailable.');
                return { loaded: false, error: { name: error.name, message: error.message } };
              }
            }, missingFont).then((outcome) => {
              fontLoadOutcome = outcome;
              if (outcome.loaded) throw new Error('The missing native font unexpectedly loaded.');
            }),
          ]);
        })().catch(/** @param {unknown} error */ (error) => {
          injectionFailure = error instanceof Error ? { name: error.name, message: error.message } : { message: String(error) };
        });
      });
    });
    return context;
  };
  browser.close = async function (closeOptions) {
    if (injection) await injection;
    await close(closeOptions);
    await writeFile(join(root, 'docs/catalog-artifacts', run, 'binding-failure-preload.json'),
      JSON.stringify({ scope: 'Test-only real browser request; no fabricated capture or browser result',
        armed, response, fontLoadOutcome, injectionFailure, browserConnectedAfterClose: browser.isConnected() }, null, 2) + '\n',
      { flag: 'wx' });
  };
  return browser;
};
