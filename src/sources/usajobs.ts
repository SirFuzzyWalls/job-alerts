import type { Job } from "./types.js";
import { fetchWithRetry, fmtSalaryK, parseQualifications } from "../utils.js";

interface USAJobsConfig {
  apiKey: string;
  userAgent: string;
}

interface USAJobsPosition {
  PositionID: string;
  PositionTitle: string;
  OrganizationName: string;
  PositionURI: string;
  PositionLocation?: Array<{ LocationName?: string }>;
  PublicationStartDate?: string;
  SalaryMin?: string;
  SalaryMax?: string;
  QualificationSummary?: string;
  UserArea?: { Details?: { Requirements?: string; Education?: string } };
}

function parseSalaryStr(s: string): number | undefined {
  const n = parseFloat(s.replace(/[$,]/g, ""));
  return isFinite(n) ? n : undefined;
}

export async function fetchUSAJobs(
  jobTitles: string[],
  config: USAJobsConfig
): Promise<Job[]> {
  const seen = new Set<string>();
  const jobs: Job[] = [];

  for (const title of jobTitles) {
    const url = new URL("https://data.usajobs.gov/api/search");
    url.searchParams.set("Keyword", title);
    url.searchParams.set("ResultsPerPage", "50");

    let res: Response;
    try {
      res = await fetchWithRetry(url.toString(), {
        headers: {
          Host: "data.usajobs.gov",
          "Authorization-Key": config.apiKey,
          "User-Agent": config.userAgent,
        },
      });
    } catch (err) {
      console.error(`[usajobs] Network error for keyword "${title}":`, err);
      continue;
    }

    if (!res.ok) {
      console.error(
        `[usajobs] HTTP ${res.status} for keyword "${title}"`
      );
      continue;
    }

    let data: { SearchResult?: { SearchResultItems?: Array<{ MatchedObjectDescriptor: USAJobsPosition }> } };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      console.error(`[usajobs] Failed to parse JSON for keyword "${title}"`);
      continue;
    }

    const items =
      data?.SearchResult?.SearchResultItems ?? [];

    for (const item of items) {
      const pos = item.MatchedObjectDescriptor;
      if (!pos?.PositionID || seen.has(pos.PositionID)) continue;
      seen.add(pos.PositionID);

      const salaryMin = pos.SalaryMin ? parseSalaryStr(pos.SalaryMin) : undefined;
      const salaryMax = pos.SalaryMax ? parseSalaryStr(pos.SalaryMax) : undefined;

      let salary: string | undefined;
      if (salaryMin != null && salaryMax != null) {
        salary = `${fmtSalaryK(salaryMin)}–${fmtSalaryK(salaryMax)}/yr`;
      } else if (salaryMin != null) {
        salary = `${fmtSalaryK(salaryMin)}+/yr`;
      }

      const qualText = [
        pos.QualificationSummary,
        pos.UserArea?.Details?.Requirements,
        pos.UserArea?.Details?.Education,
      ].filter(Boolean).join(" ");
      jobs.push({
        id: pos.PositionID,
        stateKey: `usajobs-${pos.PositionID}`,
        title: pos.PositionTitle,
        company: pos.OrganizationName ?? "U.S. Government",
        url: pos.PositionURI,
        source: "USAJobs",
        location: pos.PositionLocation?.[0]?.LocationName,
        postedAt: pos.PublicationStartDate,
        salary,
        salaryMin,
        salaryMax,
        qualifications: qualText ? parseQualifications(qualText) : undefined,
      });
    }
  }

  return jobs;
}
