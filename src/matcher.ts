/**
 * Returns true if jobTitle matches any of the target keywords.
 *
 * Matching rules (both case-insensitive):
 *   - jobTitle contains the target keyword, OR
 *   - target keyword contains the job title
 *
 * Examples with target "Software Engineer":
 *   "Senior Software Engineer"   → true  (title contains keyword)
 *   "Software Engineering Lead"  → true  (title contains keyword)
 *   "Software Engineer II"       → true  (title contains keyword)
 *   "Engineer"                   → true  (keyword contains title)
 *   "Product Manager"            → false
 */
export function matchesSalary(
  salaryMin: number | undefined,
  salaryMax: number | undefined,
  configMin: number | undefined,
  configMax: number | undefined,
  sendIfNoSalary: boolean
): boolean {
  const hasNumeric = salaryMin !== undefined || salaryMax !== undefined;
  if (!hasNumeric) return sendIfNoSalary;
  if (configMin !== undefined && (salaryMax ?? salaryMin!) < configMin) return false;
  if (configMax !== undefined && (salaryMin ?? salaryMax!) > configMax) return false;
  return true;
}

export function matchesTitle(jobTitle: string, targets: string[]): boolean {
  const normalizedJob = jobTitle.toLowerCase();

  for (const target of targets) {
    const normalizedTarget = target.toLowerCase();
    if (
      normalizedJob.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedJob)
    ) {
      return true;
    }
  }

  return false;
}
