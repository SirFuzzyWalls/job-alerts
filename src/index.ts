import cron from "node-cron";
import { loadConfig } from "./config.js";
import { fetchAllJobs } from "./sources/index.js";
import { matchesTitle } from "./matcher.js";
import { loadState, saveState } from "./state.js";
import { sendDigest } from "./notifier.js";

const onceMode = process.argv.includes("--once");

async function runCheck(): Promise<void> {
  const config = loadConfig();
  const seen = loadState();

  console.log(
    `[check] Fetching jobs for: ${config.jobTitles.join(", ")} …`
  );

  const allJobs = await fetchAllJobs(config);
  console.log(`[check] Total jobs fetched: ${allJobs.length}`);

  const newMatches = allJobs.filter(
    (job) =>
      matchesTitle(job.title, config.jobTitles) && !seen[job.stateKey]
  );

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

  for (const job of newMatches) {
    seen[job.stateKey] = true;
  }
  saveState(seen);

  console.log(
    `[check] Marked ${newMatches.length} job(s) as seen. State saved.`
  );
}

async function main(): Promise<void> {
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
