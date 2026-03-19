import type { Job } from "./types.js";
import { fetchWithRetry, parseSalaryText, parseQualifications, allSettledConcurrent } from "../utils.js";

interface WorkdayCompanyConfig {
  company: string;
  careerSite: string;
  subdomain: string;
  baseUrl?: string;
}

interface WorkdayJobPosting {
  title: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
  bulletFields?: string[];
}

function parseWorkdayPostedOn(str: string | undefined): string | undefined {
  if (!str) return undefined;
  const now = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const sub = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return ymd(d);
  };

  const s = str.trim();
  if (/^posted today$/i.test(s)) return ymd(now);
  if (/^posted yesterday$/i.test(s)) return sub(1);

  const daysMatch = s.match(/^posted (\d+)\+? days? ago$/i);
  if (daysMatch) return sub(parseInt(daysMatch[1], 10));

  const monthsMatch = s.match(/^posted (\d+)\+? months? ago$/i);
  if (monthsMatch) return sub(parseInt(monthsMatch[1], 10) * 30);

  return undefined;
}

export async function fetchWorkday(cfg: WorkdayCompanyConfig): Promise<Job[]> {
  const { company, careerSite, subdomain, baseUrl: cfgBaseUrl } = cfg;
  const baseUrl = cfgBaseUrl ?? `https://${company}.${subdomain}.myworkdayjobs.com`;
  const apiPath = `/wday/cxs/${company}/${careerSite}/jobs`;
  const url = baseUrl + apiPath;

  const PAGE_SIZE = 20;
  const MAX_PAGES = 10;
  let offset = 0;
  let total = 0;
  const allPostings: WorkdayJobPosting[] = [];

  do {
    let res: Response;
    try {
      res = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: PAGE_SIZE, offset, searchText: "" }),
      });
    } catch (err) {
      console.error(`[workday:${company}] Network error:`, err);
      break;
    }

    if (!res.ok) {
      console.error(`[workday:${company}] HTTP ${res.status}`);
      break;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      const snippet = (await res.text()).slice(0, 120).replace(/\s+/g, " ").trim();
      console.error(
        `[workday:${company}] Expected JSON but got "${contentType}" — body: ${snippet}`
      );
      break;
    }

    let data: { total?: number; jobPostings?: WorkdayJobPosting[] };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      console.error(`[workday:${company}] Failed to parse JSON`);
      break;
    }

    allPostings.push(...(data.jobPostings ?? []));
    total = data.total ?? 0;
    offset += PAGE_SIZE;
  } while (offset < total && offset < PAGE_SIZE * MAX_PAGES);

  return allPostings.map((p, i) => {
    // Workday doesn't return a stable ID in the listing — use the path segment
    const rawPath = p.externalPath ?? "";
    const id = rawPath.split("/").pop() ?? String(i);
    const jobUrl = rawPath
      ? `${baseUrl}/en-US/${careerSite}${rawPath}`
      : `${baseUrl}/en-US/${careerSite}/job/${id}`;

    const bulletText = (p.bulletFields ?? []).join(" ");
    const { salary, salaryMin, salaryMax } = bulletText
      ? parseSalaryText(bulletText)
      : {};
    const qualifications = parseQualifications(bulletText);
    return {
      id,
      stateKey: `workday-${company}-${id}`,
      title: p.title ?? "(untitled)",
      company,
      url: jobUrl,
      source: "Workday",
      location: p.locationsText,
      postedAt: parseWorkdayPostedOn(p.postedOn),
      salary,
      salaryMin,
      salaryMax,
      qualifications,
    };
  });
}

async function fetchJobPageDescription(url: string): Promise<string | undefined> {
  let res: Response;
  try {
    res = await fetchWithRetry(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; job-alerts/1.0)" },
    }, { maxRetries: 1 });
  } catch {
    return undefined;
  }
  if (!res.ok) return undefined;

  let html: string;
  try {
    html = await res.text();
  } catch {
    return undefined;
  }

  // Extract description from JSON-LD JobPosting structured data
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]) as Record<string, unknown>;
      if (data["@type"] === "JobPosting" && typeof data.description === "string") {
        return data.description;
      }
    } catch {
      // malformed JSON block, try next
    }
  }
  return undefined;
}

/**
 * For each Workday job in the list, fetches its detail page and overwrites
 * qualifications with data extracted from the full job description.
 * All other sources and any already-enriched jobs are passed through unchanged.
 */
export async function enrichWorkdayQualifications(jobs: Job[]): Promise<Job[]> {
  const workdayIndices = jobs
    .map((j, i) => (j.source === "Workday" ? i : -1))
    .filter((i) => i !== -1);

  if (workdayIndices.length === 0) return jobs;

  const tasks = workdayIndices.map((i) => () => fetchJobPageDescription(jobs[i].url));
  const results = await allSettledConcurrent(tasks, 3);

  const out = [...jobs];
  for (let t = 0; t < workdayIndices.length; t++) {
    const result = results[t];
    if (result.status === "fulfilled" && result.value) {
      const idx = workdayIndices[t];
      out[idx] = { ...out[idx], qualifications: parseQualifications(result.value) };
    }
  }
  return out;
}
