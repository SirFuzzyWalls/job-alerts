import type { Config } from "../config.js";
import type { Job } from "./types.js";
import { fetchUSAJobs } from "./usajobs.js";
import { fetchGreenhouse } from "./greenhouse.js";
import { fetchLever } from "./lever.js";
import { fetchAshby } from "./ashby.js";
import { fetchWorkday } from "./workday.js";
import { fetchHackerNews } from "./hackernews.js";
import { allSettledConcurrent } from "../utils.js";

export type { Job };

const FETCH_CONCURRENCY = 10;

export async function fetchAllJobs(config: Config): Promise<Job[]> {
  const tasks: Array<{ label: string; fn: () => Promise<Job[]> }> = [];

  // USAJobs (if configured)
  if (config.usajobs?.apiKey) {
    tasks.push({ label: "usajobs", fn: () => fetchUSAJobs(config.jobTitles, config.usajobs!) });
  }

  // Hacker News (if configured)
  if (config.hackernews) {
    tasks.push({ label: "hackernews", fn: () => fetchHackerNews() });
  }

  // Per-company sources
  for (const company of config.companies ?? []) {
    switch (company.source) {
      case "greenhouse":
        tasks.push({ label: `greenhouse:${company.slug}`, fn: () => fetchGreenhouse(company.slug) });
        break;
      case "lever":
        tasks.push({ label: `lever:${company.slug}`, fn: () => fetchLever(company.slug) });
        break;
      case "ashby":
        tasks.push({ label: `ashby:${company.slug}`, fn: () => fetchAshby(company.slug) });
        break;
      case "workday":
        tasks.push({
          label: `workday:${company.subdomain ?? company.company}`,
          fn: () =>
            fetchWorkday({
              company: company.company,
              careerSite: company.careerSite,
              subdomain: company.subdomain,
              ...(company.baseUrl ? { baseUrl: company.baseUrl } : {}),
            }),
        });
        break;
      default:
        console.warn(`[sources] Unknown source: ${(company as { source: string }).source}`);
    }
  }

  const results = await allSettledConcurrent(tasks.map(t => t.fn), FETCH_CONCURRENCY);
  const jobs: Job[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      console.log(`[sources] ${tasks[i].label} ${result.value.length} jobs`);
      jobs.push(...result.value);
    } else {
      console.error(`[sources] ${tasks[i].label} failed:`, result.reason);
    }
  }

  return jobs;
}
