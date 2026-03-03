import fs from "fs";
import path from "path";

const STATE_FILE = path.resolve(process.cwd(), "seen_jobs.json");

export type SeenJobs = Record<string, number>;

export function loadState(): { seen: SeenJobs; isFirstRun: boolean } {
  if (!fs.existsSync(STATE_FILE)) {
    return { seen: {}, isFirstRun: true };
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return { seen: JSON.parse(raw) as SeenJobs, isFirstRun: false };
  } catch (err) {
    console.warn("[state] Could not load seen_jobs.json, starting fresh:", err);
    return { seen: {}, isFirstRun: false };
  }
}

export function pruneState(seen: SeenJobs, retentionDays: number): SeenJobs {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const pruned: SeenJobs = {};
  for (const [key, ts] of Object.entries(seen)) {
    // Treat legacy `true` values (stored as boolean, number coerces to NaN/0) as 0 → pruned
    const timestamp = typeof ts === "number" ? ts : 0;
    if (timestamp > cutoff) {
      pruned[key] = timestamp;
    }
  }
  return pruned;
}

export function saveState(seen: SeenJobs): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(seen, null, 2), "utf-8");
  } catch (err) {
    console.error("[state] Failed to save seen_jobs.json:", err);
  }
}
