import http from "http";
import path from "path";
import fs from "fs";
import { loadHistory } from "./history.js";

const PORT = parseInt(process.env.PORT ?? "3737", 10);

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

  await new Promise(r => setTimeout(r, 1000));
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "job-alerts-dashboard/1.0" } });
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
    display: flex; align-items: center; justify-content: space-between;
  }
  header h1 { font-size: 1.125rem; font-weight: 600; }
  .theme-btn {
    background: none; border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 0.35rem 0.75rem; cursor: pointer; font-size: 0.875rem;
  }
  .theme-btn:hover { background: var(--border); }

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
  .pagination { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }
  .page-info { font-size: 0.875rem; color: var(--muted); white-space: nowrap; }
  .page-btn {
    background: var(--card); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.3rem 0.65rem; cursor: pointer; font-size: 0.875rem;
  }
  .page-btn:hover:not(:disabled) { background: var(--accent); color: #fff; border-color: var(--accent); }
  .page-btn:disabled { opacity: 0.4; cursor: default; }

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

  .card-footer { margin-top: auto; display: flex; align-items: center; justify-content: space-between; padding-top: 0.5rem; border-top: 1px solid var(--border); }
  .alerted-text { font-size: 0.75rem; color: var(--muted); }
  .view-btn {
    background: var(--accent); color: #fff; border: none; border-radius: 6px;
    padding: 0.4rem 0.8rem; font-size: 0.8rem; font-weight: 500; cursor: pointer;
    text-decoration: none; display: inline-block;
  }
  .view-btn:hover { opacity: 0.85; }

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
  <button class="theme-btn" id="themeToggle">Toggle theme</button>
</header>
<div id="jobs-panel">
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
        <a class="view-btn" href="\${esc(job.url)}" target="_blank" rel="noopener">View Job &rarr;</a>
      </div>
    </div>
  \`;
}

let currentPage = 1;
let currentPageSize = parseInt(localStorage.getItem("pageSize") || "10", 10);
let currentSort = localStorage.getItem("sort") || "newest";
let currentSalaryOnly = localStorage.getItem("salaryOnly") === "1";
let totalJobs = 0;

const grid = document.getElementById("grid");
const pageInfo = document.getElementById("pageInfo");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const pageSizeSelect = document.getElementById("pageSizeSelect");
const statusEl = document.getElementById("status");

pageSizeSelect.value = String(currentPageSize);

async function fetchJobs(page, pageSize) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort: currentSort });
  if (currentSalaryOnly) params.set("salaryOnly", "1");
  const res = await fetch(\`/api/jobs?\${params}\`);
  if (!res.ok) throw new Error("API error: " + res.status);
  return res.json();
}

async function loadPage(page) {
  statusEl.textContent = "Loading\u2026";
  grid.innerHTML = "";
  try {
    const data = await fetchJobs(page, currentPageSize);
    totalJobs = data.total;
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

loadPage(1);

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
      banner.classList.add("visible");
    }
  } catch {
    // silently ignore network errors during polling
  }
}

bannerRefresh.addEventListener("click", () => {
  banner.classList.remove("visible");
  currentPage = 1;
  loadPage(1);
});

bannerDismiss.addEventListener("click", async () => {
  banner.classList.remove("visible");
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
      const timeStr = relativePostedAt(job.postedAt)
        ? "Posted " + relativePostedAt(job.postedAt)
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

  if (req.method === "GET" && url.pathname === "/api/count") {
    const total = loadHistory().length;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ total }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/jobs") {
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "10", 10)));

    const sort = url.searchParams.get("sort") ?? "newest";
    const salaryOnly = url.searchParams.get("salaryOnly") === "1";

    let history = loadHistory();
    if (salaryOnly) history = history.filter(j => j.salary);
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
      const history = loadHistory().filter((j) => j.sentAt >= cutoff);
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

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

export function startDashboard(): void {
  loadGeocodeCache();
  server.listen(PORT, () => {
    console.log(`[dashboard] Listening on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  startDashboard();
}
