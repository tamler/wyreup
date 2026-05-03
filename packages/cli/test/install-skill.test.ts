import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';

// ── mocks must be hoisted before importing the module under test ──────────────

vi.mock('node:os', () => ({ homedir: () => '/mock-home' }));

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
// access mock: resolved = file exists, rejected = file missing
const mockAccess = vi.fn().mockRejectedValue(new Error('ENOENT'));

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args) as unknown,
  writeFile: (...args: unknown[]) => mockWriteFile(...args) as unknown,
  access: (...args: unknown[]) => mockAccess(...args) as unknown,
  readFile: vi.fn().mockResolvedValue(''),
}));

// Import after mocks are set up
import { resolveSkillsDir, fetchSkill, SKILL_DEFS } from '../src/commands/install-skill.js';

// ── fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeFetchOk(body: string) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(body),
  } as Response);
}

function makeFetchFail(status: number) {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Not Found',
    text: () => Promise.resolve(''),
  } as Response);
}

// ── helpers ───────────────────────────────────────────────────────────────────

const FAKE_SKILL_CONTENT = '---\nname: wyreup\n---\n# skill content';

beforeEach(() => {
  mockFetch.mockReset();
  mockMkdir.mockReset().mockResolvedValue(undefined);
  mockWriteFile.mockReset().mockResolvedValue(undefined);
  mockAccess.mockReset().mockRejectedValue(new Error('ENOENT'));
});

// ── resolveSkillsDir ──────────────────────────────────────────────────────────

describe('resolveSkillsDir', () => {
  it('resolves project to cwd/.claude/skills', () => {
    const dir = resolveSkillsDir('project');
    expect(dir).toBe(join(process.cwd(), '.claude', 'skills'));
  });

  it('resolves user to ~/.claude/skills', () => {
    const dir = resolveSkillsDir('user');
    expect(dir).toBe('/mock-home/.claude/skills');
  });

  it('resolves custom with a given path', () => {
    const dir = resolveSkillsDir('custom', '/my/skills');
    expect(dir).toBe('/my/skills');
  });

  it('throws when custom location has no path', () => {
    expect(() => resolveSkillsDir('custom')).toThrow('--path is required');
  });
});

// ── SKILL_DEFS ────────────────────────────────────────────────────────────────

describe('SKILL_DEFS', () => {
  it('cli variant points at cli-skill package on GitHub', () => {
    expect(SKILL_DEFS.cli.url).toContain('packages/cli-skill/skill.md');
  });

  it('mcp variant points at mcp-skill package on GitHub', () => {
    expect(SKILL_DEFS.mcp.url).toContain('packages/mcp-skill/skill.md');
  });

  it('combined variant points at skill package on GitHub', () => {
    expect(SKILL_DEFS.combined.url).toContain('packages/skill/skill.md');
  });

  it('cli variant has name wyreup-cli', () => {
    expect(SKILL_DEFS.cli.name).toBe('wyreup-cli');
  });

  it('mcp variant has name wyreup-mcp', () => {
    expect(SKILL_DEFS.mcp.name).toBe('wyreup-mcp');
  });

  it('combined variant has name wyreup', () => {
    expect(SKILL_DEFS.combined.name).toBe('wyreup');
  });
});

// ── fetchSkill ────────────────────────────────────────────────────────────────

describe('fetchSkill', () => {
  it('returns the text body on success', async () => {
    mockFetch.mockReturnValue(makeFetchOk(FAKE_SKILL_CONTENT));
    const result = await fetchSkill(SKILL_DEFS.combined.url);
    expect(result).toBe(FAKE_SKILL_CONTENT);
  });

  it('calls the correct GitHub raw URL for cli variant', async () => {
    mockFetch.mockReturnValue(makeFetchOk(FAKE_SKILL_CONTENT));
    await fetchSkill(SKILL_DEFS.cli.url);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('packages/cli-skill/skill.md'),
    );
  });

  it('calls the correct GitHub raw URL for mcp variant', async () => {
    mockFetch.mockReturnValue(makeFetchOk(FAKE_SKILL_CONTENT));
    await fetchSkill(SKILL_DEFS.mcp.url);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('packages/mcp-skill/skill.md'),
    );
  });

  it('throws a clear error on non-OK HTTP response', async () => {
    mockFetch.mockReturnValue(makeFetchFail(404));
    await expect(fetchSkill(SKILL_DEFS.combined.url)).rejects.toThrow('HTTP 404');
  });

  it('includes a --path fallback hint in the error', async () => {
    mockFetch.mockReturnValue(makeFetchFail(500));
    await expect(fetchSkill(SKILL_DEFS.combined.url)).rejects.toThrow('--path');
  });

  it('throws a clear error when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('ENOTFOUND raw.githubusercontent.com'));
    await expect(fetchSkill(SKILL_DEFS.combined.url)).rejects.toThrow('Network error');
  });
});
