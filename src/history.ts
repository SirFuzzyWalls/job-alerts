import fs from "fs";
import path from "path";
import type { Job } from "./sources/types.js";
import { writeFileAtomic } from "./utils.js";

export type JobRecord = Job & { sentAt: number };

const HISTORY_FILE = path.join(process.cwd(), "job_history.json");

export function loadHistory(): JobRecord[] {
if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendToHistory(jobs: Job[], sentAt: number = Date.now(), retentionDays = 90): void {
  let existing = loadHistory();
  existing = pruneHistory(existing, retentionDays);
  const records: JobRecord[] = jobs.map((j) => ({ ...j, sentAt }));
  // Deduplicate by stateKey (in case of retry)
  const seen = new Set(existing.map((r) => r.stateKey));
  const newRecords = records.filter((r) => !seen.has(r.stateKey));
  if (newRecords.length < records.length) {
    console.log(`[history] Skipped ${records.length - newRecords.length} duplicate(s)`);
  }
  const updated = [...existing, ...newRecords];
  console.log(`[history] Appended ${newRecords.length} record(s) (total: ${updated.length})`);
  writeFileAtomic(HISTORY_FILE, JSON.stringify(updated, null, 2));
}

export function removeFromHistory(stateKeys: Set<string>): void {
  const records = loadHistory().filter((r) => !stateKeys.has(r.stateKey));
  writeFileAtomic(HISTORY_FILE, JSON.stringify(records, null, 2));
}

export function pruneHistory(records: JobRecord[], retentionDays: number): JobRecord[] {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  return records.filter((r) => r.sentAt >= cutoff);
}
