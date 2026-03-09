import fs from "fs";

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
