# Three priority levels

Homely uses exactly three **issue priorities**:

| Priority | Label color | Meaning |
| --- | --- | --- |
| Low | Neutral gray | Can wait; no immediate intervention |
| Medium | Muted amber | Attention needed |
| High | Soft red | Prompt action required |

There is no separate **Critical** priority in new issue forms. Existing legacy `CRITICAL` records display as **High** without being rewritten; incoming legacy submissions map to `HIGH`. The stored issue status (`OPEN`, `IN_PROGRESS`, `RESOLVED`) remains independent of priority.

Everything that is **not a priority**—workflow status, appliance condition, billing cycle, maintenance state, membership, purchase state—has readable, neutral text. This avoids competing color meanings. All badges include text so they remain understandable without color.

New issue records store only `LOW`, `MEDIUM`, or `HIGH`. Existing household history, permanent repairs, and transaction rules are preserved. This is a display/API validation simplification, not a data migration.
