# Simple label families

All rank-like and major lifecycle labels shown in Homely are limited to three choices.

| Family | Visible choices | Legacy mapping |
| --- | --- | --- |
| Issue priority | Low / Medium / High | Critical → High (already implemented) |
| Asset condition | Good / Fair / Poor | Failed → Poor; New and Unknown → Not assessed |
| Calculated health | Good / Fair / Poor | Healthy → Good; Attention/Degraded → Fair; Failed → Poor; Unknown → Not assessed |
| Issue progress | Open / In progress / Resolved | Planned → Open, Monitoring → In progress, Closed → Resolved |
| Potential purchase outcome | Saved / Purchased / Dismissed | Shortlisted → Saved |

**Not assessed** is an absence of a grade, not a fourth ranking level. Asset forms allow leaving this unanswered instead of claiming an unobserved item is Good or Fair.

The purchase form initially saves an entry. Edit controls expose only Saved/Purchased/Dismissed. Previously Shortlisted entries continue to store SHORTLISTED unless deliberately changed, despite displaying Saved. Similarly, existing NEW and FAILED asset-condition codes remain unchanged when other details are edited.

Billing cycles, file/document types, charge Active/Inactive, membership roles and audit status are descriptive or functional distinctions, **not rank families**. Do not collapse these into arbitrary triples and silently lose their meanings.

No data migration, backfill or historical rewrite. Database values remain source-of-truth, and the mapping is a presentation rule. This is a readability change: all family labels are neutral text except issue priority, which retains the agreed gray/amber/red scale.

## QA

- Unit tests for every legacy mapping, including unknown/unassessed data.
- Browser tests for asset condition and purchase option counts and preservation of legacy values while editing.
- Existing responsive, transaction, file, chat and navigation regression suite.
