import http from "http";
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
</style>
</head>
<body>
<header>
  <h1>Job Alert Dashboard</h1>
  <button class="theme-btn" id="themeToggle">Toggle theme</button>
</header>
<div class="controls">
  <label>
    Per page:
    <select id="pageSizeSelect">
      <option value="10">10</option>
      <option value="30">30</option>
      <option value="50">50</option>
    </select>
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

<script>
const SOURCE_COLORS = {
  greenhouse: "#2ea043",
  lever: "#d4680a",
  ashby: "#8957e5",
  workday: "#1f6feb",
  "hacker news": "#e05d4b",
  usajobs: "#1a9e8f",
};

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
      <div class="card-meta">\${location}\${salary}\${posted}</div>
      <div class="card-footer">
        <span class="alerted-text">\${alerted ? "Alerted " + esc(alerted) : ""}</span>
        <a class="view-btn" href="\${esc(job.url)}" target="_blank" rel="noopener">View Job &rarr;</a>
      </div>
    </div>
  \`;
}

let currentPage = 1;
let currentPageSize = parseInt(localStorage.getItem("pageSize") || "10", 10);
let totalJobs = 0;

const grid = document.getElementById("grid");
const pageInfo = document.getElementById("pageInfo");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const pageSizeSelect = document.getElementById("pageSizeSelect");
const statusEl = document.getElementById("status");

pageSizeSelect.value = String(currentPageSize);

async function fetchJobs(page, pageSize) {
  const res = await fetch(\`/api/jobs?page=\${page}&pageSize=\${pageSize}\`);
  if (!res.ok) throw new Error("API error: " + res.status);
  return res.json();
}

async function loadPage(page) {
  statusEl.textContent = "Loading…";
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
    pageInfo.textContent = \`Showing \${start}–\${end} of \${data.total}\`;
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

    const history = loadHistory().sort((a, b) => b.sentAt - a.sentAt);
    const total = history.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const jobs = history.slice(start, start + pageSize);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jobs, total, page, pageSize, totalPages }));
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

server.listen(PORT, () => {
  console.log(`[dashboard] Listening on http://localhost:${PORT}`);
});
