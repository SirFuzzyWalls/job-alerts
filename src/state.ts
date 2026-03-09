import fs from "fs";
import path from "path";
import { writeFileAtomic } from "./utils.js";

const STATE_FILE = path.resolve(process.cwd(), "seen_jobs.json");

export type SeenJobs = Record<string, number>;

export function loadState(): { seen: SeenJobs; isFirstRun: boolean; lastCheckAt: number | undefined } {
  if (!fs.existsSync(STATE_FILE)) {
    return { seen: {}, isFirstRun: true, lastCheckAt: undefined };
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // New format: { seen: {...}, lastCheckAt: number }
    // Old format: flat { stateKey: timestamp, ... }
    if ("seen" in parsed && typeof parsed.seen === "object" && parsed.seen !== null) {
      return {
        seen: parsed.seen as SeenJobs,
        lastCheckAt: typeof parsed.lastCheckAt === "number" ? parsed.lastCheckAt : undefined,
        isFirstRun: false,
      };
    }
    // Backward compat: old flat format
    return { seen: parsed as SeenJobs, lastCheckAt: undefined, isFirstRun: false };
  } catch (err) {
    console.warn("[state] Could not load seen_jobs.json, starting fresh:", err);
    return { seen: {}, isFirstRun: false, lastCheckAt: undefined };
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

export function saveState(seen: SeenJobs, lastCheckAt: number): void {
  try {
    writeFileAtomic(STATE_FILE, JSON.stringify({ seen, lastCheckAt }, null, 2));
  } catch (err) {
    console.error("[state] Failed to save seen_jobs.json:", err);
  }
}
