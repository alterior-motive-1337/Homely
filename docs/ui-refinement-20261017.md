# Homely — visual refinement (17 October 2026)

This refinement uses the six supplied screenshots (Home, Issues, Repairs, Appliances and Files) as its baseline.

## Design contract

- Keep the main tabs as the only persistent view headings. Do not introduce decorative dashboard titles, extra metadata panels or second toolbars.
- Use a consistent centered maximum content width for files and records rather than stretching list rows across unlimited screen space.
- Keep a single toolbar row with hidden search, context filters when necessary, and icon-only actions with accessible labels.
- Each register entry has a compact, lightly bordered surface; the record title and asset/location stay to the left and cost/severity/condition at the trailing edge. Do not leave a large unused mid-column.
- Maintain plain status text and reserve color for actionable urgency, consistent with the existing semantic status rules.
- Home summary metrics should be grouped centrally without vacant columns. Counter values precede their labels.
- Give Home's lists the same quiet row rhythm as register entries, while keeping section headings unobtrusive and retaining links to full records.
- Preserve desktop/chat resize, drawer behavior, double-tap and Enter-to-open file controls, date/amount normalization and transaction previews.
- Screens at or below 700px retain compact single-column registers without horizontal scroll.

## QA

The browser regression suite checks metric count versus grid columns, right-aligned record details, centered files, controls and modal access, file fading, no viewport overflow on desktop and Android-like widths, and record approval flows. The baseline tests also protect accessible chat controls and file selection.

Visual review on a physical handset remains recommended; CI is Chromium emulation, not a hardware screenshot comparison.
