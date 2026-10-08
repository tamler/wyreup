import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function resolveNpmCli({ platform = process.platform, node = process.execPath, env = process.env } = {}) {
  if (platform === 'win32') {
    const bundled = path.join(path.dirname(node), 'node_modules/npm/bin/npm-cli.js');
    const globalRoot = (await exec(node, [bundled, 'root', '-g'], { env, timeout: 30_000 })).stdout.trim();
    assert(globalRoot && path.isAbsolute(globalRoot) && !/[\r\n]/.test(globalRoot), 'Invalid npm global root');
    return realpath(path.join(globalRoot, 'npm/bin/npm-cli.js'));
  }
  return realpath((await exec('which', ['npm'], { env })).stdout.trim());
}

export function assertNpmMajor(version, expected, required = Boolean(process.env.CI || process.env.GITHUB_ACTIONS)) {
  assert(/^\d+\.\d+\.\d+$/.test(version), `Invalid npm version: ${version}`);
  if (expected === undefined) {
    assert(!required, 'WYREUP_EXPECTED_NPM_MAJOR is required in CI');
    return;
  }
  assert(/^[1-9]\d*$/.test(expected), `Invalid expected npm major: ${expected}`);
  assert.equal(Number(version.split('.')[0]), Number(expected), `npm ${version} does not match expected major ${expected}`);
}
