# job-alerts

A self-hosted job alert tool that polls company ATS boards and emails you a digest of new postings matching your title filters. Runs on a schedule or on demand.

**Supported sources:** Greenhouse, Lever, Ashby, Workday, USAJobs, Hacker News

---

## Requirements

- Node.js 18+
- An SMTP account for sending email (e.g. Gmail with an app password)

---

## Setup

```bash
git clone https://github.com/SirFuzzyWalls/job-alerts.git
cd job-alerts
npm install
cp config.example.json config.json
```

Open `config.json` and fill in your settings:

| Field | Description |
|---|---|
| `jobTitles` | List of title strings to match against (case-insensitive substring) |
| `intervalMinutes` | How often to poll in scheduled mode (default: 30) |
| `stateRetentionDays` | How many days to remember seen jobs before pruning them (default: 90) |
| `minSalary` | Optional — exclude jobs whose listed salary is entirely below this annual amount |
| `maxSalary` | Optional — exclude jobs whose listed salary is entirely above this annual amount |
| `sendIfNoSalary` | Whether to include jobs with no salary data when a salary filter is set (default: true) |
| `locations` | Optional allowlist — only include jobs whose location contains one of these strings (case-insensitive). `"United States"`, `"USA"`, and `"US"` are smart aliases that also match any US state abbreviation (e.g. `"San Francisco, CA"`). Omit to include all locations. |
| `sendIfNoLocation` | Whether to include jobs with no location data when `locations` is set (default: true) |
| `email.smtp` | SMTP credentials for outbound email |
| `email.to` | Address to send digests to |
| `email.from` | From address shown in the email |
| `usajobs.apiKey` | Optional — USAJobs API key for federal postings |
| `hackernews` | Optional — set to `true` to include recent YC/startup job posts from Hacker News (no API key needed) |
| `companies` | Which companies to monitor — see below |
| `excludeCompanies` | IDs to skip when using `"all"` — see below |

---

## Email setup (Gmail)

Gmail requires an **App Password** — a 16-character code that lets the app authenticate without your real password and without disabling account security. You need 2-Step Verification turned on first.

### Step 1 — Enable 2-Step Verification

If you haven't already:

1. Go to your [Google Account security settings](https://myaccount.google.com/security)
2. Under **"How you sign in to Google"**, click **2-Step Verification**
3. Follow the prompts to turn it on

### Step 2 — Create an App Password

1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (you must be signed in)
2. In the **"App name"** field, type something like `job-alerts`
3. Click **Create**
4. Google shows a 16-character password — copy it now (it won't be shown again)

> If you don't see the App Passwords page, make sure 2-Step Verification is fully enabled and that your account isn't a Google Workspace account with app passwords disabled by an admin.

### Step 3 — Fill in `config.json`

```json
"email": {
  "smtp": {
    "host": "smtp.gmail.com",
    "port": 587,
    "user": "you@gmail.com",
    "pass": "abcd efgh ijkl mnop"
  },
  "to": "you@gmail.com",
  "from": "Job Alerts <you@gmail.com>"
}
```

| Field | Value |
|---|---|
| `smtp.host` | `smtp.gmail.com` |
| `smtp.port` | `587` (TLS/STARTTLS — recommended) |
| `smtp.user` | Your full Gmail address |
| `smtp.pass` | The 16-character app password (spaces are ignored, include or omit them) |
| `to` | Where digests are sent — can be any address, including a different account |
| `from` | The display name and address shown in the email — must match your Gmail address |

### Using a different email provider

Any SMTP provider works. Update `host` and `port` to match:

| Provider | Host | Port |
|---|---|---|
| Outlook / Hotmail | `smtp.office365.com` | `587` |
| Yahoo Mail | `smtp.mail.yahoo.com` | `587` |
| Fastmail | `smtp.fastmail.com` | `587` |
| Self-hosted / other | Your server's SMTP hostname | Usually `587` or `465` |

For providers other than Gmail, use your regular account password or the provider's equivalent of an app password.

---

## Choosing which companies to monitor

### Monitor all registered companies (recommended)

Set `companies` to `"all"` to automatically monitor every company in `boards.json`. As the registry grows, new companies are picked up with no config changes needed.

```json
"companies": "all"
```

To skip specific companies, add their IDs to `excludeCompanies`:

```json
"companies": "all",
"excludeCompanies": ["twitch", "nubank"]
```

### Cherry-pick specific companies

Use IDs from `boards.json`:

```json
"companies": ["airbnb", "openai", "stripe", "dell"]
```

### Add a company not in the registry

Specify the ATS parameters directly as an inline object:

```json
"companies": [
  "airbnb",
  { "source": "greenhouse", "slug": "stripe" },
  { "source": "lever", "slug": "somecompany" },
  { "source": "ashby", "slug": "somecompany" },
  { "source": "workday", "company": "acme", "careerSite": "External_Careers", "subdomain": "wd5" }
]
```

You can mix IDs and inline objects freely. If you figure out the parameters for a new company, consider [opening a PR](#community-registry-boardsjson) to add it to the registry.

---

## Running

| Command | What it does |
|---|---|
| `npm start` | Run on a recurring schedule (uses `intervalMinutes`) |
| `npm run check` | Fetch once, send digest if matches found, then exit |
| `npm run dry-run` | Fetch jobs and print matches — **no email sent, no state saved** |
| `npm run dashboard` | Start the local web dashboard at `http://localhost:3737` |
| `npm run probe -- <url>` | Auto-detect ATS from a careers page URL, test the API, and interactively add to `boards.json` |
| `npm run validate-boards` | Probe every entry in `boards.json` and report pass/fail — exits 1 if any board returns 0 jobs |

### Dashboard

`npm run dashboard` starts a lightweight local web server (no extra dependencies) that lets you browse all previously sent job alerts without digging through your inbox.

```
npm run dashboard
# [dashboard] Listening on http://localhost:3737
```

Open `http://localhost:3737` in your browser. The dashboard reads `job_history.json`, which is written automatically after each successful email digest.

**Features:**
- Paginated card grid — 10 / 30 / 50 jobs per page
- Dark/light mode toggle (defaults to system preference, persisted across reloads)
- Each card shows title, company, source badge, location, salary, how long ago it was posted, and a direct link to the listing
- **New-job notifications** — while the dashboard is open, it polls the server every 30 seconds. If new jobs have been alerted since you loaded the page, a banner appears at the top:
  > *"3 new jobs available since you last loaded."*

  Click **Refresh now** to reload the grid, or **Dismiss** to hide the banner (it won't reappear for the same batch).

Set a custom port with the `PORT` environment variable:

```bash
PORT=8080 npm run dashboard
```

> `job_history.json` is created automatically and is excluded from version control. It is **not** populated by `npm run dry-run` — only real check runs that successfully send an email write to it.

### Dry-run

Use `npm run dry-run` to validate your config and boards before a real run:

```
[dry-run] Config OK. 3 company source(s): greenhouse:airbnb, ashby:openai, lever:plaid
[dry-run] Job title filters: Software Engineer, Backend Engineer
[dry-run] Fetching jobs (no email will be sent, no state saved)…

  greenhouse / Airbnb: 42 job(s) fetched
  ashby / OpenAI: 87 job(s) fetched
  lever / Plaid: 23 job(s) fetched

[dry-run] Total fetched: 152 | Title matches: 9
[dry-run] Matched jobs:
  · Software Engineer @ Airbnb | $150K–$200K/yr — https://…
  · Backend Engineer @ Plaid — https://…
  …

[dry-run] Done. No email sent, no state changed.
```

---

## Hacker News jobs

Set `"hackernews": true` in `config.json` to pull job posts from the [Hacker News job board](https://news.ycombinator.com/jobs). These are posted directly on HN, primarily by Y Combinator-backed startups. The public [Firebase API](https://github.com/HackerNews/API) returns up to 200 of the most recent postings — no account or API key required.

A few caveats:
- **Title/location parsing is best-effort.** HN post titles are free-form (e.g. `"Acme (YC W24) is hiring a Senior Engineer (Remote)"`), so company and role are extracted by pattern matching. The full title is always used as a fallback, so `jobTitles` filtering still works reliably.
- **Salary is not available.** HN job posts don't expose structured salary data. Set `sendIfNoSalary: true` (the default) to include them.
- **Location is often "Remote" or absent.** If you filter by `locations`, set `sendIfNoLocation: true` to avoid missing jobs that don't mention a location.

---

## Community registry (`boards.json`)

`boards.json` is a community-maintained list of ~65 verified company boards spanning Greenhouse, Ashby, Lever, and Workday. Using a registry ID is easier than looking up ATS-specific parameters yourself (especially Workday's `careerSite` and `subdomain` values).

**Note:** Some career platforms don't expose a public JSON API and cannot be monitored by this tool. This includes large tech companies (Google, Amazon, Apple, Meta) and government portals like **CalCareers** (calcareers.ca.gov), which uses ASP.NET server-side callbacks. If any of them ever adopts Greenhouse, Lever, Ashby, or Workday with a public board, they can be added to `boards.json` with no code changes. For US federal jobs, use the `usajobs` integration instead.

### Adding a company with `probe` (recommended)

`npm run probe` detects the ATS from a public job board URL, tests the API live, and writes the entry to `boards.json` interactively:

```
$ npm run probe -- https://boards.greenhouse.io/stripe

Detected: source=greenhouse  slug=stripe

Probing board...
Found 97 jobs. Sample titles:
  - Software Engineer, Payments
  - Senior Data Scientist
  - Product Manager, Risk

Company name? [Stripe]:
New entry: {"id":"stripe","name":"Stripe","source":"greenhouse","slug":"stripe"}
Add to boards.json? [y/N] y

Success! "Stripe" (stripe) added to boards.json.
```

Supported URL formats:

| ATS | Example URL |
|---|---|
| Greenhouse | `https://boards.greenhouse.io/{slug}` |
| Greenhouse | `https://job-boards.greenhouse.io/{slug}` |
| Lever | `https://jobs.lever.co/{slug}` |
| Ashby | `https://jobs.ashbyhq.com/{slug}` |
| Workday | `https://{company}.{subdomain}.myworkdayjobs.com/[{locale}/]{careerSite}` |
| Workday | `https://{subdomain}.myworkdaysite.com/recruiting/{company}/{careerSite}` |

`probe` also detects duplicates and warns if the board returns 0 jobs (private or empty board), letting you decide whether to add it anyway.

### Adding a company via PR (manual)

If you prefer to add an entry by hand, find the company's ATS and append a single JSON object to `boards.json`:

**Greenhouse / Lever / Ashby:**
```json
{ "id": "stripe", "name": "Stripe", "source": "greenhouse", "slug": "stripe" }
```

**Workday:**
```json
{ "id": "acme", "name": "Acme Corp", "source": "workday", "company": "acme", "careerSite": "External_Careers", "subdomain": "wd5" }
```

To find Workday params: go to the company's careers page and look at the URL — it follows the pattern `https://<company>.<subdomain>.myworkdayjobs.com/[<locale>/]<careerSite>`. Some companies omit the locale segment.

No TypeScript knowledge needed — a PR is just a one-line JSON diff.

### Validating the registry

`npm run validate-boards` probes every board in `boards.json` (5 concurrent requests) and prints a pass/fail summary:

```
Validating 82 boards...
  [PASS] Airbnb (134 jobs)
  [PASS] Stripe (97 jobs)
  [FAIL] SomeCo: 0 jobs returned (invalid slug, private board, or empty)
  ...
Summary: 81/82 boards healthy
```

Exits with code 1 if any board fails, making it usable as a pre/post regression check when adding new entries.

---

## How it works

1. On each run, jobs are fetched from all configured sources in parallel.
2. Job titles are matched case-insensitively against your `jobTitles` list. If salary filters are configured, jobs are also filtered by salary range (Lever, USAJobs, and Ashby expose salary data; Greenhouse and Workday do not). If `locations` is configured, jobs are filtered to those whose location contains any allowlist entry — `"United States"`, `"US"`, and `"USA"` are smart aliases that also match US state abbreviations (e.g. `"San Francisco, CA"`), so a single entry covers both in-office and US-specific remote postings.
3. **First run:** all matches are silently marked as seen — no email is sent. This prevents a blast of hundreds of jobs on a fresh install. From the second run onward, only genuinely new postings trigger an email.
4. New matches are emailed as a digest, sorted by posting date (most recent first). Each job shows how long ago it was posted (minute-level precision for same-day postings) and salary when available.
5. Previously seen jobs are tracked in `seen_jobs.json` (created automatically, do not commit). Entries older than `stateRetentionDays` (default 90) are pruned on each run to keep the file bounded. If an email send fails, state is not updated so jobs are retried next run.
6. After a successful email send, full job objects (title, company, salary, URL, etc.) are appended to `job_history.json` with the time the alert was sent. The local dashboard reads this file. Neither file should be committed — both are in `.gitignore`.
