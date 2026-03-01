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
