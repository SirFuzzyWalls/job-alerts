import fs from "fs";
import path from "path";
import readline from "readline";
import { loadRegistry } from "../src/registry.js";
import type { CompanyConfig } from "../src/config.js";
import type { BoardEntry } from "../src/registry.js";
import { probeBoard } from "./prober.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function toTitleCase(s: string): string {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ── URL parsing ───────────────────────────────────────────────────────────────

type ParsedURL = CompanyConfig;

/** Extract careerSite path segment from a myworkdayjobs.com URL string. */
function workdayCareerSiteFromPath(url: string): string | null {
  const m = url.match(/myworkdayjobs\.com\/(?:[^/]+\/)?([^/?#]+)/);
  return m?.[1] ?? null;
}

async function parseURL(url: string): Promise<ParsedURL | null> {
  // Greenhouse
  const gh = url.match(/^https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)/);
  if (gh) return { source: "greenhouse", slug: gh[1] };

  // Lever
  const lv = url.match(/^https?:\/\/jobs\.lever\.co\/([^/?#]+)/);
  if (lv) return { source: "lever", slug: lv[1] };

  // Ashby
  const ab = url.match(/^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ab) return { source: "ashby", slug: ab[1] };

  // Workday (myworkdayjobs.com): https://{company}.{subdomain}.myworkdayjobs.com/[{locale}/]{careerSite}
  const wdBase = url.match(/^https?:\/\/([^.]+)\.([^.]+)\.myworkdayjobs\.com/);
  if (wdBase) {
    const company = wdBase[1];
    const subdomain = wdBase[2];
    let careerSite = workdayCareerSiteFromPath(url);
    if (!careerSite) {
      // No careerSite in URL — follow redirect to discover it
      process.stdout.write("No careerSite in URL, following redirect to discover it...");
      try {
        const res = await fetch(url);
        careerSite = workdayCareerSiteFromPath(res.url);
      } catch { /* fall through */ }
      process.stdout.write(careerSite ? ` found: ${careerSite}\n` : " failed\n");
    }
    if (!careerSite) return null;
    return { source: "workday", company, subdomain, careerSite };
  }

  // Workday (myworkdaysite.com): https://{subdomain}.myworkdaysite.com/recruiting/{company}/{careerSite}
  const wds = url.match(/^https?:\/\/([^.]+)\.myworkdaysite\.com\/recruiting\/([^/]+)\/([^/?#]+)/);
  if (wds) return { source: "workday", subdomain: wds[1], company: wds[2], careerSite: wds[3], baseUrl: `https://${wds[1]}.myworkdaysite.com` };

  return null;
}

function describeParsed(p: ParsedURL): string {
  if (p.source === "workday")
    return `source=workday  company=${p.company}  subdomain=${p.subdomain}  careerSite=${p.careerSite}`;
  return `source=${p.source}  slug=${p.slug}`;
}

function isDuplicate(parsed: ParsedURL, registry: ReturnType<typeof loadRegistry>): BoardEntry | undefined {
  return registry.find(e => {
    if (e.source !== parsed.source) return false;
    if (parsed.source === "workday" && e.source === "workday")
      return e.company === parsed.company && e.careerSite === parsed.careerSite;
    if ("slug" in parsed && "slug" in e)
      return e.slug === parsed.slug;
    return false;
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npm run probe -- <url>\n");
    console.error("Examples:");
    console.error("  npm run probe -- https://boards.greenhouse.io/stripe");
    console.error("  npm run probe -- https://jobs.lever.co/palantir");
    console.error("  npm run probe -- https://jobs.ashbyhq.com/ramp");
    console.error("  npm run probe -- https://dell.wd1.myworkdayjobs.com/en-US/External");
    process.exit(1);
  }

  // 1. Parse URL
  const isWorkdayDomain = /myworkdayjobs\.com/i.test(url);
  const parsed = await parseURL(url);
  if (!parsed) {
    if (isWorkdayDomain) {
      console.error(`Could not determine Workday careerSite from URL: ${url}`);
      console.error("Try navigating to the careers page and copying the full URL once jobs are loaded,");
      console.error("e.g. https://ghr.wd1.myworkdayjobs.com/en-US/GHR");
    } else {
      console.error(`Unrecognized URL format: ${url}\n`);
      console.error("Supported formats:");
      console.error("  Greenhouse: https://boards.greenhouse.io/{slug}");
      console.error("              https://job-boards.greenhouse.io/{slug}");
      console.error("  Lever:      https://jobs.lever.co/{slug}");
      console.error("  Ashby:      https://jobs.ashbyhq.com/{slug}");
      console.error("  Workday:    https://{company}.{subdomain}.myworkdayjobs.com/[{locale}/]{careerSite}");
      console.error("              https://{subdomain}.myworkdaysite.com/recruiting/{company}/{careerSite}");
    }
    process.exit(1);
  }

  console.log(`\nDetected: ${describeParsed(parsed)}`);

  // 2. Check for duplicates
  const registry = loadRegistry();
  const existing = isDuplicate(parsed, registry);
  if (existing) {
    console.warn(`\nWarning: this board already exists in boards.json:`);
    console.warn(`  ${JSON.stringify(existing)}`);
    const ans = await prompt("Update existing entry? [y/N] ");
    if (ans.toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  // 3. Probe the board
  console.log("\nProbing board...");
  const probeEntry: BoardEntry = { id: "_probe_", name: "_probe_", ...parsed };
  const result = await probeBoard(probeEntry);

  if (result.ok) {
    console.log(`Found ${result.count} jobs. Sample titles:`);
    for (const t of result.samples) console.log(`  - ${t}`);
  } else {
    console.warn(`\nWarning: ${result.error}`);
    const ans = await prompt("Proceed anyway? [y/N] ");
    if (ans.toLowerCase() !== "y") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  // 4. Suggest display name
  const suggestion =
    parsed.source === "workday"
      ? toTitleCase(parsed.company)
      : toTitleCase((parsed as { slug: string }).slug);

  const nameInput = await prompt(`\nCompany name? [${suggestion}]: `);
  const name = nameInput || suggestion;

  // 5. Generate ID
  const id = toId(name);
  const idConflict = registry.find(e => e.id === id && !existing);
  if (idConflict) {
    console.warn(`\nWarning: ID "${id}" already exists for a different entry: ${JSON.stringify(idConflict)}`);
  }

  // 6. Confirm add
  const newEntry = { id, name, ...parsed };
  console.log(`\nNew entry: ${JSON.stringify(newEntry)}`);
  const confirm = await prompt("Add to boards.json? [y/N] ");
  if (confirm.toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(0);
  }

  // 7. Pre-validate
  const boardsPath = path.resolve(process.cwd(), "boards.json");
  const pre = loadRegistry();
  if (!Array.isArray(pre)) {
    console.error("boards.json validation failed before write — aborting.");
    process.exit(1);
  }

  // 8. Append preserving formatting
  const raw = fs.readFileSync(boardsPath, "utf-8");
  const lastBrace = raw.lastIndexOf("}");
  const updated = raw.slice(0, lastBrace + 1) + ",\n  " + JSON.stringify(newEntry) + raw.slice(lastBrace + 1);
  fs.writeFileSync(boardsPath, updated);

  // 9. Post-validate
  const post = loadRegistry();
  const added = post.find(e => e.id === id);
  if (!added) {
    console.error("Post-write validation failed — entry not found. boards.json may be corrupted.");
    process.exit(1);
  }

  console.log(`\nSuccess! "${name}" (${id}) added to boards.json.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
