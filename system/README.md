# CASTmir — working system

Three parts, no build step and no npm dependencies:

    system/extension/   MV3 browser extension (Chrome, Edge, Brave)
    system/server/      API, the three agents, analytics engine, JSON store
    system/public/      Landing + install page, live user dashboard, live admin dashboard

## Run the server

    cd system
    node server/server.js
    # http://localhost:8080

Environment variables: `PORT` (default 8080), `CASTMIR_DATA` (data directory),
`CASTMIR_ADMIN_KEY` (required for `PUT /v1/org/policy`, default `castmir-admin`).

Docker:

    docker build -f system/server/Dockerfile -t castmir system
    docker run -p 8080:8080 castmir

AWS App Runner: see **[DEPLOY-AWS.md](DEPLOY-AWS.md)** — source directory `system`, port 8080,
health check `/v1/health`, and `CASTMIR_S3_BUCKET` for durable storage.
Render / Railway / Fly: start command `node server/server.js`, root `system`.

## Install the extension

Open the running server's home page and follow the seven steps there, or:

1. Download `/download/castmir-extension.zip` from the server (the server bakes its own URL
   into the download, so there is nothing to configure).
2. Unzip it. Keep the `castmir-extension` folder.
3. Go to `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**.
4. **Load unpacked** → select the `castmir-extension` folder.
5. Pin CASTmir to the toolbar.
6. Visit ChatGPT, Claude, Gemini, Copilot or Perplexity and **approve the site** on the
   consent card. Nothing is captured before you approve.
7. Send a prompt. CASTmir scores it, scans it, and shows the coaching panel before the
   prompt leaves the browser. The dashboards update live.

## What is captured

At submit time only: the prompt text, the host, the model label shown by the site, and a
user id generated on install. Not the page, not the AI response. The server applies the
organisation storage mode before anything is written:

| Mode | Stored |
| --- | --- |
| `full` | Original and revised prompt verbatim |
| `redacted` (default) | Prompt with detected sensitive spans replaced by tokens |
| `metadata` | Scores, findings and model only |
| `none` | Scores and findings only, no prompt reference |

## API

    POST /v1/prompts/analyze          coach + security decision at submit time
    POST /v1/prompts/:id/outcome      attach a response rating
    POST /v1/coaching/:id/accept      record that a revision was applied
    GET  /v1/me/dashboard             personal scores, drift, risks, recommendations
    GET  /v1/me/prompts               coached prompt history with diffs
    GET  /v1/users                    known users and departments
    GET  /v1/org/overview             org KPIs, departments, models, trend
    GET  /v1/org/security/events      aggregated findings (no prompt bodies)
    GET  /v1/org/recommendations      cohort-level recommended actions
    GET  /v1/org/segments?by=...      rollups by category, college, department, programme
    GET  /v1/org/policy               active policy
    PUT  /v1/org/policy               change policy (X-CASTmir-Key: admin key)
    GET  /v1/patches/check            signed rule/detector bundle for clients
    GET  /v1/health                   liveness

## Directory integration (prepared for v2)

A *user* is anyone whose prompts are monitored — student, staff, faculty, employee,
customer. Every user record already carries `category`, `college`, `department`,
`program` and `external_id`; today they are self-reported in extension settings and
default to `Unassigned`. When CASTmir is connected to the university management system,
the same fields are filled from the directory and every rollup segments by them with no
schema change:

    GET  /v1/directory/users          current records + the expected schema
    GET  /v1/directory/users/:id      one user
    PUT  /v1/directory/users/:id      update one user (X-CASTmir-Key: admin key)
    POST /v1/directory/sync           bulk upsert from the management system (admin key)

Bulk payload:

    { "users": [
      { "user_id": "user-8a12", "external_id": "S2026114", "display_name": "…",
        "category": "Student", "college": "College of Engineering",
        "department": "Computer Science", "program": "BSc Software Engineering" }
    ] }

The admin dashboard's **Segments** panel switches between category, college, department
and programme; each shows users, prompts, quality, improvement, findings and risk band.
Panels read "no values yet" until the sync runs.

## Silent updates

Detectors, scoring weights and policy live on the server. The extension refreshes them
hourly from `/v1/patches/check` and stores the bundle locally. Rule changes therefore
need no reinstall; only permission-level releases require a new package.

## Data

`system/server/data/castmir.json` — created on first write. Delete it to reset the pilot.
Swap `store.js` for Postgres or DynamoDB when you outgrow a single node.
