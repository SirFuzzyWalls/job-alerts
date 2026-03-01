import type { Job } from "./types.js";

interface AshbyJob {
  id: string;
  title: string;
  jobUrl?: string;
  isListed: boolean;
  locationName?: string;
  publishedDate?: string;
  department?: { name?: string };
}

export async function fetchAshby(slug: string): Promise<Job[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;

  let res: Response;
  try {
    res = await fetch(url, {
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
    .map((j) => ({
      id: j.id,
      stateKey: `ashby-${slug}-${j.id}`,
      title: j.title,
      company: slug,
      url:
        j.jobUrl ??
        `https://jobs.ashbyhq.com/${slug}/${j.id}`,
      source: "Ashby",
      location: j.locationName,
      postedAt: j.publishedDate,
    }));
}
