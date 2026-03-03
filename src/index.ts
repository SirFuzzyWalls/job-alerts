import cron from "node-cron";
import { loadConfig } from "./config.js";
import { fetchAllJobs } from "./sources/index.js";
import { matchesTitle, matchesSalary, matchesLocation } from "./matcher.js";
import { loadState, pruneState, saveState } from "./state.js";
import { sendDigest } from "./notifier.js";

const onceMode = process.argv.includes("--once");
const dryRunMode = process.argv.includes("--dry-run");

async function runDryRun(): Promise<void> {
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

  const matched = allJobs.filter(
    (job) =>
      matchesTitle(job.title, config.jobTitles) &&
      matchesSalary(job.salaryMin, job.salaryMax, config.minSalary, config.maxSalary, config.sendIfNoSalary) &&
      matchesLocation(job.location, config.locations, config.sendIfNoLocation)
  );
  console.log(`\n[dry-run] Total fetched: ${allJobs.length} | Title matches: ${matched.length}`);

  if (matched.length > 0) {
    console.log("[dry-run] Matched jobs:");
    for (const job of matched) {
      const salaryStr = job.salary ? ` | ${job.salary}` : "";
      console.log(`  · ${job.title} @ ${job.company}${salaryStr} — ${job.url}`);
    }
  }

  console.log("\n[dry-run] Done. No email sent, no state changed.");
}

async function runCheck(): Promise<void> {
  const config = loadConfig();
  const { seen: rawSeen, isFirstRun } = loadState();
  const seen = pruneState(rawSeen, config.stateRetentionDays);

  console.log(
    `[check] Fetching jobs for: ${config.jobTitles.join(", ")} …`
  );

  const allJobs = await fetchAllJobs(config);
  console.log(`[check] Total jobs fetched: ${allJobs.length}`);

  const matches = allJobs.filter(
    (job) =>
      matchesTitle(job.title, config.jobTitles) &&
      matchesSalary(job.salaryMin, job.salaryMax, config.minSalary, config.maxSalary, config.sendIfNoSalary) &&
      matchesLocation(job.location, config.locations, config.sendIfNoLocation)
  );

  if (isFirstRun) {
    const now = Date.now();
    for (const job of matches) {
      seen[job.stateKey] = now;
    }
    saveState(seen);
    console.log(
      `[check] First run — seeded ${matches.length} matching job(s) as seen. No email sent.`
    );
    console.log(
      "[check] Future runs will only email genuinely new postings."
    );
    return;
  }

  const newMatches = matches.filter((job) => !seen[job.stateKey]);

  console.log(`[check] New matches: ${newMatches.length}`);

  if (newMatches.length === 0) {
    console.log("[check] Nothing new — no email sent.");
    return;
  }

  try {
    await sendDigest(newMatches, config.jobTitles, config.email);
  } catch (err) {
    console.error("[check] Failed to send email:", err);
    // Don't mark jobs as seen if the email failed
    return;
  }

  const now = Date.now();
  for (const job of newMatches) {
    seen[job.stateKey] = now;
  }
  saveState(seen);

  console.log(
    `[check] Marked ${newMatches.length} job(s) as seen. State saved.`
  );
}

async function main(): Promise<void> {
  if (dryRunMode) {
    await runDryRun();
    return;
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
