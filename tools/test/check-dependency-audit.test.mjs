import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { checkAuditConfiguration, evaluateAudit, inspectAuditReport, rejectionIdentity } from '../check-dependency-audit.mjs';

const authorityRecord = JSON.parse(await readFile(new URL('../security/CVE-2026-93753.json', import.meta.url), 'utf8'));
const configuration = { packageConfig: { pnpm: { overrides: {} } }, workspaceConfig: { packages: ['packages/*'] } };
const clean = () => ({ actions: [], muted: [], advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } });
const rejected = () => ({
  module_name: 'deepmerge', severity: 'low', github_advisory_id: 'GHSA-gcqx-w48m-w2h4',
  url: 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4', cves: ['CVE-2026-93753'],
  vulnerable_versions: '>=4.2.0 <=4.3.1', patched_versions: '<0.0.0',
  findings: [{ version: '4.3.1', paths: ['web>deepmerge'] }],
});
function reported(advisories) {
  const report = clean();
  for (const [index, advisory] of advisories.entries()) {
    report.advisories[index + 1] = advisory;
    report.metadata.vulnerabilities[advisory.severity] += advisory.findings.length;
  }
  return report;
}
const evaluate = (report, options = {}) => evaluateAudit({ report, status: 1, ...configuration,
  authorityRecord, fetchAuthority: async () => structuredClone(authorityRecord), ...options });

describe('dependency audit policy', () => {
  it('accepts a genuinely clean result without an authority request', async () => {
    const fetchAuthority = vi.fn();
    const result = await evaluate(clean(), { status: 0, fetchAuthority });
    expect(result).toMatchObject({ pass: true, rawStatus: 0, totalFindings: 0, rejectedAdvisories: 0 });
    expect(fetchAuthority).not.toHaveBeenCalled();
  });

  it('keeps the raw nonzero status and all counts for the sole currently rejected finding', async () => {
    const fetchAuthority = vi.fn().mockResolvedValue(structuredClone(authorityRecord));
    const report = reported([rejected()]);
    const original = structuredClone(report);
    const result = await evaluate(report, { fetchAuthority });
    expect(result).toMatchObject({ pass: true, rawStatus: 1, totalFindings: 1, rejectedAdvisories: 1, blockingAdvisories: 0, counts: { low: 1 } });
    expect(report).toEqual(original);
    expect(fetchAuthority).toHaveBeenCalledOnce();
  });

  it('blocks a live advisory beside the rejected report without claiming it clean', async () => {
    const other = { ...rejected(), module_name: 'another-package', severity: 'high', github_advisory_id: 'GHSA-other', findings: [{ version: '1.0.0', paths: ['root>another-package'] }] };
    const result = await evaluate(reported([rejected(), other]));
    expect(result).toMatchObject({ pass: false, rawStatus: 1, totalFindings: 2, rejectedAdvisories: 1, blockingAdvisories: 1 });
  });

  for (const [name, change] of [
    ['package', entry => { entry.module_name = 'different-package'; }],
    ['GHSA ID', entry => { entry.github_advisory_id = 'GHSA-different'; }],
    ['URL', entry => { entry.url += '?different'; }],
    ['CVE list', entry => { entry.cves.push('CVE-2026-00000'); }],
    ['severity', entry => { entry.severity = 'high'; }],
    ['affected range', entry => { entry.vulnerable_versions = '*'; }],
    ['patched range', entry => { entry.patched_versions = '>=4.3.2'; }],
    ['installed version', entry => { entry.findings[0].version = '4.3.0'; }],
    ['second finding', entry => { entry.findings.push({ version: '4.3.0', paths: ['another>deepmerge'] }); }],
  ]) {
    it(`blocks a mismatched ${name}`, async () => {
      const entry = rejected();
      change(entry);
      expect((await evaluate(reported([entry]))).pass).toBe(false);
    });
  }

  for (const change of [
    report => { report.muted.push('GHSA-hidden'); },
    report => { delete report.muted; },
    report => { report.metadata.vulnerabilities.low++; },
    report => { report.metadata.vulnerabilities.unknown = 0; },
    report => { report.error = { message: 'registry unavailable' }; },
    report => { report.advisories[1].findings[0].paths = []; },
    report => { report.advisories = []; },
  ]) {
    it('rejects malformed, muted or incoherent registry results', () => {
      const report = reported([rejected()]);
      change(report);
      expect(() => inspectAuditReport(report, 1)).toThrow();
    });
  }

  it('refuses abnormal subprocess status and status/count contradictions', () => {
    for (const status of [null, undefined, 2, -1, '1']) expect(() => inspectAuditReport(clean(), status)).toThrow();
    expect(() => inspectAuditReport(clean(), 1)).toThrow();
    expect(() => inspectAuditReport(reported([rejected()]), 0)).toThrow();
  });

  it('rejects root and workspace audit exclusions, even when empty', () => {
    for (const config of [{ auditConfig: {} }, { pnpm: { auditConfig: {} } }]) {
      expect(() => checkAuditConfiguration(config, configuration.workspaceConfig)).toThrow();
      expect(() => checkAuditConfiguration(configuration.packageConfig, config)).toThrow();
    }
  });

  it('fails closed when the authority cannot be checked', async () => {
    await expect(evaluate(reported([rejected()]), { fetchAuthority: async () => { throw new Error('offline'); } })).rejects.toThrow('offline');
    await expect(evaluate(reported([rejected()]), { fetchAuthority: undefined })).rejects.toThrow();
  });

  for (const change of [
    record => { record.cveMetadata.state = 'PUBLISHED'; },
    record => { record.cveMetadata.cveId = 'CVE-2026-00000'; },
    record => { record.cveMetadata.assignerShortName = 'another'; },
    record => { record.containers.cna.providerMetadata.orgId = 'another'; },
    record => { record.containers.cna.rejectedReasons[0].value = 'A different reason'; },
  ]) {
    it('refuses changed or republished live authority records', async () => {
      const altered = structuredClone(authorityRecord);
      change(altered);
      expect(() => rejectionIdentity(altered)).toThrow();
      await expect(evaluate(reported([rejected()]), { fetchAuthority: async () => altered })).rejects.toThrow();
    });
  }
});
