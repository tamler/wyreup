import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const targets = [
  ['source', new URL('../../src/utilities/common.ts', import.meta.url).href],
  ['built', new URL('../../dist/node/index.js', import.meta.url).href],
] as const;
const cases = [
  'late-rejection',
  'already-rejected-async',
  'late-fulfillment',
  'own-then-rejection',
  'own-constructor-fulfillment',
  'subclass-fulfillment',
  'foreign-fulfillment',
  'fake-prototype',
] as const;

describe.each(targets)('foundation SOURCE4 owned native cancellation: %s', (target, moduleUrl) => {
  it.each(cases)('exits normally without a global rejection handler: %s', (scenario) => {
    const script = `
      import {createUtility} from ${JSON.stringify(moduleUrl)};
      import vm from 'node:vm';
      const scenario = ${JSON.stringify(scenario)};
      const controller = new AbortController();
      let thenReads = 0;
      let thenCalls = 0;
      let constructorReads = 0;
      let speciesReads = 0;
      let calls = 0;
      const calculate = scenario === 'already-rejected-async'
        ? async function () {
            calls++;
            controller.abort();
            throw new Error('Already rejected owned calculation');
          }
        : function () {
            calls++;
            let pending;
            if (scenario === 'subclass-fulfillment') {
              class CustomPromise extends Promise {
                static get [Symbol.species]() { speciesReads++; return Promise; }
              }
              pending = new CustomPromise(resolve => setTimeout(() => resolve({ok:true}), 20));
            } else if (scenario === 'foreign-fulfillment') {
              pending = vm.runInNewContext('Promise.resolve({ok:true})');
            } else if (scenario === 'fake-prototype') {
              pending = Object.create(Promise.prototype);
            } else {
              pending = new Promise((resolve, reject) => setTimeout(() => {
                if (scenario === 'late-rejection' || scenario === 'own-then-rejection')
                  reject(new Error('Later rejected owned calculation'));
                else resolve({ok:true});
              }, 20));
            }
            if (scenario === 'own-then-rejection') Object.defineProperty(pending, 'then', {
              get() { thenReads++; return () => { thenCalls++; }; }
            });
            if (scenario === 'own-constructor-fulfillment') Object.defineProperty(pending, 'constructor', {
              get() { constructorReads++; return Promise; }
            });
            controller.abort();
            return pending;
          };
      const tool = createUtility({id:'owned-abort-probe',name:'Owned abort probe',
        description:'Cancellation lifetime regression',category:'inspect',keywords:[],
        defaults:{},paramSchema:{},calculate});
      let outcome = 'unexpected-success';
      try {
        await tool.run([], {}, {signal:controller.signal,cache:new Map(),
          executionId:'source4',onProgress(){}});
      } catch(error) { outcome = error.name + ':' + error.code + ':' + error.field; }
      await new Promise(resolve => setTimeout(resolve, 60));
      console.log(JSON.stringify({outcome,calls,thenReads,thenCalls,constructorReads,speciesReads,
        unhandledListeners:process.listenerCount('unhandledRejection')}));
    `;
    const flags = target === 'source' ? ['--experimental-transform-types'] : [];
    const native = spawnSync(
      process.execPath,
      [...flags, '--unhandled-rejections=strict', '--input-type=module', '--eval', script],
      { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 },
    );
    const evidence = process.env['WYREUP_CORRECTION4_EVIDENCE'];
    if (evidence) {
      mkdirSync(evidence, { recursive: true });
      writeFileSync(
        join(evidence, `${target}-${scenario}.json`),
        JSON.stringify(
          {
            command: process.execPath,
            flags,
            moduleUrl,
            scenario,
            status: native.status,
            signal: native.signal,
            error: native.error?.message ?? null,
            stdout: native.stdout,
            stderr: native.stderr,
          },
          null,
          2,
        ) + '\n',
        { flag: 'wx' },
      );
    }
    expect(native.error).toBeUndefined();
    expect(native.signal).toBeNull();
    expect(native.status, native.stderr).toBe(0);
    const report: unknown = JSON.parse(native.stdout.trim());
    expect(report).toEqual({
      outcome: 'UtilityInputError:abort:$run',
      calls: 1,
      thenReads: 0,
      thenCalls: 0,
      constructorReads: 0,
      speciesReads: 0,
      unhandledListeners: 0,
    });
  });
});
