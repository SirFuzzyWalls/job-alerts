import nodemailer from "nodemailer";
import type { EmailConfig } from "./config.js";
import type { Job } from "./sources/types.js";

function buildEmailBody(jobs: Job[], jobTitles: string[]): string {
  const lines: string[] = [
    `New job postings matching your alerts (${jobTitles.join(", ")}):`,
    "",
  ];

  for (const job of jobs) {
    lines.push(`• ${job.title} @ ${job.company} (${job.source})`);
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
