import http from "http";
import path from "path";
import fs from "fs";
import { loadHistory, setHistoryChangeListener } from "./history.js";
import { loadConfig } from "./config.js";
import type { Config } from "./config.js";
import { scoreJob, loadScores, getAllScores, OllamaUnavailableError } from "./scorer.js";
import { getAllApplications, setApplication, loadApplications } from "./applications.js";
import type { ApplicationStatus } from "./applications.js";

const PORT = parseInt(process.env.PORT ?? "3737", 10);

let cachedConfig: Config | null = null;
function getConfig(): Config {
  if (!cachedConfig) cachedConfig = loadConfig();
  return cachedConfig;
}

let historyCache: ReturnType<typeof loadHistory> | null = null;
function getCachedHistory() {
  if (!historyCache) historyCache = loadHistory();
  return historyCache;
}

const SOURCE_COLORS: Record<string, string> = {
  greenhouse: "#2ea043",
  lever: "#d4680a",
  ashby: "#8957e5",
  workday: "#1f6feb",
  "hacker news": "#e05d4b",
  usajobs: "#1a9e8f",
};

function getBadgeColor(source: string): string {
  return SOURCE_COLORS[source.toLowerCase()] ?? "#6e7681";
}

// --- Bulk scoring state ---

interface BulkScoreState {
  total: number;
  scored: number;
  done: boolean;
  errors: number;
}
let bulkScoreState: BulkScoreState | null = null;
let bulkScoreRunning = false;

async function startBulkScore(config: Config): Promise<void> {
  if (bulkScoreRunning || !config.resumePath) return;
  bulkScoreRunning = true;
  const history = getCachedHistory();
  const scores = getAllScores();
  const unscored = history.filter(j => !scores[j.stateKey]);
  bulkScoreState = { total: unscored.length, scored: 0, done: false, errors: 0 };

  (async () => {
    for (const job of unscored) {
      try {
        await scoreJob(job, config.resumePath!, config.ollamaModel);
        bulkScoreState!.scored++;
      } catch (err) {
        if (err instanceof OllamaUnavailableError) break;
        bulkScoreState!.errors++;
      }
    }
    bulkScoreState!.done = true;
    bulkScoreRunning = false;
  })().catch(() => {
    if (bulkScoreState) bulkScoreState.done = true;
    bulkScoreRunning = false;
  });
}

// --- Geocoding ---

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
}

interface MapJob {
  lat: number;
  lng: number;
  title: string;
  company: string;
  url: string;
  salary?: string;
  postedAt?: string;
  sentAt: number;
}

const GEOCODE_CACHE_FILE = path.join(process.cwd(), "geocode_cache.json");
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

function loadGeocodeCache(): void {
  try {
    if (fs.existsSync(GEOCODE_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(GEOCODE_CACHE_FILE, "utf8")) as Record<string, { lat: number; lng: number } | null>;
      for (const [k, v] of Object.entries(data)) {
        geocodeCache.set(k, v);
      }
      console.log(`[dashboard] Loaded ${geocodeCache.size} cached geocode entries`);
    }
  } catch {
    // ignore corrupt cache
  }
}

function saveGeocodeCache(): void {
  try {
    fs.writeFileSync(GEOCODE_CACHE_FILE, JSON.stringify(Object.fromEntries(geocodeCache), null, 2));
  } catch {
    // ignore write errors
  }
}

function normalizeLocation(raw: string): string | null {
  let loc = raw.trim();
  loc = loc.split("|")[0].split(";")[0].split("~")[0].trim();
  if (!loc) return null;
  if (/remote|work from home|worldwide|anywhere|flexible/i.test(loc)) return null;
  return loc;
}

async function geocode(raw: string): Promise<{ lat: number; lng: number } | null> {
  const location = normalizeLocation(raw);
  if (!location) return null;
  if (geocodeCache.has(location)) return geocodeCache.get(location)!;

  await new Promise(r => setTimeout(r, 1000)); // rate-limit only on real API calls
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "job-alerts-dashboard/1.0" }, signal: AbortSignal.timeout(8_000) });
    const data = await res.json() as NominatimResult[];
    const result = data[0] ? { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) } : null;
    geocodeCache.set(location, result);
    saveGeocodeCache();
    return result;
  } catch {
    return null;
  }
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Job Alert Dashboard</title>
<style>
  :root {
    --bg: #f6f8fa;
    --surface: #ffffff;
    --card: #ffffff;
    --border: #d0d7de;
    --text: #1f2328;
    --muted: #57606a;
    --accent: #0969da;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0d1117;
      --surface: #161b22;
      --card: #1c2128;
      --border: #30363d;
      --text: #e6edf3;
      --muted: #8b949e;
      --accent: #58a6ff;
    }
  }
  [data-theme="dark"] {
    --bg: #0d1117;
    --surface: #161b22;
    --card: #1c2128;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --accent: #58a6ff;
  }
  [data-theme="light"] {
    --bg: #f6f8fa;
    --surface: #ffffff;
    --card: #ffffff;
    --border: #d0d7de;
    --text: #1f2328;
    --muted: #57606a;
    --accent: #0969da;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; }

  header {
    position: sticky; top: 0; z-index: 10;
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 0.75rem 1.5rem;
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  }
  header h1 { font-size: 1.125rem; font-weight: 600; }
  .header-actions { display: flex; align-items: center; gap: 0.5rem; }
  .theme-btn, .export-btn {
    background: none; border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 0.35rem 0.75rem; cursor: pointer; font-size: 0.875rem;
    text-decoration: none; display: inline-block;
  }
  .theme-btn:hover, .export-btn:hover { background: var(--border); }

  /* Tabs */
  .tab-bar { display: flex; gap: 0.25rem; }
  .tab-btn {
    background: none; border: 1px solid var(--border); color: var(--muted);
    border-radius: 6px; padding: 0.35rem 0.75rem; cursor: pointer; font-size: 0.875rem;
  }
  .tab-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .tab-btn:hover:not(.active) { background: var(--border); color: var(--text); }

  /* Jobs panel */
  #jobs-panel.hidden { display: none; }

  .controls {
    display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;
    padding: 0.75rem 1.5rem;
    background: var(--surface); border-bottom: 1px solid var(--border);
  }
  .controls label { font-size: 0.875rem; color: var(--muted); }
  select {
    background: var(--card); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.3rem 0.5rem; font-size: 0.875rem; cursor: pointer;
  }

  /* Filter bar */
  .filter-bar {
    display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
    padding: 0.6rem 1.5rem;
    background: var(--surface); border-bottom: 1px solid var(--border);
  }
  .search-input {
    background: var(--card); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.3rem 0.65rem; font-size: 0.875rem; outline: none;
    min-width: 200px; flex: 1;
  }
  .search-input:focus { border-color: var(--accent); }
  .filter-bar label { font-size: 0.8rem; color: var(--muted); white-space: nowrap; }
  .filter-bar select { font-size: 0.8rem; }
  .clear-filters-btn {
    background: none; border: 1px solid var(--border); color: var(--muted);
    border-radius: 6px; padding: 0.25rem 0.6rem; font-size: 0.8rem; cursor: pointer;
    white-space: nowrap;
  }
  .clear-filters-btn:hover { background: var(--border); color: var(--text); }
  input[type="range"] { accent-color: var(--accent); cursor: pointer; }
  .score-threshold-label { font-size: 0.8rem; color: var(--muted); white-space: nowrap; }
  input[type="date"] {
    background: var(--card); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.3rem 0.5rem; font-size: 0.8rem; cursor: pointer;
  }

  .pagination { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }
  .page-info { font-size: 0.875rem; color: var(--muted); white-space: nowrap; }
  .page-btn {
    background: var(--card); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.3rem 0.65rem; cursor: pointer; font-size: 0.875rem;
  }
  .page-btn:hover:not(:disabled) { background: var(--accent); color: #fff; border-color: var(--accent); }
  .page-btn:disabled { opacity: 0.4; cursor: default; }

  /* Bulk score controls */
  .bulk-score-area { display: flex; align-items: center; gap: 0.5rem; }
  .bulk-score-btn {
    background: none; border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 0.3rem 0.65rem; cursor: pointer; font-size: 0.875rem;
    white-space: nowrap;
  }
  .bulk-score-btn:hover:not(:disabled) { background: var(--border); }
  .bulk-score-btn:disabled { opacity: 0.5; cursor: default; }
  .bulk-progress { font-size: 0.8rem; color: var(--muted); white-space: nowrap; }

  main { padding: 1.5rem; }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }
  @media (max-width: 1199px) { .grid { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 767px) { .grid { grid-template-columns: 1fr; } }

  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 10px;
    padding: 1.125rem; display: flex; flex-direction: column; gap: 0.5rem;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  .card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.15); }

  .card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
  .card-title { font-size: 1rem; font-weight: 600; line-height: 1.35; }
  .badge {
    display: inline-block; border-radius: 999px;
    padding: 0.2rem 0.6rem; font-size: 0.7rem; font-weight: 600;
    color: #fff; white-space: nowrap; flex-shrink: 0;
  }
  .card-company { font-size: 0.9rem; color: var(--muted); font-weight: 500; }
  .card-meta { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; font-size: 0.8rem; color: var(--muted); }
  .meta-item { display: flex; align-items: center; gap: 0.25rem; }

  .card-footer { margin-top: auto; display: flex; align-items: center; justify-content: space-between; padding-top: 0.5rem; border-top: 1px solid var(--border); gap: 0.5rem; flex-wrap: wrap; }
  .alerted-text { font-size: 0.75rem; color: var(--muted); }
  .card-actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .view-btn {
    background: var(--accent); color: #fff; border: none; border-radius: 6px;
    padding: 0.4rem 0.8rem; font-size: 0.8rem; font-weight: 500; cursor: pointer;
    text-decoration: none; display: inline-block;
  }
  .view-btn:hover { opacity: 0.85; }

  .status-select {
    background: var(--card); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.25rem 0.4rem; font-size: 0.75rem; cursor: pointer;
  }

  .score-badge {
    display: inline-flex; align-items: center;
    border-radius: 999px; padding: 0.2rem 0.6rem;
    font-size: 0.75rem; font-weight: 700; color: #fff; white-space: nowrap;
  }
  .score-badge.green  { background: #2ea043; }
  .score-badge.amber  { background: #d4680a; }
  .score-badge.red    { background: #b91c1c; }
  .score-badge.error  { background: #57606a; font-style: italic; }
  .score-badge[data-statekey] { cursor: pointer; }
  .match-btn {
    background: none; border: 1px solid var(--border); color: var(--muted);
    border-radius: 6px; padding: 0.35rem 0.65rem; font-size: 0.75rem; cursor: pointer;
  }
  .match-btn:hover:not(:disabled) { background: var(--border); color: var(--text); }
  .match-btn:disabled { opacity: 0.5; cursor: default; }
  #score-popover {
    display: none; position: fixed; z-index: 100;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 0.6rem 0.85rem;
    font-size: 0.8rem; color: var(--text); max-width: 260px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2); line-height: 1.4;
  }
  #score-popover.visible { display: block; }

  .empty-state {
    text-align: center; padding: 4rem 2rem; color: var(--muted);
  }
  .empty-state h2 { font-size: 1.25rem; margin-bottom: 0.5rem; color: var(--text); }
  .empty-state p { font-size: 0.9rem; }

  #status { padding: 1rem 1.5rem; color: var(--muted); font-size: 0.9rem; }

  #new-jobs-banner {
    display: none;
    position: sticky; top: 57px; z-index: 9;
    background: var(--accent); color: #fff;
    padding: 0.6rem 1.5rem;
    display: none; align-items: center; justify-content: space-between; gap: 1rem;
    font-size: 0.875rem; font-weight: 500;
  }
  #new-jobs-banner.visible { display: flex; }
  #new-jobs-banner.removed { background: var(--muted); }
  #new-jobs-banner button {
    background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4);
    color: #fff; border-radius: 6px; padding: 0.25rem 0.65rem;
    cursor: pointer; font-size: 0.8rem;
  }
  #new-jobs-banner button:hover { background: rgba(255,255,255,0.35); }
  .banner-actions { display: flex; gap: 0.5rem; }

  /* Map panel */
  #map-panel { display: none; flex-direction: column; height: calc(100vh - 57px); overflow: hidden; }
  #map-panel.visible { display: flex; }
  .map-toolbar {
    padding: 0.75rem 1.5rem; flex-shrink: 0;
    background: var(--surface); border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
  }
  .map-toolbar button {
    background: var(--card); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.3rem 0.65rem; font-size: 0.875rem; cursor: pointer;
  }
  .map-toolbar button:hover { background: var(--border); }
  .map-toolbar input[type="text"] {
    background: var(--card); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.3rem 0.65rem; font-size: 0.875rem; outline: none;
    min-width: 180px;
  }
  .map-note { font-size: 0.8rem; color: var(--muted); margin-left: auto; }
  #map { flex: 1; min-height: 0; }
</style>
</head>
<body>
<header>
  <h1>Job Alert Dashboard</h1>
  <div class="tab-bar">
    <button class="tab-btn active" id="tabJobs">Jobs</button>
    <button class="tab-btn" id="tabMap">Map</button>
  </div>
  <div class="header-actions">
    <a class="export-btn" href="/api/export.csv" download="jobs.csv">Export CSV</a>
    <button class="theme-btn" id="themeToggle">Toggle theme</button>
  </div>
</header>
<div id="jobs-panel">
  <div class="filter-bar">
    <input type="search" class="search-input" id="searchInput" placeholder="Search jobs, companies, locations&hellip;">
    <label>Source:
      <select id="sourceFilter">
        <option value="">All sources</option>
        <option value="greenhouse">Greenhouse</option>
        <option value="lever">Lever</option>
        <option value="ashby">Ashby</option>
        <option value="workday">Workday</option>
        <option value="usajobs">USAJobs</option>
        <option value="hacker news">Hacker News</option>
      </select>
    </label>
    <label>Status:
      <select id="statusFilter">
        <option value="">All statuses</option>
        <option value="none">No status</option>
        <option value="interested">Interested</option>
        <option value="applied">Applied</option>
        <option value="interview">Interview</option>
        <option value="offer">Offer</option>
        <option value="rejected">Rejected</option>
      </select>
    </label>
    <label style="display:flex;align-items:center;gap:0.35rem">
      <input type="checkbox" id="hasScoreFilter"> Has score
    </label>
    <label class="score-threshold-label">
      Min score: <span id="minScoreVal">0</span>
      <input type="range" id="minScoreRange" min="0" max="100" step="5" value="0" style="width:80px;margin-left:0.35rem">
    </label>
    <label>From: <input type="date" id="dateFrom"></label>
    <label>To: <input type="date" id="dateTo"></label>
    <button class="clear-filters-btn" id="clearFilters">Clear filters</button>
  </div>
  <div class="controls">
    <label>
      Per page:
      <select id="pageSizeSelect">
        <option value="10">10</option>
        <option value="30">30</option>
        <option value="50">50</option>
      </select>
    </label>
    <label>
      Sort:
      <select id="sortSelect">
        <option value="newest">Newest first</option>
        <option value="salary-desc">Salary: High to Low</option>
        <option value="salary-asc">Salary: Low to High</option>
      </select>
    </label>
    <label>
      <input type="checkbox" id="salaryOnly"> Salary only
    </label>
    <div class="bulk-score-area">
      <button class="bulk-score-btn" id="bulkScoreBtn">Score all unscored</button>
      <span class="bulk-progress" id="bulkProgress"></span>
    </div>
    <div class="pagination">
      <span class="page-info" id="pageInfo">—</span>
      <button class="page-btn" id="prevBtn" disabled>&#8592; Prev</button>
      <button class="page-btn" id="nextBtn" disabled>Next &#8594;</button>
    </div>
  </div>
  <div id="new-jobs-banner" role="alert" aria-live="polite">
    <span id="banner-text"></span>
    <div class="banner-actions">
      <button id="banner-refresh">Refresh now</button>
      <button id="banner-dismiss">Dismiss</button>
    </div>
  </div>
  <div id="status"></div>
  <main>
    <div class="grid" id="grid"></div>
  </main>
</div>
<div id="score-popover"></div>
<div id="map-panel">
  <div class="map-toolbar">
    <button id="locateBtn">Use my location</button>
    <input type="text" id="locationSearch" placeholder="Search a city&hellip;">
    <button id="locationGo">Go</button>
    <select id="mapDays">
      <option value="7">Last 7 days</option>
      <option value="30" selected>Last 30 days</option>
      <option value="90">Last 90 days</option>
    </select>
    <label style="font-size:0.875rem;color:var(--muted)">
      <input type="checkbox" id="mapSalaryOnly"> Salary only
    </label>
    <span class="map-note" id="mapNote"></span>
  </div>
  <div id="map"></div>
</div>

<script>
const SOURCE_COLORS = ${JSON.stringify(SOURCE_COLORS)};

const STATUS_COLORS = {
  none: "#6e7681",
  interested: "#1f6feb",
  applied: "#2ea043",
  interview: "#8957e5",
  offer: "#d4680a",
  rejected: "#b91c1c",
};
const STATUS_LABELS = {
  none: "—",
  interested: "Interested",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};
const STATUS_OPTIONS = ["none", "interested", "applied", "interview", "offer", "rejected"];

const jobScores = {};
const appStatuses = {};
let scoringAvailable = true;
let scoringUnavailableReason = "";

async function loadInitialData() {
  try {
    const [scoresRes, configRes, appsRes, countRes] = await Promise.all([
      fetch("/api/scores"),
      fetch("/api/scoring-config"),
      fetch("/api/application-status"),
      fetch("/api/count"),
    ]);
    if (scoresRes.ok) Object.assign(jobScores, await scoresRes.json());
    if (configRes.ok) {
      const cfg = await configRes.json();
      scoringAvailable = cfg.available;
      scoringUnavailableReason = cfg.reason ?? "";
    }
    if (appsRes.ok) {
      const data = await appsRes.json();
      for (const [k, v] of Object.entries(data)) {
        appStatuses[k] = v.status;
      }
    }
    if (countRes.ok) {
      ({ total: totalJobs } = await countRes.json());
    }
  } catch {
    // ignore
  }
}

function scoreColor(n) {
  if (n >= 70) return "green";
  if (n >= 40) return "amber";
  return "red";
}

function scoreBadgeHtml(entry) {
  const hasDetail = entry.missingKeywords || entry.rewrites?.length || entry.reason;
  const clickAttr = hasDetail ? \` onclick="showScoreDetail(this, event)"\` : "";
  const dataAttr = hasDetail ? \` data-statekey="\${esc(entry.stateKey)}"\` : "";
  return \`<span class="score-badge \${scoreColor(entry.score)}"\${clickAttr}\${dataAttr}>\${entry.score}/100</span>\`;
}

function renderScoreWidget(job) {
  const key = job.stateKey;
  if (jobScores[key] !== undefined) {
    return scoreBadgeHtml({ ...jobScores[key], stateKey: key });
  }
  if (!scoringAvailable) {
    return \`<button class="match-btn" disabled title="\${esc(scoringUnavailableReason)}">Estimate Match</button>\`;
  }
  return \`<button class="match-btn" data-statekey="\${esc(key)}" onclick="estimateMatch(this)">Estimate Match</button>\`;
}

function renderStatusSelect(job) {
  const status = appStatuses[job.stateKey] || "none";
  const opts = STATUS_OPTIONS.map(s =>
    \`<option value="\${s}"\${s === status ? " selected" : ""}>\${STATUS_LABELS[s]}</option>\`
  ).join("");
  return \`<select class="status-select" data-statekey="\${esc(job.stateKey)}" onchange="updateStatus(this)" style="border-color:\${STATUS_COLORS[status]};color:\${STATUS_COLORS[status]}">\${opts}</select>\`;
}

async function updateStatus(select) {
  const stateKey = select.dataset.statekey;
  const status = select.value;
  appStatuses[stateKey] = status;
  select.style.borderColor = STATUS_COLORS[status];
  select.style.color = STATUS_COLORS[status];
  await fetch("/api/application-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stateKey, status }),
  }).catch(() => {});
}

const scorePopover = document.getElementById("score-popover");

function showScoreDetail(badge, event) {
  event.stopPropagation();
  if (!scorePopover) return;
  const key = badge.dataset.statekey;
  const entry = key ? jobScores[key] : null;
  if (!entry) return;

  const lines = [];
  if (entry.missingKeywords && !/^none$/i.test(entry.missingKeywords)) {
    lines.push(\`<strong>Missing keywords:</strong> \${esc(entry.missingKeywords)}\`);
  }
  if (entry.rewrites?.length) {
    lines.push(\`<strong>Suggested rewrites:</strong>\`);
    for (const r of entry.rewrites) lines.push(\`• \${esc(r)}\`);
  }
  if (entry.reason) lines.push(\`<em>\${esc(entry.reason)}</em>\`);
  if (lines.length === 0) return;

  scorePopover.innerHTML = lines.join("<br>");
  scorePopover.classList.add("visible");
  const rect = badge.getBoundingClientRect();
  const top = rect.bottom + 6 + window.scrollY;
  const left = Math.max(0, Math.min(rect.left + window.scrollX, window.innerWidth - 280));
  scorePopover.style.top = top + "px";
  scorePopover.style.left = left + "px";
}

document.addEventListener("click", () => {
  if (scorePopover) scorePopover.classList.remove("visible");
});

let scoringInFlight = false;

async function estimateMatch(btn) {
  if (scoringInFlight) return;
  scoringInFlight = true;
  const stateKey = btn.dataset.statekey;
  btn.disabled = true;
  btn.textContent = "Scoring\u2026";
  try {
    const res = await fetch("/api/score-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stateKey }),
    });
    if (res.ok) {
      const data = await res.json();
      const { score, reason, missingKeywords, rewrites } = data;
      jobScores[stateKey] = { score, reason, missingKeywords, rewrites };
      btn.outerHTML = scoreBadgeHtml({ stateKey, score, reason, missingKeywords, rewrites });
    } else if (res.status === 503) {
      btn.disabled = false;
      btn.textContent = "Estimate Match";
      btn.title = "Ollama is not reachable — is it running?";
    } else {
      btn.outerHTML = \`<span class="score-badge error">?</span>\`;
    }
  } catch {
    btn.disabled = false;
    btn.textContent = "Estimate Match";
  } finally {
    scoringInFlight = false;
  }
}

// --- Bulk scoring ---

let bulkPollInterval = null;

async function startBulkScore() {
  const btn = document.getElementById("bulkScoreBtn");
  const prog = document.getElementById("bulkProgress");
  btn.disabled = true;
  prog.textContent = "Starting\u2026";
  try {
    const res = await fetch("/api/score-all/start", { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      prog.textContent = data.error || "Failed to start";
      btn.disabled = false;
      return;
    }
  } catch {
    prog.textContent = "Error";
    btn.disabled = false;
    return;
  }

  bulkPollInterval = setInterval(async () => {
    try {
      const res = await fetch("/api/score-all/status");
      if (!res.ok) return;
      const data = await res.json();
      prog.textContent = \`\${data.scored}/\${data.total} scored\${data.errors > 0 ? " (" + data.errors + " errors)" : ""}\`;
      if (data.done) {
        clearInterval(bulkPollInterval);
        bulkPollInterval = null;
        btn.disabled = false;
        prog.textContent = \`Done — \${data.scored}/\${data.total}\`;
        // refresh scores and reload page
        const scoresRes = await fetch("/api/scores");
        if (scoresRes.ok) Object.assign(jobScores, await scoresRes.json());
        loadPage(currentPage);
      }
    } catch {}
  }, 2000);
}

document.getElementById("bulkScoreBtn").addEventListener("click", startBulkScore);

function badgeColor(source) {
  return SOURCE_COLORS[source.toLowerCase()] || "#6e7681";
}

function relativeTime(ts) {
  if (!ts) return null;
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : mins + " mins ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs === 1 ? "1 hour ago" : hrs + " hours ago";
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1 day ago" : days + " days ago";
}

function relativePostedAt(str) {
  if (!str) return null;
  const ts = Date.parse(str);
  if (isNaN(ts)) return str;
  return relativeTime(ts);
}

function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function renderCard(job) {
  const location = job.location
    ? \`<span class="meta-item">&#128205; \${esc(job.location)}</span>\` : "";
  const salary = job.salary
    ? \`<span class="meta-item">&#128176; \${esc(job.salary)}</span>\` : "";
  const qualifications = job.qualifications
    ? \`<span class="meta-item">&#127891; \${esc(job.qualifications)}</span>\` : "";
  const posted = relativePostedAt(job.postedAt)
    ? \`<span class="meta-item">&#128337; \${esc(relativePostedAt(job.postedAt))}</span>\` : "";
  const alerted = job.sentAt ? relativeTime(job.sentAt) : null;

  return \`
    <div class="card">
      <div class="card-header">
        <div class="card-title">\${esc(job.title)}</div>
        <span class="badge" style="background:\${badgeColor(job.source)}">\${esc(job.source)}</span>
      </div>
      <div class="card-company">\${esc(job.company)}</div>
      <div class="card-meta">\${salary}\${qualifications}\${location}\${posted}</div>
      <div class="card-footer">
        <span class="alerted-text">\${alerted ? "Alerted " + esc(alerted) : ""}</span>
        <div class="card-actions">
          \${renderStatusSelect(job)}
          \${renderScoreWidget(job)}
          <a class="view-btn" href="\${esc(job.url)}" target="_blank" rel="noopener">View Job &rarr;</a>
        </div>
      </div>
    </div>
  \`;
}

let currentPage = 1;
let currentPageSize = parseInt(localStorage.getItem("pageSize") || "10", 10);
let currentSort = localStorage.getItem("sort") || "newest";
let currentSalaryOnly = localStorage.getItem("salaryOnly") === "1";
let currentSearch = localStorage.getItem("search") || "";
let currentSource = localStorage.getItem("sourceFilter") || "";
let currentStatus = localStorage.getItem("statusFilter") || "";
let currentHasScore = localStorage.getItem("hasScore") === "1";
let currentMinScore = parseInt(localStorage.getItem("minScore") || "0", 10);
let currentDateFrom = localStorage.getItem("dateFrom") || "";
let currentDateTo = localStorage.getItem("dateTo") || "";
// Tracks unfiltered total from /api/count — used only for new-job polling baseline.
// Never set from data.total in loadPage (which reflects active filters).
let totalJobs = 0;

const grid = document.getElementById("grid");
const pageInfo = document.getElementById("pageInfo");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const pageSizeSelect = document.getElementById("pageSizeSelect");
const statusEl = document.getElementById("status");

// Restore filter UI state
pageSizeSelect.value = String(currentPageSize);
document.getElementById("searchInput").value = currentSearch;
document.getElementById("sourceFilter").value = currentSource;
document.getElementById("statusFilter").value = currentStatus;
document.getElementById("hasScoreFilter").checked = currentHasScore;
document.getElementById("minScoreRange").value = String(currentMinScore);
document.getElementById("minScoreVal").textContent = String(currentMinScore);
if (currentDateFrom) document.getElementById("dateFrom").value = currentDateFrom;
if (currentDateTo) document.getElementById("dateTo").value = currentDateTo;

async function fetchJobs(page, pageSize) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort: currentSort });
  if (currentSalaryOnly) params.set("salaryOnly", "1");
  if (currentSearch) params.set("search", currentSearch);
  if (currentSource) params.set("source", currentSource);
  if (currentStatus) params.set("status", currentStatus);
  if (currentHasScore) params.set("hasScore", "1");
  if (currentMinScore > 0) params.set("minScore", String(currentMinScore));
  if (currentDateFrom) params.set("dateFrom", currentDateFrom);
  if (currentDateTo) params.set("dateTo", currentDateTo);
  const res = await fetch(\`/api/jobs?\${params}\`);
  if (!res.ok) throw new Error("API error: " + res.status);
  return res.json();
}

async function loadPage(page) {
  statusEl.textContent = "Loading\u2026";
  grid.innerHTML = "";
  try {
    const data = await fetchJobs(page, currentPageSize);
    currentPage = data.page;
    statusEl.textContent = "";

    if (data.jobs.length === 0) {
      if (data.total === 0) {
        grid.innerHTML = \`<div class="empty-state" style="grid-column:1/-1">
          <h2>No job history yet</h2>
          <p>Run <code>npm run check</code> (not dry-run) to send alerts and populate history.</p>
        </div>\`;
      }
      pageInfo.textContent = "No results";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    const start = (data.page - 1) * data.pageSize + 1;
    const end = start + data.jobs.length - 1;
    pageInfo.textContent = \`Showing \${start}\u2013\${end} of \${data.total}\`;
    prevBtn.disabled = data.page <= 1;
    nextBtn.disabled = data.page >= data.totalPages;

    grid.innerHTML = data.jobs.map(renderCard).join("");
  } catch (err) {
    statusEl.textContent = "Error loading jobs: " + err.message;
  }
}

prevBtn.addEventListener("click", () => loadPage(currentPage - 1));
nextBtn.addEventListener("click", () => loadPage(currentPage + 1));
pageSizeSelect.addEventListener("change", () => {
  currentPageSize = parseInt(pageSizeSelect.value, 10);
  localStorage.setItem("pageSize", String(currentPageSize));
  currentPage = 1;
  loadPage(1);
});

const sortSelect = document.getElementById("sortSelect");
const salaryOnlyCheck = document.getElementById("salaryOnly");
sortSelect.value = currentSort;
salaryOnlyCheck.checked = currentSalaryOnly;

sortSelect.addEventListener("change", () => {
  currentSort = sortSelect.value;
  localStorage.setItem("sort", currentSort);
  currentPage = 1;
  loadPage(1);
});
salaryOnlyCheck.addEventListener("change", () => {
  currentSalaryOnly = salaryOnlyCheck.checked;
  localStorage.setItem("salaryOnly", currentSalaryOnly ? "1" : "0");
  currentPage = 1;
  loadPage(1);
});

// --- Filter handlers ---

let searchTimer = null;
document.getElementById("searchInput").addEventListener("input", e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentSearch = e.target.value.trim();
    localStorage.setItem("search", currentSearch);
    currentPage = 1;
    loadPage(1);
  }, 300);
});

document.getElementById("sourceFilter").addEventListener("change", e => {
  currentSource = e.target.value;
  localStorage.setItem("sourceFilter", currentSource);
  currentPage = 1;
  loadPage(1);
});

document.getElementById("statusFilter").addEventListener("change", e => {
  currentStatus = e.target.value;
  localStorage.setItem("statusFilter", currentStatus);
  currentPage = 1;
  loadPage(1);
});

document.getElementById("hasScoreFilter").addEventListener("change", e => {
  currentHasScore = e.target.checked;
  localStorage.setItem("hasScore", currentHasScore ? "1" : "0");
  currentPage = 1;
  loadPage(1);
});

document.getElementById("minScoreRange").addEventListener("input", e => {
  currentMinScore = parseInt(e.target.value, 10);
  document.getElementById("minScoreVal").textContent = String(currentMinScore);
  localStorage.setItem("minScore", String(currentMinScore));
  currentPage = 1;
  loadPage(1);
});

document.getElementById("dateFrom").addEventListener("change", e => {
  currentDateFrom = e.target.value;
  localStorage.setItem("dateFrom", currentDateFrom);
  currentPage = 1;
  loadPage(1);
});

document.getElementById("dateTo").addEventListener("change", e => {
  currentDateTo = e.target.value;
  localStorage.setItem("dateTo", currentDateTo);
  currentPage = 1;
  loadPage(1);
});

document.getElementById("clearFilters").addEventListener("click", () => {
  currentSearch = "";
  currentSource = "";
  currentStatus = "";
  currentHasScore = false;
  currentMinScore = 0;
  currentDateFrom = "";
  currentDateTo = "";
  document.getElementById("searchInput").value = "";
  document.getElementById("sourceFilter").value = "";
  document.getElementById("statusFilter").value = "";
  document.getElementById("hasScoreFilter").checked = false;
  document.getElementById("minScoreRange").value = "0";
  document.getElementById("minScoreVal").textContent = "0";
  document.getElementById("dateFrom").value = "";
  document.getElementById("dateTo").value = "";
  ["search","sourceFilter","statusFilter","hasScore","minScore","dateFrom","dateTo"].forEach(k => localStorage.removeItem(k));
  currentPage = 1;
  loadPage(1);
});

// Theme
const themeToggle = document.getElementById("themeToggle");
function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}
const savedTheme = localStorage.getItem("theme") || getSystemTheme();
applyTheme(savedTheme);
themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || getSystemTheme();
  applyTheme(current === "dark" ? "light" : "dark");
});

loadInitialData().then(() => loadPage(1));

// New-jobs polling
const banner = document.getElementById("new-jobs-banner");
const bannerText = document.getElementById("banner-text");
const bannerRefresh = document.getElementById("banner-refresh");
const bannerDismiss = document.getElementById("banner-dismiss");

async function checkForNewJobs() {
  try {
    const res = await fetch("/api/count");
    if (!res.ok) return;
    const { total } = await res.json();
    if (total > totalJobs && totalJobs > 0) {
      const diff = total - totalJobs;
      bannerText.textContent = \`\${diff} new job\${diff === 1 ? "" : "s"} available since you last loaded.\`;
      banner.classList.remove("removed");
      banner.classList.add("visible");
      totalJobs = total;
    } else if (total < totalJobs && totalJobs > 0) {
      const diff = totalJobs - total;
      bannerText.textContent = \`\${diff} job\${diff === 1 ? "" : "s"} removed from boards since you last loaded.\`;
      banner.classList.add("removed");
      banner.classList.add("visible");
      totalJobs = total;
    }
  } catch {
    // silently ignore network errors during polling
  }
}

bannerRefresh.addEventListener("click", async () => {
  banner.classList.remove("visible", "removed");
  currentPage = 1;
  try {
    const res = await fetch("/api/count");
    if (res.ok) ({ total: totalJobs } = await res.json());
  } catch { /* ignore */ }
  loadPage(1);
});

bannerDismiss.addEventListener("click", async () => {
  banner.classList.remove("visible", "removed");
  // Advance baseline so re-alerts only fire for future additions
  try {
    const res = await fetch("/api/count");
    if (res.ok) ({ total: totalJobs } = await res.json());
  } catch { /* ignore */ }
});

setInterval(checkForNewJobs, 30_000);

// --- Tab switching ---

const tabJobs = document.getElementById("tabJobs");
const tabMap = document.getElementById("tabMap");
const jobsPanel = document.getElementById("jobs-panel");
const mapPanel = document.getElementById("map-panel");
let mapInitialized = false;

function switchTab(tab) {
  if (tab === "map") {
    tabJobs.classList.remove("active");
    tabMap.classList.add("active");
    jobsPanel.classList.add("hidden");
    mapPanel.classList.add("visible");
    if (!mapInitialized) initMap();
  } else {
    tabMap.classList.remove("active");
    tabJobs.classList.add("active");
    mapPanel.classList.remove("visible");
    jobsPanel.classList.remove("hidden");
  }
}

tabJobs.addEventListener("click", () => switchTab("jobs"));
tabMap.addEventListener("click", () => switchTab("map"));

// --- Map ---

function loadLeaflet() {
  return new Promise(resolve => {
    const cssUrls = [
      "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.css",
      "https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.css",
      "https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css"
    ];
    for (const href of cssUrls) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
    const leafletJs = document.createElement("script");
    leafletJs.src = "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js";
    leafletJs.onload = () => {
      const clusterJs = document.createElement("script");
      clusterJs.src = "https://cdn.jsdelivr.net/npm/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.min.js";
      clusterJs.onload = resolve;
      document.head.appendChild(clusterJs);
    };
    document.head.appendChild(leafletJs);
  });
}

async function initMap() {
  mapInitialized = true;
  const mapNote = document.getElementById("mapNote");
  mapNote.textContent = "Loading\u2026";

  await loadLeaflet();

  const map = L.map("map").setView([39.5, -98.35], 4);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  let cluster = L.markerClusterGroup();
  map.addLayer(cluster);

  let allMapJobs = [];
  let apiSkippedCount = 0;

  async function loadMarkers(days) {
    mapNote.textContent = "Loading\u2026";
    let data;
    try {
      const res = await fetch(\`/api/map-jobs?days=\${days}\`);
      data = await res.json();
    } catch (err) {
      mapNote.textContent = "Error loading job locations: " + err.message;
      return;
    }
    allMapJobs = data.jobs;
    apiSkippedCount = data.skippedCount;
    renderMapMarkers();
  }

  function renderMapMarkers() {
    cluster.clearLayers();
    const salaryOnly = document.getElementById("mapSalaryOnly").checked;
    const jobs = salaryOnly ? allMapJobs.filter(j => j.salary) : allMapJobs;

    if (jobs.length === 0) {
      mapNote.textContent = salaryOnly && allMapJobs.length > 0
        ? "No jobs with salary data in this period."
        : "No mappable job locations yet \u2014 jobs with 'Remote' or no location can't be plotted.";
      return;
    }

    for (const job of jobs) {
      const postedTime = relativePostedAt(job.postedAt);
      const timeStr = postedTime
        ? (postedTime.startsWith("Posted ") ? postedTime : "Posted " + postedTime)
        : job.sentAt ? "Seen " + relativeTime(job.sentAt) : null;
      const parts = [
        \`<strong>\${esc(job.title)}</strong>\`,
        esc(job.company),
        job.salary ? esc(job.salary) : null,
        job.location ? esc(job.location) : null,
        timeStr ? esc(timeStr) : null,
        \`<a href="\${esc(job.url)}" target="_blank" rel="noopener">View Job &rarr;</a>\`
      ].filter(Boolean);
      L.marker([job.lat, job.lng]).bindPopup(parts.join("<br>")).addTo(cluster);
    }

    const totalSkipped = apiSkippedCount + (allMapJobs.length - jobs.length);
    mapNote.textContent = totalSkipped > 0
      ? \`\${jobs.length} jobs mapped, \${totalSkipped} skipped\`
      : \`\${jobs.length} jobs mapped\`;
  }

  document.getElementById("mapSalaryOnly").addEventListener("change", renderMapMarkers);

  const mapDays = document.getElementById("mapDays");
  await loadMarkers(mapDays.value);

  mapDays.addEventListener("change", () => loadMarkers(mapDays.value));

  document.getElementById("locateBtn").addEventListener("click", () => {
    if (!navigator.geolocation) { alert("Geolocation not supported."); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 10);
      L.marker([pos.coords.latitude, pos.coords.longitude])
        .addTo(map).bindPopup("Your location").openPopup();
    }, () => alert("Location access denied or unavailable."));
  });

  function searchLocation() {
    const q = document.getElementById("locationSearch").value.trim();
    if (!q) return;
    fetch(\`https://nominatim.openstreetmap.org/search?q=\${encodeURIComponent(q)}&format=json&limit=1\`, {
      headers: { "User-Agent": "job-alerts-dashboard/1.0" }
    }).then(r => r.json()).then(d => {
      if (d[0]) map.setView([parseFloat(d[0].lat), parseFloat(d[0].lon)], 10);
      else alert("Location not found.");
    }).catch(() => alert("Search failed."));
  }

  document.getElementById("locationGo").addEventListener("click", searchLocation);
  document.getElementById("locationSearch").addEventListener("keydown", e => {
    if (e.key === "Enter") searchLocation();
  });
}
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  // Health check
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Config reload
  if (req.method === "GET" && url.pathname === "/api/reload-config") {
    try {
      cachedConfig = loadConfig();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/count") {
    const total = getCachedHistory().length;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ total }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/jobs") {
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "10", 10)));
    const sort = url.searchParams.get("sort") ?? "newest";
    const salaryOnly = url.searchParams.get("salaryOnly") === "1";
    const search = (url.searchParams.get("search") ?? "").toLowerCase().trim();
    const sourceFilter = (url.searchParams.get("source") ?? "").toLowerCase().trim();
    const statusFilter = url.searchParams.get("status") ?? "";
    const hasScore = url.searchParams.get("hasScore") === "1";
    const minScore = Math.max(0, parseInt(url.searchParams.get("minScore") ?? "0", 10));
    const dateFromParam = url.searchParams.get("dateFrom");
    const dateToParam = url.searchParams.get("dateTo");
    const dateFrom = dateFromParam ? new Date(dateFromParam).getTime() : 0;
    const dateTo = dateToParam ? new Date(dateToParam + "T23:59:59").getTime() : 0;

    let history = getCachedHistory().slice();

    if (search) {
      history = history.filter(j =>
        j.title.toLowerCase().includes(search) ||
        j.company.toLowerCase().includes(search) ||
        (j.location?.toLowerCase().includes(search) ?? false)
      );
    }
    if (sourceFilter) {
      history = history.filter(j => j.source.toLowerCase() === sourceFilter);
    }
    if (salaryOnly) {
      history = history.filter(j => j.salary);
    }
    if (dateFrom) {
      history = history.filter(j => j.sentAt >= dateFrom);
    }
    if (dateTo) {
      history = history.filter(j => j.sentAt <= dateTo);
    }

    const scores = getAllScores();
    if (hasScore) {
      history = history.filter(j => scores[j.stateKey] !== undefined);
    }
    if (minScore > 0) {
      history = history.filter(j => {
        const entry = scores[j.stateKey];
        return entry !== undefined && entry.score >= minScore;
      });
    }

    if (statusFilter) {
      const apps = getAllApplications();
      if (statusFilter === "none") {
        history = history.filter(j => !apps[j.stateKey]);
      } else {
        history = history.filter(j => apps[j.stateKey]?.status === statusFilter);
      }
    }

    if (sort === "salary-desc") {
      history.sort((a, b) => {
        if (a.salaryMin == null && b.salaryMin == null) return 0;
        if (a.salaryMin == null) return 1;
        if (b.salaryMin == null) return -1;
        return b.salaryMin - a.salaryMin;
      });
    } else if (sort === "salary-asc") {
      history.sort((a, b) => {
        if (a.salaryMin == null && b.salaryMin == null) return 0;
        if (a.salaryMin == null) return 1;
        if (b.salaryMin == null) return -1;
        return a.salaryMin - b.salaryMin;
      });
    } else {
      history.sort((a, b) => b.sentAt - a.sentAt);
    }

    const total = history.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const jobs = history.slice(start, start + pageSize);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jobs, total, page, pageSize, totalPages }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/map-jobs") {
    (async () => {
      const days = Math.max(1, parseInt(url.searchParams.get("days") ?? "30", 10) || 30);
      const cutoff = Date.now() - days * 86_400_000;
      const history = getCachedHistory().filter((j) => j.sentAt >= cutoff);
      const mappedJobs: MapJob[] = [];
      let skippedCount = 0;

      for (const job of history) {
        if (!job.location) { skippedCount++; continue; }
        const coords = await geocode(job.location);
        if (!coords) { skippedCount++; continue; }
        mappedJobs.push({ ...job, lat: coords.lat, lng: coords.lng });
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jobs: mappedJobs, skippedCount }));
    })().catch(err => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/scores") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getAllScores()));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/scoring-config") {
    const config = getConfig();
    const missing: string[] = [];
    if (!config.resumePath) missing.push("resumePath");
    if (!config.ollamaModel) missing.push("ollamaModel");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      available: missing.length === 0,
      reason: missing.length > 0 ? `Set ${missing.join(" and ")} in config.json to enable AI scoring` : null,
    }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/score-job") {
    (async () => {
      let body = "";
      for await (const chunk of req) body += chunk;
      let stateKey: string;
      try {
        ({ stateKey } = JSON.parse(body) as { stateKey: string });
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      const config = getConfig();

      if (!config.resumePath) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "resumePath not set in config.json" }));
        return;
      }

      const job = getCachedHistory().find((j) => j.stateKey === stateKey);
      if (!job) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Job not found" }));
        return;
      }

      try {
        const entry = await scoreJob(job, config.resumePath, config.ollamaModel);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ stateKey, ...entry }));
      } catch (err) {
        if (err instanceof OllamaUnavailableError) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        } else if (err instanceof Error && err.message.startsWith("Could not parse score")) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        } else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      }
    })().catch(err => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // Bulk scoring endpoints
  if (req.method === "POST" && url.pathname === "/api/score-all/start") {
    const config = getConfig();
    if (!config.resumePath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "resumePath not set in config.json" }));
      return;
    }
    if (!config.ollamaModel) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "ollamaModel not set in config.json" }));
      return;
    }
    if (bulkScoreRunning) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, alreadyRunning: true }));
      return;
    }
    startBulkScore(config).catch(err => console.error("[dashboard] Bulk score error:", err));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/score-all/status") {
    if (!bulkScoreState) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ total: 0, scored: 0, done: true, errors: 0, idle: true }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(bulkScoreState));
    return;
  }

  // Application status endpoints
  if (req.method === "GET" && url.pathname === "/api/application-status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getAllApplications()));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/application-status") {
    (async () => {
      let body = "";
      for await (const chunk of req) body += chunk;
      let stateKey: string, status: ApplicationStatus;
      try {
        ({ stateKey, status } = JSON.parse(body) as { stateKey: string; status: ApplicationStatus });
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }
      const validStatuses = ["none", "interested", "applied", "interview", "offer", "rejected"];
      if (!validStatuses.includes(status)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid status value" }));
        return;
      }
      setApplication(stateKey, status);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    })().catch(err => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  // CSV export
  if (req.method === "GET" && url.pathname === "/api/export.csv") {
    const history = getCachedHistory();
    const scores = getAllScores();
    const apps = getAllApplications();

    const escape = (v: string | number | undefined | null): string => {
      if (v == null) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const headers = ["title", "company", "source", "location", "salary", "score", "alerted", "status", "url"];
    const rows = history.map(j => {
      const scoreEntry = scores[j.stateKey];
      const appEntry = apps[j.stateKey];
      return [
        escape(j.title),
        escape(j.company),
        escape(j.source),
        escape(j.location),
        escape(j.salary),
        escape(scoreEntry?.score),
        escape(new Date(j.sentAt).toISOString()),
        escape(appEntry?.status ?? "none"),
        escape(j.url),
      ].join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="jobs.csv"',
    });
    res.end(csv);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

export function startDashboard(): void {
  cachedConfig = loadConfig();
  loadGeocodeCache();
  loadScores();
  loadApplications();
  setHistoryChangeListener(() => { historyCache = null; });
  server.listen(PORT, () => {
    console.log(`[dashboard] Listening on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startDashboard();
}
