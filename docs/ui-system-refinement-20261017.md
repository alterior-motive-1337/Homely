# Homely — system-wide UI refinement

Date: 17 October 2026
Scope: Home, Issues, Repairs, Appliances, Files, record forms, settings, history, approval dialogs, file viewer, assistant, and sign-in. No schema or API changes.

## Design invariants

The UI remains an intentionally restrained, monochrome **record workspace**. The five main tabs are the only permanent navigation headings. Search is optional and stays collapsed by default; primary actions remain icon-only with accessible names. A record opens to its information and related evidence, not an unrelated metadata pane. The data and approved actions remain database-owned.

## Refinement checklist

- [x] One surface/typography/focus token group in `public/sketch.css` (`--ui-*`, `--homely-*`).
- [x] Navigation contrast and active-state legibility without additional decorative borders.
- [x] Home metrics, sections, routine record rows, and actions share a consistent visual rhythm.
- [x] Issues/Repairs/Appliances list alignment, secondary text contrast, search/filter hierarchy, and clear focus.
- [x] Files: compact rows, long-name fading, a clear selected-row indicator, and legible type glyphs and associations.
- [x] Forms: consistent label, input and textarea dimensions; readability, focus border and mobile scaling.
- [x] Dialogs: heading hierarchy, effective name for screen readers, compact close action, restrained detail grid, and usable mobile scrolling.
- [x] Settings: grouping by task, inline rename/invite actions on desktop, stacked controls on phones, without extra panels.
- [x] Viewer: clear title and action grouping, readable text/document presentation and analysis surface.
- [x] Assistant: quieter message spacing, legible markdown, clear role contrast and a single focusable composer; keep desktop dock and Android drawer.
- [x] Sign-in and temporary notifications use the same corner radius, contrast and control sizing.
- [x] Existing data, transaction preview → commit / reject, undo, search, uploads, and chat flows remain unchanged.

## Validation

`npm run build`, `npm test`, syntax checking, and the CI Chromium integration suite must pass before merge. The browser suite verifies navigation contrast, accessible modal headings, form dimensions, viewport overflow, compact file rows, lazy viewer loading and responsive behavior alongside all established record workflows.

**Manual validation remains:** manufacturer-specific Android keyboard/picker/PDF behavior and authenticated production layout. CI screenshots are emulated Chromium images, not photos or physical device screenshots.

## Subsequent architecture work

`public/sketch.css` contains historical iterations and specificity overrides; this pass limits further drift using shared tokens and scoped component rules. Extracting a clean cascade or fully splitting `public/app.js` is a separate, higher-risk migration requiring screenshot comparisons and a reliable release rollback, not an untested wholesale deletion.
