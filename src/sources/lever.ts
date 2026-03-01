import type { Job } from "./types.js";

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  categories?: { location?: string };
  createdAt?: number;
}

export async function fetchLever(slug: string): Promise<Job[]> {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;

  let res: Response;
  try {
    res = await fetch(url);
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

  return data.map((p) => ({
    id: p.id,
    stateKey: `lever-${slug}-${p.id}`,
    title: p.text,
    company: slug,
    url: p.hostedUrl,
    source: "Lever",
    location: p.categories?.location,
    postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
  }));
}
