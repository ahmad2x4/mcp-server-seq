---
name: seq-ops
description: >
  Expert Seq log analysis for DevOps — use for incident investigation, system
  health checks, error pattern detection, and post-deployment monitoring. Invoke
  proactively whenever the user mentions alerts, errors in dev or prod, something
  being broken or slow, log queries, or asks to "check the system". Also use for
  morning health checks, deployment follow-ups, or any time you'd naturally want
  to look at structured logs to answer a question.
compatibility: Requires the mcp-server-seq MCP server. Install with: claude mcp add --transport stdio --env SEQ_BASE_URL=<url> --env SEQ_API_KEY=<key> seq -- npx -y mcp-seq
---

# Seq Operations

You have three tools from the `seq` MCP server:

| Tool | Purpose |
|------|---------|
| `seq:get_alert_state` | Current state of all configured alerts (firing / ok / suppressed) |
| `seq:get_signals` | List saved named filters — call this early to discover available signal IDs |
| `seq:get_events` | Query structured log events with filters, time ranges, and pagination |

## Setup (for users installing this skill)

```bash
claude mcp add --transport stdio \
  --env SEQ_BASE_URL=http://localhost:5341 \
  --env SEQ_API_KEY=your-api-key \
  seq -- npx -y mcp-seq
```

---

## Investigation Workflow

Follow this sequence — don't jump straight to events without first knowing what signals exist.

### Step 1 — Orient
Always start here:
1. `seq:get_alert_state` → any currently firing alerts?
2. `seq:get_signals` → what named filters exist? Note their IDs — they're your shortcuts.

### Step 2 — Scope
Pick a time range based on what you know:
- Vague request ("check the system") → `range: "4h"`
- Active incident reported N minutes ago → `range: "1h"` or tighter
- Post-deployment → target the window after the deploy time

### Step 3 — Query
When investigating a reported symptom, start by searching for the **literal terms** the user mentioned before expanding. If someone says "timeout errors", first run:
```
filter: @Message like '%timeout%' or @Exception like '%TimeoutException%'
```
This grounds your investigation in what was actually reported and avoids missing the specific thing that triggered the alert.

Then broaden — even when focused on a named service, always run a parallel broad error query for the same timeframe:
```
# Literal symptom first (match what was reported)
filter: @Message like '%<symptom>%'

# Targeted service query
filter: @Level in ['Error', 'Fatal'] and Application = 'my-service'

# Broad sweep — same window, all services
filter: @Level in ['Error', 'Fatal']
range: "1h"
```

The service the user names is often a red herring or just one part of a larger incident. Running the broad sweep catches adjacent failures happening simultaneously.

Use `render: true` to get human-readable messages instead of raw templates.

Use `after: <lastEventId>` to paginate if results are truncated.

### Step 4 — Pattern
Before concluding, ask:
- Is this error new or pre-existing?
- Is frequency increasing, stable, or spiking?
- Is it isolated to one service or spreading?
- Does timing correlate with a deployment or traffic change?
- Is there a more severe concurrent issue in a different service?

---

## Seq Query Syntax Reference

```
# Level filtering
@Level = 'Error'
@Level in ['Error', 'Fatal']

# Text search
@Message like '%timeout%'
@Exception like '%NullReferenceException%'

# Property filters
StatusCode >= 500
RequestPath like '/api/checkout%'
Application = 'my-service'
UserId = 'user-123'

# Combining
@Level = 'Error' and Application = 'payments' and StatusCode >= 500

# Time range shortcuts: 1m, 15m, 30m, 1h, 2h, 6h, 12h, 1d, 7d, 14d, 30d
```

---

## Severity Classification

| Severity | Criteria | Response |
|----------|----------|----------|
| **P0** | Multiple services down, revenue/data impact | Immediate escalation |
| **P1** | Single critical service failing | Urgent investigation |
| **P2** | Degraded performance, partial failures | Investigate within the hour |
| **P3** | Low-frequency errors, no user impact | Monitor and schedule |

---

## Output Format

Always present findings in this structure:

```
**IMMEDIATE ACTIONS REQUIRED**
[P0/P1 issues that need attention right now, or "None"]

**TRENDING CONCERNS**
[Patterns that are worsening or worth watching]

**SYSTEM HEALTH**
[Overall assessment — services checked, error rates, notable patterns]

**RECOMMENDATIONS**
[Specific next steps: what to investigate further, what to fix, what to monitor]
```

Include **specific identifiers** wherever found: workspace IDs, transaction IDs, request IDs, user emails, parameter store paths, Lambda names, file+line numbers. These are what engineers need to take action — a report that says "there was a NullReferenceException in the payment service" is far less useful than one that also says "AlaresDataSource.cs:55, ReportWorkspaceId: 09c03054, Lambda: run-report-workspace-stage-function-prod".

Keep it actionable — the person reading this may be mid-incident. Lead with what matters most.

---

## Common Scenarios

**Morning health check**
→ `get_alert_state` + `get_events` with `range: "8h"`, `filter: @Level in ['Error', 'Fatal']`
→ Note any services with unusually high error counts compared to normal

**Active incident**
→ Start with `get_alert_state` to confirm scope, then zoom into the affected service
→ Look for the first occurrence of the error — when did it start?
→ Check if it correlates with a deployment or config change

**Post-deployment monitoring**
→ Compare error rates before and after the deploy time
→ Watch for new exception types that didn't exist pre-deploy
→ Check downstream services for cascading effects

**Performance investigation**
→ `filter: ResponseTime > 5000` (adjust threshold to context)
→ Look for timeout patterns: `@Message like '%timeout%' or @Exception like '%TimeoutException%'`
