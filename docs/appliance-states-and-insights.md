# Appliance state and household insights

## Product intent
Appliance labels describe *what a homeowner can do*, not an arbitrary Good/Fair/Poor numerical grade. Issue priorities remain Low / Medium / High; this does not add additional priority levels.

### Appliance operational states
| Shown | Meaning | Signal |
| --- | --- | --- |
| **Working** (green) | Recorded as functional with no outstanding service indicators | GOOD condition, no open issues/overdue maintenance |
| **Needs attention** (amber) | Unresolved issues, overdue work or a condition requiring care | FAIR/POOR condition, or derived ATTENTION/DEGRADED/FAILED health |
| **Out of service** (red) | Explicitly recorded as failed | FAILED condition only; a high-priority issue alone does not prove an outage |
| **Not assessed** (gray) | No reliable operational assessment | UNKNOWN/NEW condition without unresolved issue or overdue work |

The first three are operational outcomes; **Not assessed** is the absence of a rating. Existing codes continue to be stored unchanged, and editing other fields preserves the historical code where possible.

### Label design
All user-facing status labels use short text, a visible border and a subtle tinted surface. Colors mean:
- Neutral gray: unknown/ordinary
- Green: confirmed positive outcome, e.g. Working/Resolved
- Amber: needs attention
- Red: explicit failure/overdue/high issue priority

The words remain visible: color is supplementary, not the sole carrier of meaning. Do not paint entire records or add decorative color legends or badges to every metric.

## Analyses
All calculations are deterministic and use the currently selected, access-controlled home; no external AI services, background collection, speculation or hidden scoring.

- **Appliance attention:** count of Needs attention and Out of service records, with Not assessed disclosed separately. Derived from recorded condition, unresolved issues and overdue maintenance.
- **Recorded repair spend (past 365 days):** sums only recorded, non-negative cost entries within that date window. Counts repairs without cost separately. Never silently treats an absent cost as zero expenditure.
- **Monthly charge estimate:** active Monthly + Quarterly/3 + Annual/12, rounded to cents *after* summing. OTHER or invalid frequency is excluded and reported. This is not a spending forecast.
- **Per-asset record facts:** number of unresolved issues, repairs, recorded repair cost where available, and overdue maintenance entries.

Home shows at most three compact insight rows and links each to the matching existing workflow. Data in the appliance modal is source-backed, not a prediction of failure or safety.

## Data flow
`src/domain/applianceState.ts` → `listAssets/getAsset` expose `operational_state`.
`src/domain/insights.ts` → `getOverview().insights` sums already scoped household records.
`public/app.js` renders badges and insight rows and uses the existing tools and routes. SQLite/API persistence schemas and transaction semantics are unchanged.

## QA
- Unit tests for status classification, legacy values, unknown/missing data, temporal boundaries, and billing normalization.
- Full browser regression suite covers visual pill border/fill contrast, sample-home status representation, Home insights and click-through behavior, mobile/desktop layouts, forms, search, files and approval actions.
- Live Render and a real Android handset still need review after CI and deployment.
