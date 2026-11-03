import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
export const authorityURL = 'https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/93xxx/CVE-2026-93753.json';
const ghsa = 'GHSA-gcqx-w48m-w2h4';
const cve = 'CVE-2026-93753';
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function checkAuditConfiguration(packageConfig, workspaceConfig) {
  for (const config of [packageConfig, workspaceConfig]) {
    assert(object(config), 'Unrecognized project audit configuration.');
    assert(!Object.hasOwn(config, 'auditConfig'), 'Project auditConfig is not allowed.');
    if (Object.hasOwn(config, 'pnpm')) {
      assert(object(config.pnpm), 'Unrecognized pnpm configuration.');
      assert(!Object.hasOwn(config.pnpm, 'auditConfig'), 'Project pnpm.auditConfig is not allowed.');
    }
  }
}

function rejectedFinding(advisory) {
  return advisory.module_name === 'deepmerge' && advisory.severity === 'low'
    && advisory.github_advisory_id === ghsa
    && advisory.url === `https://github.com/advisories/${ghsa}`
    && advisory.vulnerable_versions === '>=4.2.0 <=4.3.1'
    && advisory.patched_versions === '<0.0.0'
    && Array.isArray(advisory.cves) && advisory.cves.length === 1 && advisory.cves[0] === cve
    && advisory.findings.every(finding => finding.version === '4.3.1');
}

export function inspectAuditReport(report, status) {
  assert(status === 0 || status === 1, 'Audit subprocess did not return a normal audit result.');
  assert(object(report) && !Object.hasOwn(report, 'error'), 'Audit returned an error or invalid document.');
  assert(Array.isArray(report.actions), 'Audit actions are missing.');
  assert(Array.isArray(report.muted) && report.muted.length === 0, 'Muted or missing audit findings are not allowed.');
  assert(object(report.advisories) && object(report.metadata) && object(report.metadata.vulnerabilities), 'Audit advisory metadata is missing.');
  assert.deepEqual(Object.keys(report.metadata.vulnerabilities).sort(), [...severities].sort(), 'Unknown audit severity metadata.');
  const counts = Object.fromEntries(severities.map(severity => [severity, 0]));
  const rejected = [];
  const blocking = [];
  for (const advisory of Object.values(report.advisories)) {
    assert(object(advisory) && severities.includes(advisory.severity), 'Unknown advisory shape or severity.');
    assert(typeof advisory.module_name === 'string' && advisory.module_name.length > 0, 'Advisory package is missing.');
    assert(Array.isArray(advisory.findings) && advisory.findings.length > 0, 'Advisory findings are missing.');
    for (const finding of advisory.findings) {
      assert(object(finding) && typeof finding.version === 'string' && finding.version.length > 0, 'Invalid advisory version.');
      assert(Array.isArray(finding.paths) && finding.paths.length > 0 && finding.paths.every(path => typeof path === 'string' && path.length > 0), 'Invalid advisory dependency paths.');
      counts[advisory.severity]++;
    }
    (rejectedFinding(advisory) ? rejected : blocking).push(advisory);
  }
  for (const severity of severities) {
    const count = report.metadata.vulnerabilities[severity];
    assert(Number.isSafeInteger(count) && count >= 0 && count === counts[severity], 'Audit counts do not match all reported findings.');
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  assert.equal(status, total === 0 ? 0 : 1, 'Audit status contradicts its reported findings.');
  return { counts, total, rejected, blocking };
}

export function rejectionIdentity(record) {
  assert(object(record) && record.dataType === 'CVE_RECORD', 'Unrecognized CVE authority record.');
  const metadata = record.cveMetadata;
  const provider = record.containers?.cna?.providerMetadata;
  const reasons = record.containers?.cna?.rejectedReasons;
  assert(metadata?.cveId === cve && metadata.state === 'REJECTED', 'The authoritative CVE is not the expected rejected record.');
  assert(metadata.assignerOrgId === '83251b91-4cc7-4094-a5c7-464a1b83ea10' && metadata.assignerShortName === 'VulnCheck', 'CVE assigner changed.');
  assert(provider?.orgId === metadata.assignerOrgId && provider.shortName === metadata.assignerShortName, 'CVE provider identity changed.');
  assert(Array.isArray(reasons) && reasons.length === 1 && reasons[0]?.lang === 'en', 'CVE rejection reasons changed.');
  assert.equal(reasons[0].value, 'This CVE ID has been rejected because it does not describe a security vulnerability.', 'CVE rejection reason changed.');
  return { cveId: metadata.cveId, state: metadata.state, assignerOrgId: metadata.assignerOrgId,
    assignerShortName: metadata.assignerShortName, providerOrgId: provider.orgId,
    providerShortName: provider.shortName, reason: reasons[0].value };
}

export async function evaluateAudit({ report, status, packageConfig, workspaceConfig, authorityRecord, fetchAuthority }) {
  checkAuditConfiguration(packageConfig, workspaceConfig);
  const inspection = inspectAuditReport(report, status);
  if (inspection.blocking.length > 0) return { pass: false, rawStatus: status, counts: inspection.counts,
    totalFindings: inspection.total, blockingAdvisories: inspection.blocking.length, rejectedAdvisories: inspection.rejected.length };
  if (inspection.rejected.length > 0) {
    const committed = rejectionIdentity(authorityRecord);
    assert.equal(typeof fetchAuthority, 'function', 'Live authority verification is required.');
    assert.deepEqual(rejectionIdentity(await fetchAuthority()), committed, 'Live authority record differs from the reviewed rejection.');
  }
  return { pass: true, rawStatus: status, counts: inspection.counts, totalFindings: inspection.total,
    blockingAdvisories: 0, rejectedAdvisories: inspection.rejected.length };
}

async function run() {
  let production = false;
  let output;
  const args = process.argv.slice(2);
  while (args.length) {
    const argument = args.shift();
    if (argument === '--prod' && !production) production = true;
    else if (argument === '--evidence-dir' && !output && args[0] && !args[0].startsWith('--')) output = resolve(args.shift());
    else throw new Error('Unsupported audit-policy argument.');
  }
  output ??= await mkdtemp(join(tmpdir(), 'wyreup-audit-'));
  await mkdir(output, { recursive: true, mode: 0o700 });
  const mode = production ? 'production' : 'complete';
  const stdoutPath = join(output, `${mode}-stdout.json`);
  const stderrPath = join(output, `${mode}-stderr.txt`);
  const stdout = await open(stdoutPath, 'wx', 0o600);
  const stderr = await open(stderrPath, 'wx', 0o600);
  let exit;
  try {
    const child = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['audit', '--json', ...(production ? ['--prod'] : [])], {
      cwd: root, stdio: ['ignore', stdout.fd, stderr.fd], shell: process.platform === 'win32',
    });
    exit = await new Promise((resolveExit) => {
      child.once('error', error => resolveExit({ code: null, signal: null, error: error.message }));
      child.once('close', (code, signal) => resolveExit({ code, signal }));
    });
  } finally {
    await Promise.all([stdout.close(), stderr.close()]);
  }
  await writeFile(join(output, `${mode}-exit.json`), JSON.stringify(exit, null, 2), { flag: 'wx', mode: 0o600 });
  assert(!exit.error, 'Audit subprocess could not start; failure evidence is retained.');
  assert.equal(exit.signal, null, 'Audit subprocess was interrupted.');
  assert((await stat(stdoutPath)).size <= 32 * 1024 * 1024 && (await stat(stderrPath)).size <= 32 * 1024 * 1024, 'Audit output exceeds parsing budget; raw files are retained.');
  const raw = await readFile(stdoutPath, 'utf8');
  const errorText = await readFile(stderrPath, 'utf8');
  process.stdout.write(raw);
  if (errorText) process.stderr.write(errorText);
  process.stdout.write(`\nRaw pnpm audit (${mode}) exit: ${exit.code}; evidence: ${output}\n`);
  const result = await evaluateAudit({
    report: JSON.parse(raw), status: exit.code,
    packageConfig: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')),
    workspaceConfig: loadYaml(await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8')),
    authorityRecord: JSON.parse(await readFile(new URL('./security/CVE-2026-93753.json', import.meta.url), 'utf8')),
    fetchAuthority: async () => {
      const response = await fetch(authorityURL, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, 'Live CVE authority request failed.');
      const text = await response.text();
      assert(Buffer.byteLength(text) <= 65536, 'Live CVE authority record exceeds size budget.');
      await writeFile(join(output, `${mode}-authority.json`), text, { flag: 'wx', mode: 0o600 });
      return JSON.parse(text);
    },
  });
  await writeFile(join(output, `${mode}-policy.json`), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  if (!result.pass) throw new Error(`${result.blockingAdvisories} live or unrecognized advisory entries block the audit policy.`);
  if (result.rejectedAdvisories) process.stdout.write(`Audit policy PASS with raw exit ${result.rawStatus}: ${ghsa}/${cve} is currently officially REJECTED; raw findings remain above and in evidence. This is not a raw-zero audit.\n`);
  else process.stdout.write('Audit policy PASS: raw audit has zero findings.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    process.stderr.write(`Dependency audit policy failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
