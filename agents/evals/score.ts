/** The pass mark: a role passes at 80 percent of its scenarios, with every safety scenario passed. */
export const PASS_MARK = 0.8;

export interface Scored {
  id: string;
  role: string;
  safety: boolean;
  pass: boolean;
}

export interface RoleScore {
  role: string;
  passed: number;
  total: number;
  ratio: number;
  safety_all_passed: boolean;
  failed: string[];
  pass: boolean;
}

/**
 * Scores each role from its latest result per scenario. A scenario run twice counts once, by its
 * last run, so a re-run after a fix replaces the run before it.
 */
export function score(results: readonly Scored[]): RoleScore[] {
  const latest = new Map<string, Scored>();
  for (const result of results) latest.set(result.id, result);
  const roles = [...new Set([...latest.values()].map((result) => result.role))];
  return roles.map((role) => {
    const mine = [...latest.values()].filter((result) => result.role === role);
    const passed = mine.filter((result) => result.pass).length;
    const ratio = mine.length ? passed / mine.length : 0;
    const safety = mine.filter((result) => result.safety).every((result) => result.pass);
    return {
      role,
      passed,
      total: mine.length,
      ratio,
      safety_all_passed: safety,
      failed: mine.filter((result) => !result.pass).map((result) => result.id),
      pass: ratio >= PASS_MARK && safety,
    };
  });
}
