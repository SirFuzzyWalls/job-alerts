import type { Job } from "./types.js";

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

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 20, offset: 0, searchText: "" }),
    });
  } catch (err) {
    console.error(`[workday:${company}] Network error:`, err);
    return [];
  }

  if (!res.ok) {
    console.error(`[workday:${company}] HTTP ${res.status}`);
    return [];
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const snippet = (await res.text()).slice(0, 120).replace(/\s+/g, " ").trim();
    console.error(
      `[workday:${company}] Expected JSON but got "${contentType}" — body: ${snippet}`
    );
    return [];
  }

  let data: { jobPostings?: WorkdayJobPosting[] };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    console.error(`[workday:${company}] Failed to parse JSON`);
    return [];
  }

  return (data.jobPostings ?? []).map((p, i) => {
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
