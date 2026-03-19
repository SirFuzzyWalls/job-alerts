# Product Roadmap: job-alerts

## Context

job-alerts is a personal job-hunting automation tool. It scrapes 7 ATS platforms (Greenhouse, Lever, Ashby, Workday, USAJobs, Hacker News), filters against configurable criteria, emails digests, and provides a local dashboard with geolocation and AI match scoring.

The tool is intended for a single-user, self-hosted use case. The roadmap below is scoped as such no multi user, no cloud deployments, no database migration. The number one goal is to keep user data private, and secondly to keep dependencies and costs as close to zero as possible.

---

## Versioning Strategy

Releases follow [Semantic Versioning](https://semver.org/):

- **Patch (x.x.Z):** Bug fixes, dependency updates, minor copy changes
- **Minor (x.Y.0):** A completed roadmap phase or notable feature addition
- **Major (X.0.0):** Architectural overhaul or breaking change to config/data formats

---

## Released Versions

| Version | Date | Notes |
|---------|------|-------|
| v1.0.0 | 2026-03-19 | MVP complete; Phase 1 (Power Search) shipped |

---

## Current State (Baseline)

**What works:**
- Multi-source scraping with retry/backoff, concurrent fetching
- Title, salary, and location filtering (USA state-aware)
- Email digests with dedup and removed-job detection
- Dashboard: pagination, sort, salary filter, dark mode, map view, polling banner
- AI match scoring (Ollama, on-demand or auto on check)
- First-run seeding (no email flood)

---

## MVP Gaps ✅ All closed

| Gap | Fix | Status |
|-----|-----|--------|
| No `/health` endpoint | `GET /health → { status: "ok" }` | ✅ Done |
| HTML entities unescaped in job titles | `decodeHtmlEntities()` in `utils.ts`, applied in `sources/index.ts` | ✅ Done |
| Config reload requires restart | `GET /api/reload-config` (dashboard-mode only) | ✅ Done |
| No `--validate-config` flag | Added to `index.ts`; `npm run validate-config` script | ✅ Done |
| Scoring has no Ollama timeout | `AbortSignal.timeout(60_000)` on Ollama fetch in `scorer.ts` | ✅ Done |
| Dashboard history cache never invalidates | `setHistoryChangeListener` in `history.ts`; dashboard clears cache on every history write | ✅ Done |

---

## Roadmap

### Phase 1 — Power Search ✅ Complete → v1.0.0

**Theme:** Make the dashboard useful for active job hunting, not just passive review.

#### 1.1 Dashboard Search & Filters ✅
- Free-text search across title, company, location (300ms debounce)
- Filter by: source, application status, has-score, score threshold (slider), date range (from/to)
- Filters persist to localStorage; clear-filters button
- **Files:** `src/dashboard.ts`

#### 1.2 Bulk AI Scoring ✅
- "Score all unscored" button in controls bar
- Progress indicator (X of Y scored), polls `/api/score-all/status` every 2s
- Score threshold filter: hide jobs below N (slider, default 0)
- **Files:** `src/dashboard.ts`, `src/scorer.ts`

#### 1.3 Job Application Tracking ✅
- Per-card status: None → Interested → Applied → Interview → Offer → Rejected
- Persisted to `application_status.json`
- Colored status `<select>` on each card footer
- Filter bar: filter by status
- **Files:** `src/applications.ts` (new), `src/dashboard.ts`

#### 1.4 Export ✅
- `GET /api/export.csv` — all history as CSV (title, company, source, location, salary, score, alerted, status, url)
- "Export CSV" download link in dashboard header
- **Files:** `src/dashboard.ts`

---

### Phase 2 — Smarter Alerts (not started) → v1.1.0

**Theme:** Reduce noise, increase signal in what gets emailed.

#### 2.1 Score-Gated Alerts
- Config option: `minScore: 60` — only email jobs that score ≥ threshold
- Requires scoring to run before email (auto-score becomes mandatory if `minScore` set)
- Fallback: if Ollama unavailable, send all matches with a warning line in email
- **Files:** `src/index.ts`, `src/scorer.ts`, `src/config.ts`

#### 2.2 Daily Digest Mode
- Config option: `digestSchedule: "daily"` — batch all matches since last digest into one email
- Runs on cron at a configurable time (`digestTime: "08:00"`)
- Separate from check interval (can check every 15 min, email once/day)
- **Files:** `src/index.ts`, `src/notifier.ts`, `src/config.ts`

#### 2.3 Notification Channels
- Webhook support: `notify: { webhook: "https://..." }` — POST JSON payload on new matches
- Works with Slack, Discord, Make, Zapier out of the box (standard webhook shape)
- Email remains default; webhook is additive
- **Files:** new `src/notifier-webhook.ts`, `src/notifier.ts`, `src/config.ts`

#### 2.4 Per-Job "Ignore" / "Snooze"
- Dashboard: right-click or three-dot menu → "Never show again" / "Snooze 7 days"
- Persisted to `ignored_jobs.json`
- Ignored stateKeys excluded from future email and dashboard
- **Files:** new `src/ignored.ts`, `src/dashboard.ts`, `src/index.ts`

---

### Phase 3 — Setup & Reliability (not started) → v1.2.0

**Theme:** Reduce friction for setup, and make the tool trustworthy over weeks of use.

#### 3.1 Web-Based Config Editor
- Dashboard settings page (new tab): edit `config.json` fields via form
- Fields: job titles, salary range, locations, email SMTP, AI scoring
- Save triggers config reload (Phase 1.x `/api/reload-config` ✅ already done)
- Does NOT expose SMTP password in UI — mask after initial entry
- **Files:** `src/dashboard.ts`

#### 3.2 Structured Logging
- Replace ad-hoc `console.log` with a minimal log library (level: info/warn/error)
- Log to file: `job-alerts.log` (configurable path, configurable level)
- Dashboard: `GET /api/logs` — last N lines, for in-browser debugging
- **Files:** new `src/logger.ts`, all source files

#### 3.3 Health & Status Dashboard Panel
- New "Status" tab in dashboard
- Shows: last check time, next check time, sources (last count, last error), Ollama status, email last sent
- Data from `GET /api/status`
- **Files:** `src/dashboard.ts`, `src/index.ts`

#### 3.4 Board Discovery Improvements
- `npm run probe` extended: suggest similar boards from curated list based on company name
- `validate-boards` parallelism configurable (current: 5 workers)
- Boards.json gets a `disabled: true` flag to skip without removing
- **Files:** `scripts/probe.ts`, `scripts/validate-boards.ts`, `src/registry.ts`

---

## Bug History

- *resolved* Posted date and alerted date could get out of sync due to local state changes during development
- *resolved* Map view showed "Posted Posted Today" due to a date formatting timing issue; fixed by converting to ISO at fetch time

---

## What Is Explicitly Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-user / auth | Personal tool; adds significant complexity with no personal benefit |
| Cloud hosting / containerization | Self-hosted is the absolute goal |
| Database  | 140 records in JSON is fast enough, time will tell if a more robust DB is needed |
| Mobile app | Browser is sufficient; responsive CSS handles small screens |
| Resume builder / editor | Out of scope; resume lives in a file |
| LinkedIn / Indeed scraping | TOS risk, other tools exist to do this well |
| Interview prep / coaching | A task handled better by real humans |
| Custom LLM hosting | Ollama already handles this |

---

## Success Metrics (Personal Tool)

- **Time to first alert after setup:** - Depends on time of day user sets up the tool
- **False positive rate:** < 20% of emailed jobs are irrelevant (measured by tracking "Ignored" status)
- **Score correlation:** Jobs scored 70+ have > 60% "Applied" rate (vs. < 30% for jobs scored below 50)
- **Dashboard weekly active use:** Tool opened and used at least 3x/week during active job search
