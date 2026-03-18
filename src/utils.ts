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

const SKILLS: Array<[string, RegExp]> = [
  ["Python",       /\bpython\b/i],
  ["Go",           /\bgolang\b|\bgo\b/i],
  ["Java",         /\bjava\b(?!script)/i],
  ["Scala",        /\bscala\b/i],
  ["Kotlin",       /\bkotlin\b/i],
  ["TypeScript",   /\btypescript\b/i],
  ["JavaScript",   /\bjavascript\b/i],
  ["Ruby",         /\bruby\b/i],
  ["Rust",         /\brust\b/i],
  ["C++",          /\bc\+\+/i],
  ["C#",           /\bc#/i],
  ["Swift",        /\bswift\b/i],
  ["Elixir",       /\belixir\b/i],
  ["React",        /\breact\b/i],
  ["Vue",          /\bvue\b/i],
  ["Angular",      /\bangular\b/i],
  ["Node.js",      /\bnode\.?js\b/i],
  ["Django",       /\bdjango\b/i],
  ["FastAPI",      /\bfastapi\b/i],
  ["Spring",       /\bspring\b/i],
  ["Next.js",      /\bnext\.?js\b/i],
  ["AWS",          /\baws\b/i],
  ["GCP",          /\bgcp\b|\bgoogle cloud\b/i],
  ["Azure",        /\bazure\b/i],
  ["Kubernetes",   /\bkubernetes\b|\bk8s\b/i],
  ["Docker",       /\bdocker\b/i],
  ["Terraform",    /\bterraform\b/i],
  ["PostgreSQL",   /\bpostgres(?:ql)?\b/i],
  ["MySQL",        /\bmysql\b/i],
  ["Redis",        /\bredis\b/i],
  ["Kafka",        /\bkafka\b/i],
  ["Spark",        /\bspark\b/i],
  ["Elasticsearch",/\belasticsearch\b/i],
  ["MongoDB",      /\bmongodb\b/i],
  ["PyTorch",      /\bpytorch\b/i],
  ["TensorFlow",   /\btensorflow\b/i],
  ["GraphQL",      /\bgraphql\b/i],
  ["gRPC",         /\bgrpc\b/i],
];

export function parseQualifications(raw: string): string | undefined {
  const text = stripTags(raw);

  let degree: string | undefined;
  if (/\bph\.?d\.?\b|\bdoctorate\b/i.test(text)) {
    degree = "PhD";
  } else if (/\bmaster[\s']?s?\b|\bm\.?[sa]\.?\b|\bmba\b/i.test(text)) {
    degree = "MS+";
  } else if (/\bbachelor[\s']?s?\b|\bb\.?[sa]\.?\b|\bundergraduate\b/i.test(text)) {
    degree = "BS+";
  }

  let experience: string | undefined;
  const expMatch = text.match(
    /(\d+)(?:\+|\s*[-–]\s*\d+)?\s*\+?\s*years?\s+(?:of\s+)?(?:professional\s+|relevant\s+|work\s+)?experience/i
  );
  if (expMatch) {
    experience = `${expMatch[1]}+ yrs`;
  }

  const skills: string[] = [];
  for (const [name, pattern] of SKILLS) {
    if (pattern.test(text)) {
      skills.push(name);
      if (skills.length === 5) break;
    }
  }

  const parts = [
    degree,
    experience,
    skills.length > 0 ? skills.join(", ") : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" • ") : undefined;
}

export function formatSalaryRange(min: number | null, max: number | null): string | undefined {
  if (min != null && max != null) return `${fmtSalaryK(min)}–${fmtSalaryK(max)}/yr`;
  if (min != null) return `${fmtSalaryK(min)}+/yr`;
  return undefined;
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
