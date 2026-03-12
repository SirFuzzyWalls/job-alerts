import fs from "fs";

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function parseAmount(digits: string, hasK: boolean): number {
  const n = parseFloat(digits.replace(/,/g, ""));
  return hasK ? n * 1000 : n;
}

export function fmtSalaryK(n: number): string {
  return `$${Math.round(n / 1000)}K`;
}

/**
 * Scans free-form text (HTML ok) for a salary range like "$120,000–$160,000"
 * or "$120K–$160K". Returns undefined fields if no plausible annual salary found.
 */
export function parseSalaryText(raw: string): {
  salary?: string;
  salaryMin?: number;
  salaryMax?: number;
} {
  const text = stripTags(raw);
  const m = text.match(
    /\$\s*([\d,]+)\s*(k)?\s*(?:[-–—]|to)\s*\$?\s*([\d,]+)\s*(k)?/i
  );
  if (!m) return {};
  const min = parseAmount(m[1], !!m[2]);
  const max = parseAmount(m[3], !!m[4]);
  if (min < 10_000 || max < 10_000) return {};
  return {
    salary: `${fmtSalaryK(min)}–${fmtSalaryK(max)}/yr`,
    salaryMin: min,
    salaryMax: max,
  };
}

export function writeFileAtomic(filePath: string, content: string): void {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

/**
 * Wraps fetch with exponential backoff retries on 429 and network errors.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  { maxRetries = 3, baseDelayMs = 1000 }: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      const res = await fetch(url, options);
      if (res.status === 429 && attempt < maxRetries) continue;
      return res;
    } catch (err) {
      if (attempt === maxRetries) throw err;
    }
  }
  /* istanbul ignore next */
  throw new Error("fetchWithRetry: unreachable");
}

/**
 * Runs an array of lazy tasks with a maximum concurrency, returning results
 * in the same order as the input (matching the shape of Promise.allSettled).
 */
export async function allSettledConcurrent<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}
