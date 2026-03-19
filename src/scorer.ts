import fs from "fs";
import path from "path";
import { writeFileAtomic } from "./utils.js";
import type { Job } from "./sources/types.js";

const SCORES_FILE = path.join(process.cwd(), "match_scores.json");

export interface ScoreEntry {
  score: number;
  reason: string;
  missingKeywords?: string;
  rewrites?: string[];
}

const scoreCache = new Map<string, ScoreEntry>();

export class OllamaUnavailableError extends Error {
  constructor() {
    super("Ollama is not running or unreachable at http://127.0.0.1:11434");
    this.name = "OllamaUnavailableError";
  }
}

export function loadScores(): void {
  try {
    const data = JSON.parse(fs.readFileSync(SCORES_FILE, "utf8")) as Record<string, ScoreEntry | number>;
    for (const [k, v] of Object.entries(data)) {
      // backward compat: old files stored plain numbers
      if (typeof v === "number") {
        scoreCache.set(k, { score: v, reason: "" });
      } else {
        scoreCache.set(k, v);
      }
    }
    console.log(`[scorer] Loaded ${scoreCache.size} cached match scores`);
  } catch {
    // ignore missing or corrupt cache
  }
}

export function getScore(stateKey: string): ScoreEntry | undefined {
  return scoreCache.get(stateKey);
}

export function getAllScores(): Record<string, ScoreEntry> {
  return Object.fromEntries(scoreCache);
}

async function fetchJobDescription(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; job-match-scorer/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 5000);
  } catch {
    return null;
  }
}

export async function scoreJob(
  job: Job,
  resumePath: string,
  ollamaModel = "llama3"
): Promise<ScoreEntry> {
  if (scoreCache.has(job.stateKey)) {
    return scoreCache.get(job.stateKey)!;
  }

  const resolvedResumePath = path.resolve(process.cwd(), resumePath);
  if (!fs.existsSync(resolvedResumePath)) {
    throw new Error(`Resume file not found: ${resolvedResumePath}`);
  }
  const resumeContent = fs.readFileSync(resolvedResumePath, "utf-8");

  const salaryLine = job.salary ? `Salary: ${job.salary}\n` : "";
  const locationLine = job.location ? `Location: ${job.location}\n` : "";
  const requirementsLine = job.qualifications
    ? `Requirements: ${job.qualifications}`
    : "Requirements: No structured requirements extracted.";

  const fullDescription = await fetchJobDescription(job.url);

  const prompt = `You are an ATS and recruiting expert. Review my resume against this job description.

IMPORTANT: When a requirement lists alternatives ("X or Y", "one of X / Y / Z",
"X / Y / Z", "BS/MS/PhD"), treat it as ONE requirement. It is MET if the resume
satisfies ANY of the alternatives. Do NOT penalise for unmatched alternatives.
Example: "Java / TypeScript / C# / Python / Go" — if resume shows Go, requirement is MET.
Example: "BS/MS/PhD in CS or equivalent experience" — if resume shows a BS, requirement is MET.

Score the match 0–100 (be strict and calibrated):
- 80–100: resume meets nearly all required AND preferred qualifications, including domain experience
- 60–79: resume meets most required qualifications but lacks preferred ones or relevant domain experience
- 40–59: resume meets some required qualifications but has notable gaps
- 0–39: resume is missing core required qualifications

Most candidates score 40–65. Only award 70+ if the resume is a genuinely strong fit.

Suggest 3 specific resume bullet rewrites to improve my chances.

RESUME
${resumeContent}

JOB POSTING
Title: ${job.title}
Company: ${job.company}
${salaryLine}${locationLine}${requirementsLine}
${fullDescription ? `\nFULL DESCRIPTION\n${fullDescription}\n` : ""}
Respond in exactly this format:
Missing keywords: <comma-separated list, or "None">
Score: <integer 0-100>
Reason: <one sentence naming the single biggest gap>
Rewrite 1: <improved bullet point>
Rewrite 2: <improved bullet point>
Rewrite 3: <improved bullet point>`;

  let response: Response;
  try {
    response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        prompt,
        stream: false,
        options: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
      ?? ((err as { cause?: NodeJS.ErrnoException }).cause)?.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND") {
      throw new OllamaUnavailableError();
    }
    throw err;
  }

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { response: string };
  const rawText = data.response ?? "";

  const scoreMatch = rawText.match(/Score:\s*(\d+)/i);
  if (!scoreMatch) {
    throw new Error(`Could not parse score from Ollama response: ${rawText}`);
  }

  const score = Math.min(100, Math.max(0, parseInt(scoreMatch[1], 10)));
  const reasonMatch = rawText.match(/Reason:\s*(.+)/i);
  const reason = reasonMatch ? reasonMatch[1].trim() : "";
  const missingMatch = rawText.match(/Missing keywords:\s*(.+)/i);
  const rewrite1 = rawText.match(/Rewrite 1:\s*(.+)/i);
  const rewrite2 = rawText.match(/Rewrite 2:\s*(.+)/i);
  const rewrite3 = rawText.match(/Rewrite 3:\s*(.+)/i);

  const rewrites = [rewrite1, rewrite2, rewrite3]
    .map(m => m?.[1].trim())
    .filter(Boolean) as string[];

  const entry: ScoreEntry = {
    score,
    reason,
    missingKeywords: missingMatch?.[1].trim(),
    rewrites: rewrites.length ? rewrites : undefined,
  };
  scoreCache.set(job.stateKey, entry);
  writeFileAtomic(SCORES_FILE, JSON.stringify(Object.fromEntries(scoreCache), null, 2));

  return entry;
}
