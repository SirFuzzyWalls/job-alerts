import fs from "fs";
import path from "path";

const STATE_FILE = path.resolve(process.cwd(), "seen_jobs.json");

export type SeenJobs = Record<string, true>;

export function loadState(): SeenJobs {
  if (!fs.existsSync(STATE_FILE)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw) as SeenJobs;
  } catch (err) {
    console.warn("[state] Could not load seen_jobs.json, starting fresh:", err);
    return {};
  }
}

export function saveState(seen: SeenJobs): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(seen, null, 2), "utf-8");
  } catch (err) {
    console.error("[state] Failed to save seen_jobs.json:", err);
  }
}
