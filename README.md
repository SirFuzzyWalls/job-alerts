# job-alerts

A self-hosted job alert tool that polls company ATS boards and emails you a digest of new postings matching your title filters. Runs on a schedule or on demand.

**Supported sources:** Greenhouse, Lever, Ashby, Workday, USAJobs

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
| `email.smtp` | SMTP credentials for outbound email |
| `email.to` | Address to send digests to |
| `email.from` | From address shown in the email |
| `usajobs.apiKey` | Optional — USAJobs API key for federal postings |
| `companies` | List of companies to monitor (see below) |

---

## Adding companies to monitor

### Option 1 — String ID (recommended)

Use an ID from the community registry (`boards.json`):

```json
"companies": ["airbnb", "openai", "plaid", "dell"]
```

### Option 2 — Inline object (escape hatch for unlisted companies)

Specify the source and its parameters directly:

```json
"companies": [
  { "source": "greenhouse", "slug": "stripe" },
  { "source": "lever", "slug": "reddit" },
  { "source": "ashby", "slug": "linear" },
  { "source": "workday", "company": "amazon", "careerSite": "External_Careers", "subdomain": "wd5" }
]
```

You can mix both styles freely:

```json
"companies": ["airbnb", "openai", { "source": "greenhouse", "slug": "stripe" }]
```

---

## Running

| Command | What it does |
|---|---|
| `npm start` | Run on a recurring schedule (uses `intervalMinutes`) |
| `npm run check` | Fetch once, send digest if matches found, then exit |
| `npm run dry-run` | Fetch jobs and print matches — **no email sent, no state saved** |

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
  · Software Engineer @ Airbnb — https://…
  …

[dry-run] Done. No email sent, no state changed.
```

---

## Community registry (`boards.json`)

`boards.json` is a community-maintained list of verified company boards. Using a registry ID is easier than looking up ATS-specific parameters (especially Workday's `careerSite` and `subdomain`).

### Adding a company via PR

Find the company's ATS, then add a single JSON object to `boards.json` in alphabetical order by `name`:

**Greenhouse / Lever / Ashby:**
```json
{ "id": "stripe", "name": "Stripe", "source": "greenhouse", "slug": "stripe" }
```

**Workday:**
```json
{ "id": "amazon", "name": "Amazon", "source": "workday", "company": "amazon", "careerSite": "External_Careers", "subdomain": "wd5" }
```

To find Workday params: go to the company's careers page and look at the URL — it typically follows the pattern `https://<subdomain>.wd<N>.myworkdayjobs.com/<careerSite>/`.

No TypeScript knowledge needed — a PR is just a one-line JSON diff.

---

## How it works

1. On each run, jobs are fetched from all configured sources in parallel.
2. Job titles are matched case-insensitively against your `jobTitles` list.
3. Previously seen jobs are tracked in `state.json` (created automatically, do not commit).
4. New matches are sent as an email digest. If the email send fails, state is not updated so jobs are retried next run.
