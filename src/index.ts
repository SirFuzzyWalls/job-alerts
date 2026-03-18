import cron from "node-cron";
import { loadConfig } from "./config.js";
import type { Config } from "./config.js";
import { fetchAllJobs } from "./sources/index.js";
import type { Job } from "./sources/index.js";
import { enrichWorkdayQualifications } from "./sources/workday.js";
import { matchesTitle, matchesSalary, matchesLocation } from "./matcher.js";
import { loadState, pruneState, saveState } from "./state.js";
import { sendDigest, buildEmailBody } from "./notifier.js";
import { appendToHistory, removeFromHistory } from "./history.js";
import { loadScores, scoreJob, OllamaUnavailableError } from "./scorer.js";

const onceMode = process.argv.includes("--once");
const dryRunMode = process.argv.includes("--dry-run");
const dashboardMode = process.argv.includes("--dashboard");
const scoreMode = process.argv.includes("--score") || process.env.npm_config_score === "true";


function applyFilters(jobs: Job[], config: Config): Job[] {
  return jobs.filter(
    (job) =>
      matchesTitle(job.title, config.jobTitles, config.excludeTitleWords) &&
      matchesSalary(job.salaryMin, job.salaryMax, config.minSalary, config.maxSalary, config.sendIfNoSalary) &&
      matchesLocation(job.location, config.locations, config.sendIfNoLocation)
  );
}

let checkRunning = false;

async function runDryRun(): Promise<void> {
  const t0 = Date.now();
  const config = loadConfig();

  const companyList = (config.companies ?? [])
    .map((c) => `${c.source}${"slug" in c ? `:${c.slug}` : ":" + c.company}`)
    .join(", ");
  console.log(
    `[dry-run] Config OK. ${config.companies?.length ?? 0} company source(s): ${companyList || "(none)"}`
  );
  console.log(`[dry-run] Job title filters: ${config.jobTitles.join(", ")}`);
  console.log("[dry-run] Fetching jobs (no email will be sent, no state saved)…\n");

  const allJobs = await fetchAllJobs(config);

  // Group by source+company for display
  const bySource = new Map<string, typeof allJobs>();
  for (const job of allJobs) {
    const key = `${job.source} / ${job.company}`;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(job);
  }

  for (const [key, jobs] of bySource) {
    console.log(`  ${key}: ${jobs.length} job(s) fetched`);
  }

  const matched = await enrichWorkdayQualifications(applyFilters(allJobs, config));
  console.log(`\n[dry-run] Total fetched: ${allJobs.length} | Matches: ${matched.length}`);

  if (matched.length > 0) {
    console.log("[dry-run] Matched jobs:");
    for (const job of matched) {
      const salaryStr = job.salary ? ` | ${job.salary}` : "";
      const qualsStr = job.qualifications ? ` | ${job.qualifications}` : "";
      console.log(`  · ${job.title} @ ${job.company}${salaryStr}${qualsStr} — ${job.url}`);
    }
  }

  const { lastCheckAt: dryLastCheckAt } = loadState();
  console.log("\n--- Email preview ---");
  console.log(buildEmailBody(matched, config.jobTitles, config.locations, dryLastCheckAt, config.intervalMinutes));
  console.log("--- End of preview ---");
  console.log(`\n[dry-run] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s. No email sent, no state changed.`);
}

async function runCheck(): Promise<void> {
  if (checkRunning) {
    console.warn("[check] Check already running, skipping.");
    return;
  }
  checkRunning = true;
  const t0 = Date.now();
  try {
    await _runCheck();
  } finally {
    checkRunning = false;
    console.log(`[check] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}

async function _runCheck(): Promise<void> {
  const config = loadConfig();
  const { seen: rawSeen, isFirstRun, lastCheckAt, activeKeys: prevActiveKeys } = loadState();
  const seen = pruneState(rawSeen, config.stateRetentionDays);

  console.log(
    `[check] Fetching jobs for: ${config.jobTitles.join(", ")} …`
  );

  const allJobs = await fetchAllJobs(config);
  console.log(`[check] Total jobs fetched: ${allJobs.length}`);

  const activeNow = new Set(allJobs.map((j) => j.stateKey));

  // Detect removals (skip if fetch returned nothing — likely a total failure)
  if (allJobs.length > 0 && prevActiveKeys.length > 0) {
    const removedKeys = new Set(prevActiveKeys.filter((k) => !activeNow.has(k) && k in seen));
    if (removedKeys.size > 0) {
      removeFromHistory(removedKeys);
      for (const k of removedKeys) delete seen[k];
      console.log(`[check] Removed ${removedKeys.size} job(s) no longer listed on boards.`);
    }
  }

  const matches = applyFilters(allJobs, config);

  if (isFirstRun) {
    const now = Date.now();
    for (const job of matches) {
      seen[job.stateKey] = now;
    }
    saveState(seen, now, [...activeNow]);
    console.log(
      `[check] First run — seeded ${matches.length} matching job(s) as seen. No email sent.`
    );
    console.log(
      "[check] Future runs will only email genuinely new postings."
    );
    return;
  }

  const rawNewMatches = matches.filter((job) => !seen[job.stateKey]);

  console.log(`[check] New matches: ${rawNewMatches.length}`);

  if (rawNewMatches.length === 0) {
    console.log("[check] Nothing new — no email sent.");
    saveState(seen, lastCheckAt ?? Date.now(), [...activeNow]);
    return;
  }

  const newMatches = await enrichWorkdayQualifications(rawNewMatches);

  const now = Date.now();

  try {
    await sendDigest(newMatches, config.jobTitles, config.email, config.locations, lastCheckAt, config.intervalMinutes);
  } catch (err) {
    console.error("[check] Failed to send email:", err);
    // Don't mark jobs as seen if the email failed
    return;
  }

  appendToHistory(newMatches, now, config.stateRetentionDays);

  for (const job of newMatches) {
    seen[job.stateKey] = now;
  }
  saveState(seen, now, [...activeNow]);

  console.log(
    `[check] Marked ${newMatches.length} job(s) as seen. State saved.`
  );

  if (scoreMode && config.resumePath) {
    console.log(`[check] Scoring ${newMatches.length} new job(s)…`);
    for (const job of newMatches) {
      try {
        const entry = await scoreJob(job, config.resumePath, config.ollamaModel);
        console.log(`[check] Score: ${entry.score}/100 — ${job.title} @ ${job.company}`);
      } catch (err) {
        if (err instanceof OllamaUnavailableError) {
          console.error(`[check] Ollama unavailable — skipping remaining scores.`);
          break;
        }
        console.warn(`[check] Could not score "${job.title} @ ${job.company}": ${err}`);
      }
    }
  }
}

async function main(): Promise<void> {
  if (dryRunMode) {
    await runDryRun();
    return;
  }

  if (scoreMode) loadScores();

  if (dashboardMode) {
    const { startDashboard } = await import("./dashboard.js");
    startDashboard();
  }

  // Load config once to validate before scheduling
  const config = loadConfig();

  if (onceMode) {
    console.log("[main] Running single check (--once mode).");
    await runCheck();
    return;
  }

  const minutes = config.intervalMinutes;
  // node-cron doesn't support sub-minute intervals > 59 minutes directly,
  // so we convert to a cron expression.
  // For intervals > 60 we use a simpler setInterval fallback.
  if (minutes < 60) {
    const cronExpr = `*/${minutes} * * * *`;
    console.log(
      `[main] Scheduling checks every ${minutes} minute(s) (cron: "${cronExpr}").`
    );

    // Run immediately on startup, then on schedule
    await runCheck();

    cron.schedule(cronExpr, () => {
      runCheck().catch((err) =>
        console.error("[main] Unhandled error in runCheck:", err)
      );
    });
  } else {
    const ms = minutes * 60 * 1000;
    console.log(`[main] Scheduling checks every ${minutes} minutes.`);

    await runCheck();

    setInterval(() => {
      runCheck().catch((err) =>
        console.error("[main] Unhandled error in runCheck:", err)
      );
    }, ms);
  }

  console.log("[main] Scheduler running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  console.error("[main] Fatal error:", err);
  process.exit(1);
});
