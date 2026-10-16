# Homely UI and application-flow normalization

## Invariants

The database is authoritative. Records and their audit history are not deleted to simplify presentation. Issues and repairs remain permanent, while reversible proposals retain their established preview, approval, commit and undo rules.

The frontend owns **presentation** only, with the following contracts:

| Concern | Canonical implementation | Rule |
|---|---|---|
| Household currency | `src/domain/currency.ts` -> `/api/overview.currency` -> `public/ui-normalization.js` | Format stored minor units; use supplied code/locale; do not interpret a foreign source price as ZAR |
| Input amounts | `majorToMinorAmount`/`minorToMajorAmount` | All record forms use the same conversion and nullable semantics |
| Form dates | `localDateInput` | Display today's local calendar date, not UTC's date |
| Status labels | `normalizeStatus`, `statusLabel`, `statusTone` | Canonical record states are unchanged; only urgent states get an alarm color, attention states use text emphasis, routine states remain neutral |
| Register search | `bindCollectionSearch` | Issues, repairs, appliances and files use the same matching, visible count and empty-state logic; issue status is an additional predicate |
| Record actions | `registerAction`, `linkedFilesButton` | Icon actions must carry an accessible name and title and continue using the existing handler IDs |
| Record proposals | `bindPreviewForm` + `previewAction` | All standard forms validate/build their payload then preview, explicitly approve or reject, commit and refresh |
| Async modal work | `waitingModal` + `modalGeneration` | Results from closed/replaced modals may not reopen a stale flow |
| Navigation | `selectView` and `viewPanels` | Keep tab state when returning quickly; invalidate stale views when a transaction commits |

## UI conventions

- Main views remain Home, Issues, Repairs, Appliances and Files.
- Use lists rather than duplicated page cards or table headings.
- The minimal sidebar and chat toolbar stay visible where appropriate.
- Keep controls discoverable with visible focus outlines, titles and ARIA names.
- File selection uses a fine outline; double-click, double-tap and Enter open the viewer.
- Do not add an independent color for each technical state.
- Preserve plain-language states and clear monetary units in detail and edit surfaces.

## Test and deployment checkpoints

1. `npm run build` compiles the server and tests.
2. `npm test` covers stored record invariants and pure UI normalization.
3. `node --check public/app.js` checks the browser entry module.
4. Browser integration tests cover navigation cache, search, resize, approval, documents, and touch input.
5. Merge only with green CI and review the live Render deployment after the merge.
6. Manual visual QA remains necessary for small screens and authenticated production data.

## Scope of this pass

No migrations, API schema changes, permission changes or altered retention rules. The source of truth remains in existing domain services. Frontend utilities, form handling, search/filter logic, visual status semantics, and asynchronous handoffs are made consistent without replacing the app.

## Follow-up work

The large `public/sketch.css` file still contains historical override blocks. A future design-system cleanup should consolidate those **with screenshot-based regression checks**, not add another stylesheet or wholesale delete overrides without testing. The same applies to splitting `public/app.js` into modules: only after the current contracts are covered.

## Chat names and reduced information density (October 2026)

- The narrow/mobile chat launcher is icon-only with an accessible name and a 52 px touch target.
- The active conversation title is visible in the chat header and directly editable. Renaming is scoped to the signed-in user and household. Initial titles are derived locally from the first user message; historical generated titles receive a presentation-only cleanup.
- Home keeps the registered-asset count, shows only nonzero problem metrics, and removes the redundant recent-record strip. Other home records remain reachable via their views or history.
- Registers prioritize title and associated asset; issue urgency, repair cost, and exceptional condition remain visible when useful. Record dates, routine statuses, purchase prices, actions, and related files remain in the open-record detail views.
- No record or audit data is deleted to simplify the interface. Search and filtering remain supported.

