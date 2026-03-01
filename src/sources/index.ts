import type { Config } from "../config.js";
import type { Job } from "./types.js";
import { fetchUSAJobs } from "./usajobs.js";
import { fetchGreenhouse } from "./greenhouse.js";
import { fetchLever } from "./lever.js";
import { fetchAshby } from "./ashby.js";
import { fetchWorkday } from "./workday.js";

export type { Job };

export async function fetchAllJobs(config: Config): Promise<Job[]> {
  const tasks: Promise<Job[]>[] = [];

  // USAJobs (if configured)
  if (config.usajobs?.apiKey) {
    tasks.push(fetchUSAJobs(config.jobTitles, config.usajobs));
  }

  // Per-company sources
  for (const company of config.companies ?? []) {
    switch (company.source) {
      case "greenhouse":
        tasks.push(fetchGreenhouse(company.slug));
        break;
      case "lever":
        tasks.push(fetchLever(company.slug));
        break;
      case "ashby":
        tasks.push(fetchAshby(company.slug));
        break;
      case "workday":
        tasks.push(
          fetchWorkday({
            company: company.company,
            careerSite: company.careerSite,
            subdomain: company.subdomain,
          })
        );
        break;
      default:
        console.warn(`[sources] Unknown source: ${(company as { source: string }).source}`);
    }
  }

  const results = await Promise.allSettled(tasks);
  const jobs: Job[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      jobs.push(...result.value);
    } else {
      console.error("[sources] A source fetch failed:", result.reason);
    }
  }

  return jobs;
}
