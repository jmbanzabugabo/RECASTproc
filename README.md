# CASTmir — AI Performance and Security Monitor

A Grammarly for AI interactions: prompt coaching and security, together. A browser
extension captures prompt activity across supported AI applications, three agents analyse
quality and security, and two dashboards report personal and organisational insight.

    design/    The system design — one self-contained page, 7 screens
    system/    The working system — extension, API, agents, live dashboards

## Quick start

    node system/server/server.js       # http://localhost:8080

Then open the home page and follow the install steps. Full instructions: [system/README.md](system/README.md).

## The three agents

| Agent | Does |
| --- | --- |
| Prompt Coach | Scores clarity, context, specificity, structure and output instructions; proposes a revision |
| Security Agent | Detects PII, credentials, confidential content and prompt injection; observes, warns, redacts or blocks |
| Model Tracker | Records platform, model and version per prompt so quality and drift can be compared |

## Privacy boundary

The extension never writes to the dashboard store. Every event passes through the prompt
processing API, the agents, and the redaction layer before it becomes an analytics event.
Storage mode is set per organisation: full, redacted, metadata only, or nothing.

## Deploying

AWS App Runner, step by step: [system/DEPLOY-AWS.md](system/DEPLOY-AWS.md). Set
`CASTMIR_S3_BUCKET` so captured data survives redeploys, and keep max instances at 1.

## Design reference

`design/index.html` opens in any browser — architecture, extension overlay, user dashboard,
prompt/PMI diff, security, admin dashboard and the backend contracts.
