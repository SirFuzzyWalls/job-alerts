import nodemailer from "nodemailer";
import type { EmailConfig } from "./config.js";
import type { Job } from "./sources/types.js";

function formatCheckDelta(lastCheckAt: number | undefined, intervalMinutes: number | undefined, now: Date): string {
  const ms = lastCheckAt !== undefined
    ? now.getTime() - lastCheckAt
    : (intervalMinutes ?? 30) * 60_000;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.round(ms / 3_600_000);
  return `~${hours} hr`;
}

function timeAgo(postedAt: string, now: Date, lastCheckAt?: number, intervalMinutes?: number): string {
  const d = new Date(postedAt);
  if (isNaN(d.getTime())) {
    return `est. posted within last ${formatCheckDelta(lastCheckAt, intervalMinutes, now)}`;
  }
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays <= 0) {
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 1) return "today, just now";
    if (diffMins < 60) return `today, ${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `today, ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  if (diffDays === 1) return "yesterday";
  return `${diffDays} days ago`;
}

function sortedByDate(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => {
    const da = a.postedAt ? new Date(a.postedAt) : null;
    const db = b.postedAt ? new Date(b.postedAt) : null;
    const va = da !== null && !isNaN(da.getTime());
    const vb = db !== null && !isNaN(db.getTime());
    if (va && vb) return db!.getTime() - da!.getTime();
    if (va) return -1;
    if (vb) return 1;
    return 0;
  });
}

export function buildEmailBody(jobs: Job[], jobTitles: string[], locations?: string[], lastCheckAt?: number, intervalMinutes?: number): string {
  const now = new Date();
  const lines: string[] = [
    `New job postings matching your alerts (${jobTitles.join(", ")}):`,
  ];
  if (locations && locations.length > 0) {
    lines.push(`Locations: ${locations.join(", ")}`);
  }
  lines.push("");

  for (const job of sortedByDate(jobs)) {
    const when = job.postedAt ? ` — ${timeAgo(job.postedAt, now, lastCheckAt, intervalMinutes)}` : "";
    lines.push(`• ${job.title} @ ${job.company} (${job.source})${when}`);
    if (job.salary) lines.push(`  ${job.salary}`);
    if (job.qualifications) lines.push(`  ${job.qualifications}`);
    if (job.location) lines.push(`  ${job.location}`);
    lines.push(`  ${job.url}`);
    lines.push("");
  }

  return lines.join("\n");
}

function buildSubject(jobs: Job[], jobTitles: string[]): string {
  const count = jobs.length;
  const titlesLabel = jobTitles.join(", ");
  return `[Job Alert] ${count} new match${count === 1 ? "" : "es"} — ${titlesLabel}`;
}

export async function sendDigest(
  jobs: Job[],
  jobTitles: string[],
  emailConfig: EmailConfig,
  locations?: string[],
  lastCheckAt?: number,
  intervalMinutes?: number,
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: emailConfig.smtp.host,
    port: emailConfig.smtp.port,
    secure: emailConfig.smtp.port === 465,
    auth: {
      user: emailConfig.smtp.user,
      pass: emailConfig.smtp.pass,
    },
  });

  const subject = buildSubject(jobs, jobTitles);
  const text = buildEmailBody(jobs, jobTitles, locations, lastCheckAt, intervalMinutes);

  await transporter.sendMail({
    from: emailConfig.from,
    to: emailConfig.to,
    subject,
    text,
  });

  console.log(`[notifier] Email sent: "${subject}"`);
}
