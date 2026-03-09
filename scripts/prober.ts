import { fetchGreenhouse } from "../src/sources/greenhouse.js";
import { fetchLever }      from "../src/sources/lever.js";
import { fetchAshby }      from "../src/sources/ashby.js";
import { fetchWorkday }    from "../src/sources/workday.js";
import type { BoardEntry } from "../src/registry.js";

export interface ProbeResult {
  ok: boolean;
  count: number;
  error: string | null;
  samples: string[];   // up to 3 job titles
}

export async function probeBoard(entry: BoardEntry): Promise<ProbeResult> {
  let jobs;
  switch (entry.source) {
    case "greenhouse": jobs = await fetchGreenhouse(entry.slug); break;
    case "lever":      jobs = await fetchLever(entry.slug); break;
    case "ashby":      jobs = await fetchAshby(entry.slug); break;
    case "workday":    jobs = await fetchWorkday({ company: entry.company, careerSite: entry.careerSite, subdomain: entry.subdomain, baseUrl: entry.baseUrl }); break;
    default: return { ok: false, count: 0, error: `Unknown source: ${(entry as {source:string}).source}`, samples: [] };
  }
  if (jobs.length === 0)
    return { ok: false, count: 0, error: "0 jobs returned (invalid slug, private board, or empty)", samples: [] };
  return { ok: true, count: jobs.length, error: null, samples: jobs.slice(0, 3).map(j => j.title) };
}
