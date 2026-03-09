import fs from "fs";
import path from "path";
import { writeFileAtomic } from "./utils.js";

const STATE_FILE = path.resolve(process.cwd(), "seen_jobs.json");

export type SeenJobs = Record<string, number>;

export function loadState(): { seen: SeenJobs; isFirstRun: boolean; lastCheckAt: number | undefined; activeKeys: string[] } {
  if (!fs.existsSync(STATE_FILE)) {
    return { seen: {}, isFirstRun: true, lastCheckAt: undefined, activeKeys: [] };
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const { seen, lastCheckAt, activeKeys } = JSON.parse(raw);
    return {
      seen: seen ?? {},
      lastCheckAt: typeof lastCheckAt === "number" ? lastCheckAt : undefined,
      activeKeys: Array.isArray(activeKeys) ? activeKeys : [],
      isFirstRun: false,
    };
  } catch (err) {
    console.warn("[state] Could not load seen_jobs.json, starting fresh:", err);
    return { seen: {}, isFirstRun: false, lastCheckAt: undefined, activeKeys: [] };
  }
}

export function pruneState(seen: SeenJobs, retentionDays: number): SeenJobs {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const pruned: SeenJobs = {};
  for (const [key, ts] of Object.entries(seen)) {
    if (ts > cutoff) pruned[key] = ts;
  }
  return pruned;
}

export function saveState(seen: SeenJobs, lastCheckAt: number, activeKeys: string[]): void {
  try {
    writeFileAtomic(STATE_FILE, JSON.stringify({ seen, lastCheckAt, activeKeys }, null, 2));
  } catch (err) {
    console.error("[state] Failed to save seen_jobs.json:", err);
  }
}
