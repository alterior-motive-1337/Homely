# Status labels and color rules

## Purpose

Every Homely view uses the same readable language for statuses, conditions, priorities, histories and options. Stored values remain the original backend codes: changing display text must never alter what is submitted or stored.

## Three semantic tones

| Tone | Appearance | Meaning | Examples |
| --- | --- | --- | --- |
| Neutral | Light gray text | Routine state, information, completed record or unspecified condition | Open, In progress, Planned, Monitoring, New, Good, Fair, Low, Resolved, Saved, Active |
| Attention | Muted amber text | Needs examination or planned attention, but is not an immediate failure | Medium, High, Poor, Degraded, Due soon |
| Urgent | Soft red text | Critical, failed or overdue condition requiring prompt action | Critical, Failed, Overdue, Emergency, Past due |

Color appears **only on the status label**, never as a row background, card fill, decorative dot, or tinted action button. The text is always present, so meaning does not depend on color alone. Other unfamiliar states default to neutral until deliberately classified.

**Historical issues:** Once an issue is Resolved or Closed, its old severity no longer appears as an active colored urgency indicator in the main register; severity remains accessible in the record detail/history.

## Labels

- Enum-style codes use human sentence case: `IN_PROGRESS` → **In progress**, `SHORTLISTED` → **Shortlisted**, `MONTHLY` → **Monthly**.
- Form option visible text is human-readable, while the `value` attribute remains the exact server code (`MEDIUM`, `FAIR`, etc).
- Audit action types receive short descriptions rather than implementation names: `REPORT_ISSUE` → **Issue reported**, `RECORD_REPAIR` → **Repair recorded**.
- Common machine-style asset categories are normalized; user-entered names, locations and acronyms are preserved.
- Navigation labels and domain naming remain otherwise unchanged.

## Verification

Unit tests cover tone classification, display labels, category text, and unchanged enum input values. Browser tests verify the sample home shows neutral Fair, amber Poor and red Failed, and that status labels and form option values remain distinct. Keep the existing desktop, Android, search, file, approval and viewer suite green.

This pass does not modify household data, API contracts or persistence.
