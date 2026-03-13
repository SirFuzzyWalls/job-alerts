import type { Job } from "./types.js";
import { fetchWithRetry, fmtSalaryK, parseQualifications } from "../utils.js";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  categories?: { location?: string };
  createdAt?: number;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  description?: string;
}

function toAnnual(value: number, interval: string): number {
  const i = interval.toLowerCase();
  if (i === "hourly") return value * 2080;
  if (i === "weekly") return value * 52;
  if (i === "monthly") return value * 12;
  return value; // yearly, per-year-salary, or unrecognized → assume annual
}

export async function fetchLever(slug: string): Promise<Job[]> {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;

  let res: Response;
  try {
    res = await fetchWithRetry(url, {});
  } catch (err) {
    console.error(`[lever:${slug}] Network error:`, err);
    return [];
  }

  if (!res.ok) {
    console.error(`[lever:${slug}] HTTP ${res.status}`);
    return [];
  }

  let data: LeverPosting[];
  try {
    data = (await res.json()) as LeverPosting[];
  } catch {
    console.error(`[lever:${slug}] Failed to parse JSON`);
    return [];
  }

  if (!Array.isArray(data)) {
    console.error(`[lever:${slug}] Unexpected response shape`);
    return [];
  }

  return data.map((p) => {
    const sr = p.salaryRange;
    const interval = sr?.interval ?? "yearly";
    const salaryMin = sr?.min != null ? toAnnual(sr.min, interval) : undefined;
    const salaryMax = sr?.max != null ? toAnnual(sr.max, interval) : undefined;

    let salary: string | undefined;
    if (salaryMin != null && salaryMax != null) {
      salary = `${fmtSalaryK(salaryMin)}–${fmtSalaryK(salaryMax)}/yr`;
    } else if (salaryMin != null) {
      salary = `${fmtSalaryK(salaryMin)}+/yr`;
    } else if (salaryMax != null) {
      salary = `up to ${fmtSalaryK(salaryMax)}/yr`;
    }

    return {
      id: p.id,
      stateKey: `lever-${slug}-${p.id}`,
      title: p.text,
      company: slug,
      url: p.hostedUrl,
      source: "Lever",
      location: p.categories?.location,
      postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
      salary,
      salaryMin,
      salaryMax,
      qualifications: parseQualifications(p.description ?? ""),
    };
  });
}
