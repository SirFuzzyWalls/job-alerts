import type { Job } from "./types.js";
import { parseSalaryText, parseQualifications, fetchWithRetry } from "../utils.js";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  updated_at?: string;
  content?: string;
}

export async function fetchGreenhouse(slug: string): Promise<Job[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;

  let res: Response;
  try {
    res = await fetchWithRetry(url, {});
  } catch (err) {
    console.error(`[greenhouse:${slug}] Network error:`, err);
    return [];
  }

  if (!res.ok) {
    console.error(`[greenhouse:${slug}] HTTP ${res.status}`);
    return [];
  }

  let data: { jobs?: GreenhouseJob[] };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    console.error(`[greenhouse:${slug}] Failed to parse JSON`);
    return [];
  }

  return (data.jobs ?? []).map((j) => {
    const { salary, salaryMin, salaryMax } = j.content
      ? parseSalaryText(j.content)
      : {};
    const qualifications = parseQualifications(j.content ?? "");
    return {
      id: String(j.id),
      stateKey: `greenhouse-${slug}-${j.id}`,
      title: j.title,
      company: slug,
      url: j.absolute_url,
      source: "Greenhouse",
      location: j.location?.name,
      postedAt: j.updated_at,
      salary,
      salaryMin,
      salaryMax,
      qualifications,
    };
  });
}
