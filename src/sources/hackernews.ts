import type { Job } from "./types.js";
import { parseQualifications } from "../utils.js";

const JOB_STORIES_URL = "https://hacker-news.firebaseio.com/v0/jobstories.json";
const ITEM_URL = (id: number) =>
  `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

interface HNItem {
  id: number;
  title?: string;
  by?: string;
  time?: number;
  url?: string;
  text?: string;
  type?: string;
}

function parseCompanyAndRole(title: string): { company: string; role: string } {
  // "X (YC Wx) is hiring [a[n]] Y"  →  company=X, role=Y
  const ycHiring = title.match(
    /^(.+?)\s*(?:\([^)]*YC[^)]*\))?\s+is hiring\s+(?:an?\s+)?(.+)/i
  );
  if (ycHiring) return { company: ycHiring[1].trim(), role: ycHiring[2].trim() };

  // "Company | Role | ..."  →  company=Company, role=Role
  const pipe = title.match(/^([^|]+)\|([^|]+)/);
  if (pipe) return { company: pipe[1].trim(), role: pipe[2].trim() };

  // "Company – Role" or "Company - Role"
  const dash = title.match(/^(.+?)\s+[–\-]\s+(.+)/);
  if (dash) return { company: dash[1].trim(), role: dash[2].trim() };

  return { company: "", role: title };
}

function extractLocation(title: string, text?: string): string | undefined {
  if (/\bremote\b/i.test(title)) return "Remote";
  if (text && /\bremote\b/i.test(text.replace(/<[^>]+>/g, " "))) return "Remote";
  return undefined;
}

async function fetchItem(id: number): Promise<HNItem | null> {
  try {
    const res = await fetch(ITEM_URL(id));
    if (!res.ok) return null;
    return (await res.json()) as HNItem;
  } catch {
    return null;
  }
}

export async function fetchHackerNews(): Promise<Job[]> {
  let ids: number[];
  try {
    const res = await fetch(JOB_STORIES_URL);
    if (!res.ok) {
      console.error(`[hackernews] HTTP ${res.status} fetching job stories`);
      return [];
    }
    ids = (await res.json()) as number[];
  } catch (err) {
    console.error("[hackernews] Failed to fetch job story IDs:", err);
    return [];
  }

  // Batch-fetch items 20 at a time to avoid flooding the API
  const items: HNItem[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    const results = await Promise.all(batch.map(fetchItem));
    for (const item of results) {
      if (item) items.push(item);
    }
  }

  const jobs: Job[] = [];
  for (const item of items) {
    if (item.type !== "job" || !item.title) continue;

    const { company, role } = parseCompanyAndRole(item.title);

    jobs.push({
      id: String(item.id),
      stateKey: `hn-${item.id}`,
      title: role,
      company: company || item.by || "Unknown",
      url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
      source: "Hacker News",
      postedAt: item.time ? new Date(item.time * 1000).toISOString() : undefined,
      location: extractLocation(item.title, item.text),
      qualifications: item.text ? parseQualifications(item.text) : undefined,
    });
  }

  return jobs;
}
