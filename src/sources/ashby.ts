import type { Job } from "./types.js";
import { fetchWithRetry } from "../utils.js";

interface AshbyCompensationComponent {
  compensationType: string;
  interval: string;
  currencyCode: string;
  minValue?: number;
  maxValue?: number;
}

interface AshbyJob {
  id: string;
  title: string;
  jobUrl?: string;
  isListed: boolean;
  locationName?: string;
  publishedDate?: string;
  department?: { name?: string };
  compensation?: {
    compensationTierSummary?: string;
    summaryComponents?: AshbyCompensationComponent[];
  };
}

export async function fetchAshby(slug: string): Promise<Job[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;

  let res: Response;
  try {
    res = await fetchWithRetry(url, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[ashby:${slug}] Network error:`, err);
    return [];
  }

  if (!res.ok) {
    console.error(`[ashby:${slug}] HTTP ${res.status}`);
    return [];
  }

  let data: { jobs?: AshbyJob[] };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    console.error(`[ashby:${slug}] Failed to parse JSON`);
    return [];
  }

  return (data.jobs ?? [])
    .filter((j) => j.isListed)
    .map((j) => {
      const salary = j.compensation?.compensationTierSummary ?? undefined;

      // Extract numeric salary from summaryComponents where type is Salary and interval is annual
      const salarySummary = j.compensation?.summaryComponents?.find(
        (c) => c.compensationType === "Salary" && c.interval.toUpperCase().includes("YEAR")
      );
      const salaryMin = salarySummary?.minValue;
      const salaryMax = salarySummary?.maxValue;

      return {
        id: j.id,
        stateKey: `ashby-${slug}-${j.id}`,
        title: j.title,
        company: slug,
        url: j.jobUrl ?? `https://jobs.ashbyhq.com/${slug}/${j.id}`,
        source: "Ashby",
        location: j.locationName,
        postedAt: j.publishedDate,
        salary,
        salaryMin,
        salaryMax,
      };
    });
}
