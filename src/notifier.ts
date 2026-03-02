import nodemailer from "nodemailer";
import type { EmailConfig } from "./config.js";
import type { Job } from "./sources/types.js";

function timeAgo(postedAt: string, now: Date): string {
  const d = new Date(postedAt);
  if (isNaN(d.getTime())) return postedAt; // Workday raw string e.g. "Posted 2 Days Ago"
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

function buildEmailBody(jobs: Job[], jobTitles: string[]): string {
  const now = new Date();
  const lines: string[] = [
    `New job postings matching your alerts (${jobTitles.join(", ")}):`,
    "",
  ];

  for (const job of sortedByDate(jobs)) {
    const when = job.postedAt ? ` — ${timeAgo(job.postedAt, now)}` : "";
    lines.push(`• ${job.title} @ ${job.company} (${job.source})${when}`);
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
  emailConfig: EmailConfig
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
  const text = buildEmailBody(jobs, jobTitles);

  await transporter.sendMail({
    from: emailConfig.from,
    to: emailConfig.to,
    subject,
    text,
  });

  console.log(`[notifier] Email sent: "${subject}"`);
}
