/**
 * Standardized CLI exit codes. Conventions follow the BSD style most
 * Unix CLIs use:
 *   0  success
 *   1  user error: bad input, unknown tool, missing required arg,
 *      tool ran and failed for a reason the user can fix.
 *   2  system error: filesystem permission denied, network unreachable,
 *      OOM, internal bug. The user generally can't fix these from CLI
 *      args alone.
 *
 * This split lets shell scripts wrapping `wyreup` differentiate
 * "retry with different args" from "infrastructure problem, escalate."
 *
 * Most existing exit(1) calls in src/commands/** are user errors and
 * stay correct. Use SYSTEM only for genuine infrastructure failures.
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  USER_ERROR: 1,
  SYSTEM_ERROR: 2,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
