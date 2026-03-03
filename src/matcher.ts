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

const US_ALIASES = new Set(["united states", "united states of america", "usa", "us"]);

// Comma-prefixed so ", CA" matches "San Francisco, CA" but not "Canada" or "Caracas"
const US_STATE_PATTERNS = [
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga",
  "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md",
  "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
  "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc",
  "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy", "dc",
].map((s) => `, ${s}`);

function matchesUsEntry(loc: string): boolean {
  if (US_ALIASES.has(loc)) return true; // e.g. "Remote, United States"
  return US_STATE_PATTERNS.some((p) => loc.includes(p));
}

export function matchesLocation(
  location: string | undefined,
  locations: string[] | undefined,
  sendIfNoLocation: boolean
): boolean {
  if (!locations || locations.length === 0) return true;
  if (!location) return sendIfNoLocation;
  const loc = location.toLowerCase();
  return locations.some((l) => {
    const entry = l.toLowerCase();
    return US_ALIASES.has(entry) ? matchesUsEntry(loc) : loc.includes(entry);
  });
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
