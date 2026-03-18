import fs from "fs";
import path from "path";
import { writeFileAtomic } from "./utils.js";
import type { JobRecord } from "./history.js";

const SCORES_FILE = path.join(process.cwd(), "match_scores.json");

export interface ScoreEntry {
  score: number;
  reason: string;
  hardMet?: string;
  hardMissing?: string;
  preferredMissing?: string;
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
    if (fs.existsSync(SCORES_FILE)) {
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
    }
  } catch {
    // ignore corrupt cache
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
  job: JobRecord,
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

  const prompt = `You are a strict ATS keyword-matching system.
Your job is to find GAPS between the resume and job requirements.

STEP 1 — Parse requirements. For each requirement that lists alternatives
("X or Y", "one of X / Y / Z", "experience in X, Y, or Z"), collapse it into
a single requirement. A collapsed requirement is MET if the resume matches ANY
one alternative. Never list unmatched alternatives as separate missing items.

Example: "Java / TypeScript / C# / Python / Go" → one requirement "Backend language
(Java/TS/C#/Python/Go)". If resume shows Go, mark it MET. Do not list Java,
TypeScript, or C# as missing.

STEP 2 — Score. Start at 100.
Subtract 15 for each hard requirement that is fully unmet (no alternative matched).
Subtract 5 for each preferred qualification that is fully unmet.

RESUME
${resumeContent}

JOB POSTING
Title: ${job.title}
Company: ${job.company}
${salaryLine}${locationLine}${requirementsLine}
${fullDescription ? `\nFULL DESCRIPTION\n${fullDescription}\n` : ""}
Respond in exactly this format:
Hard requirements met: <comma-separated list>
Hard requirements MISSING: <comma-separated list>
Preferred qualifications MISSING: <comma-separated list>
Score: <integer 0-100>
Reason: <one sentence naming the single biggest gap>`;

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
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
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
  const hardMetMatch = rawText.match(/Hard requirements met:\s*(.+)/i);
  const hardMissingMatch = rawText.match(/Hard requirements MISSING:\s*(.+)/i);
  const preferredMissingMatch = rawText.match(/Preferred qualifications MISSING:\s*(.+)/i);

  const entry: ScoreEntry = {
    score,
    reason,
    hardMet: hardMetMatch ? hardMetMatch[1].trim() : undefined,
    hardMissing: hardMissingMatch ? hardMissingMatch[1].trim() : undefined,
    preferredMissing: preferredMissingMatch ? preferredMissingMatch[1].trim() : undefined,
  };
  scoreCache.set(job.stateKey, entry);
  writeFileAtomic(SCORES_FILE, JSON.stringify(Object.fromEntries(scoreCache), null, 2));

  return entry;
}
