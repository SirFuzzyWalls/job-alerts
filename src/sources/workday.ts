import type { Job } from "./types.js";
import { fetchWithRetry } from "../utils.js";

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

    return {
      id,
      stateKey: `workday-${company}-${id}`,
      title: p.title ?? "(untitled)",
      company,
      url: jobUrl,
      source: "Workday",
      location: p.locationsText,
      postedAt: p.postedOn,
    };
  });
}
