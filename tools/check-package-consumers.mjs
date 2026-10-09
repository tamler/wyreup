import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadArtifacts } from './check-release-artifacts.mjs';
import { build } from 'esbuild';
import { checkInstalledVersions } from './check-dependency-versions.mjs';
import { assertNpmMajor, resolveNpmCli } from './consumer-package-managers.mjs';

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const { artifacts } = await loadArtifacts('artifacts');
const npmCli = await resolveNpmCli();
const pnpmCli = process.env.npm_execpath;
assert(pnpmCli?.includes('pnpm'), 'Run this check through pnpm check:consumers');
const scratch = await mkdtemp(path.join(tmpdir(), 'wyreup-consumers-'));
const entries = new Map(artifacts.map((artifact) => [artifact.name, artifact]));
let origin;
const server = createServer((request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const artifact = entries.get(pathname.slice(1));
    if (artifact) {
      const body = JSON.stringify({ name: artifact.name, 'dist-tags': { latest: artifact.version }, versions: {
        [artifact.version]: { ...artifact.manifest, dist: { tarball: `${origin}/tar/${path.basename(artifact.file)}`, integrity: artifact.integrity } },
      } });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : body);
      return;
    }
    const tarball = artifacts.find((entry) => pathname === `/tar/${path.basename(entry.file)}`);
    if (tarball) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(tarball.file).on('error', () => response.destroy()).pipe(response);
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
  } catch { response.writeHead(400).end(); }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
origin = `http://127.0.0.1:${server.address().port}`;
const userConfig = path.join(scratch, 'user.npmrc');
await writeFile(userConfig, '');
const managerOptions = {
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|USER|LOGNAME|LANG|LC_ALL|TMPDIR|TEMP|TMP|SystemRoot|COMSPEC|PATHEXT|windir)$/i.test(key))),
    npm_config_cache: path.join(scratch, 'npm-cache'),
    npm_config_userconfig: userConfig,
  },
  maxBuffer: 16 * 1024 * 1024,
  timeout: 300_000,
};

async function run(cli, args, cwd, ignoreScripts = false) {
  try {
    return await exec(process.execPath, [cli, ...args], {
      ...managerOptions,
      timeout: process.platform === 'win32' && ['install', 'update'].includes(args[0]) ? 600_000 : managerOptions.timeout,
      ...(ignoreScripts ? { env: { ...managerOptions.env, npm_config_ignore_scripts: 'true' } } : {}),
      cwd,
    });
  } catch (error) {
    process.stderr.write(error.stdout ?? '');
    process.stderr.write(error.stderr ?? '');
    throw error;
  }
}

try {
  const npmVersion = (await run(npmCli, ['--version'], root)).stdout.trim();
  assertNpmMajor(npmVersion, process.env.WYREUP_EXPECTED_NPM_MAJOR);
  console.log(`npm executable: ${npmCli}`);
  for (const [manager, cli] of [['npm', npmCli], ['pnpm', pnpmCli]]) {
    console.log(`${manager} ${manager === 'npm' ? npmVersion : (await run(cli, ['--version'], root)).stdout.trim()}`);
    for (const ignoreScripts of [false, true]) {
      for (const artifact of artifacts) {
        for (const withPeer of artifact.name === '@wyreup/core' ? [false, true] : [false]) {
          const directory = await mkdtemp(path.join(scratch, `${manager}-`));
          const dependencies = { [artifact.name]: artifact.version };
          if (withPeer) dependencies['@huggingface/transformers'] = '^4.3.1';
          const migration = withPeer && ignoreScripts;
          await writeFile(path.join(directory, '.npmrc'), `registry=https://registry.npmjs.org/\n@wyreup:registry=${origin}/\n`);
          if (migration) {
            const seed = { name: 'wyreup-seeded-lock', version: '1.0.0', private: true, dependencies: {
              '@huggingface/transformers': '4.3.1', sharp: '0.35.4',
            } };
            await writeFile(path.join(directory, 'package.json'), JSON.stringify(seed));
            await run(cli, ['install', manager === 'npm' ? '--package-lock-only' : '--lockfile-only', '--ignore-scripts'], directory);
            const before = await run(cli, ['audit', '--json'], directory).then(() => {
              throw new Error('Seeded vulnerable lock unexpectedly passed audit');
            }, error => {
              const report = JSON.parse(error.stdout);
              assert(Object.values(report.advisories ?? report.vulnerabilities ?? {}).some(entry => entry.module_name === 'sharp' || entry.name === 'sharp'), 'Seed audit did not reproduce the Sharp advisory');
              return error.stdout;
            });
            const evidence = path.join(root, 'artifacts', `seeded-lock-${manager}`);
            await mkdir(evidence, { recursive: true });
            await writeFile(path.join(evidence, 'seed-package.json'), JSON.stringify(seed, null, 2));
            await copyFile(path.join(directory, manager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml'), path.join(evidence, 'original-lock'));
            await writeFile(path.join(evidence, 'original-audit.json'), before);
          }
          await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'wyreup-consumer-check', version: '1.0.0', private: true, type: 'module', dependencies }));
          if (manager === 'pnpm') {
            await writeFile(path.join(directory, 'pnpm-workspace.yaml'), "onlyBuiltDependencies:\n  - 'onnxruntime-node'\n");
          }
          await run(cli, ['install', ...(ignoreScripts ? ['--ignore-scripts'] : []), ...(manager === 'npm' ? ['--no-fund'] : [])], directory);
          if (migration) {
            await run(cli, ['update', ...(manager === 'pnpm' ? ['--depth', 'Infinity'] : [])], directory, true);
          }
          const finalAudit = await run(cli, ['audit', '--json'], directory);
          const auditReport = JSON.parse(finalAudit.stdout);
          assert(Object.values(auditReport.metadata.vulnerabilities).every(value => value === 0), 'Consumer audit contains advisories');
          if (manager === 'npm') await run(cli, ['ls', '--all'], directory);
          const versions = await checkInstalledVersions(directory);
          if (withPeer || ['@wyreup/cli', '@wyreup/mcp'].includes(artifact.name)) {
            assert(versions.some(entry => entry.name === '@huggingface/transformers'), 'Required official AI runtime is missing');
          } else {
            assert(!versions.some(entry => entry.name === '@huggingface/transformers'), 'Optional AI runtime installed unexpectedly');
          }
          if (migration) {
            const evidence = path.join(root, 'artifacts', `seeded-lock-${manager}`);
            await copyFile(path.join(directory, 'package.json'), path.join(evidence, 'updated-package.json'));
            await copyFile(path.join(directory, manager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml'), path.join(evidence, 'updated-lock'));
            await writeFile(path.join(evidence, 'updated-versions.json'), JSON.stringify(versions, null, 2));
            await writeFile(path.join(evidence, 'updated-audit.json'), finalAudit.stdout);
          }
          const smoke = path.join(directory, 'smoke.mjs');
          await copyFile(path.join(root, 'tools/package-consumer-smoke.mjs'), smoke);
          await exec(process.execPath, ['--check', smoke], { ...managerOptions, cwd: directory });
          const result = await exec(process.execPath, [smoke, artifact.name, ...(withPeer ? ['with-ai'] : [])], { ...managerOptions, cwd: directory });
          process.stdout.write(result.stdout);
          const types = path.join(directory, 'consumer.mts');
          const typeChecks = {
            '@wyreup/core': "import { createDefaultRegistry } from '@wyreup/core';\ncreateDefaultRegistry();\n",
            '@wyreup/exceljs': "import ExcelJS from '@wyreup/exceljs';\nnew ExcelJS.Workbook();\n",
            '@wyreup/mammoth': "import mammoth from '@wyreup/mammoth';\nvoid mammoth.extractRawText({ arrayBuffer: new ArrayBuffer(1) });\n",
          };
          if (typeChecks[artifact.name]) {
            await writeFile(types, typeChecks[artifact.name] + (withPeer ? "import { Tensor, pipeline } from '@huggingface/transformers';\nnew Tensor('float32', new Float32Array([1]), [1]);\nvoid pipeline;\n" : ''));
            await exec(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', types], { ...managerOptions, cwd: directory });
          }
          if (withPeer || ['@wyreup/exceljs', '@wyreup/mammoth'].includes(artifact.name)) {
            const contents = withPeer
              ? "import { pipeline, Tensor } from '@huggingface/transformers'; console.log(pipeline, Tensor);"
              : artifact.name === '@wyreup/exceljs'
                ? "import { Workbook } from '@wyreup/exceljs'; console.log(new Workbook());"
                : "import mammoth from '@wyreup/mammoth'; console.log(mammoth.extractRawText);";
            const browser = await build({ absWorkingDir: directory,
              stdin: { contents, resolveDir: directory, sourcefile: 'browser-consumer.mjs' },
              bundle: true, platform: 'browser', format: 'esm', write: false, logLevel: 'silent' });
            assert(browser.outputFiles[0]?.contents.length > 0, 'Packed browser entrypoint did not bundle');
          }
          console.log(`${manager} ${artifact.name}${withPeer ? ' with optional peer' : ''}: scripts ${ignoreScripts ? 'disabled' : 'normal default installation'}, audit, nested version floors and smoke passed${migration ? '; HF/Sharp seeded-lock update passed' : ''}`);
          await rm(directory, { recursive: true, force: true });
        }
      }
    }
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
