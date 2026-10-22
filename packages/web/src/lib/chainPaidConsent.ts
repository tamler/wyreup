import type { Chain, ToolRegistry } from '@wyreup/core';

export interface PaidChainSummary {
  steps: ReadonlyArray<{ id: string; name: string; credits: number }>;
  totalCredits: number;
}

/** Captures actual registry prices before asynchronous work; never substitutes a price. */
export function summarizePaidChain(
  chain: Chain,
  registry: ToolRegistry,
  fileCount = 1,
): PaidChainSummary {
  if (!Number.isSafeInteger(fileCount) || fileCount < 1)
    throw new Error('Invalid paid file count.');
  const steps: Array<{ id: string; name: string; credits: number }> = [];
  let totalCredits = 0;
  for (const step of chain) {
    const tool = registry.toolsById.get(step.toolId);
    if (!tool) throw new Error(`Unknown tool: ${step.toolId}`);
    if (tool.cost !== 'credit') continue;
    const credits = tool.creditCost;
    if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 0) {
      throw new Error(`Paid price unavailable for ${tool.name}.`);
    }
    totalCredits += credits * fileCount;
    if (!Number.isFinite(totalCredits)) throw new Error('Paid total is unavailable.');
    steps.push(Object.freeze({ id: tool.id, name: tool.name, credits }));
  }
  return Object.freeze({ steps: Object.freeze(steps), totalCredits });
}

export function assertPaidAccount(
  summary: PaidChainSummary,
  ready: boolean,
  account: { email: string; balance: number } | null,
): void {
  if (summary.steps.length === 0) return;
  if (!ready) throw new Error('Account status is loading. Try again when it is ready.');
  if (!account || typeof account.email !== 'string' || !account.email)
    throw new Error('Sign in before running paid steps.');
  if (!Number.isFinite(account.balance) || account.balance < summary.totalCredits)
    throw new Error(`This chain requires ${summary.totalCredits} credits in your account.`);
}

export function paidChainDisclosure(
  summary: PaidChainSummary,
  files: readonly Pick<File, 'name'>[],
  email: string,
): string {
  return `Run paid steps for ${files.map((file) => file.name).join(', ')} using account ${email}?\n${summary.steps.map((step) => `${step.name}: ${step.credits} credits per file`).join('\n')}\nTotal: ${summary.totalCredits} credits. File contents are uploaded to wyreup.com for server-side processing. Server pricing is authoritative; a changed price may refuse this run.`;
}
