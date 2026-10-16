# Homely – mechanics & interaction refinement (17 Oct 2026)

This pass reviews functionality rather than adding interface chrome. The same five-tab structure, database-owned records, transaction preview/commit/undo model, local-first records, and restrained styling remain.

## Confirmed defects and corrections

1. **Home summaries were dead ends:** the issue/maintenance/repair rows displayed information but had no handler (the old `data-home-asset` click binding was unused). Render them as accessible, keyboard/touch actionable rows that open the original issue, repair, or a dedicated maintenance detail with due date, linked asset and a transaction-previewed completion action. Preserve section-level View all links.
2. **Automatic revalidation destroyed UI context:** a 45-second refresh replaced the DOM, clearing issue status filters, query text, expanded local search and selected evidence. Capture and restore these view-local values after a successful refresh; do not restore after the user changed tabs while the request was in flight.
3. **Asset load failure stranded the modal:** the catch path only displayed a toast, leaving the `Opening asset…` dialog indefinitely. Use the standard pending-generation close/error path.
4. **Upload cancellation did not cancel transmission:** closing a file form allowed staged chunks to continue uploading. Use an AbortController for start/chunk/finish, skip subsequent chunks on discard, and guard against duplicate submissions. Backend staged-upload expiration remains separate.
5. **Chat proposals allowed repeat actions:** approve/reject could be submitted again before an initial response. Both controls now become disabled during an in-flight request, with retry enabled after errors. Keep action state across conversation rerenders.
6. **Repeated and empty UI noise:** avoid showing a second `UNKNOWN` condition badge on assets, and avoid placing a filtered-empty notice beside the underlying empty-record notice.
7. **Redundant navigation:** clicking the active tab should not create another identical browser-history entry.
8. **File input accessibility:** replacing a source URL with a file input must bind its label to the newly-created input.

## Behavior and test contract

- Home issue shortcut opens the issue details and linked actions; maintenance opens the asset; repair opens its permanent work record.
- Filtering/searching/selection survive refresh, but not stale cross-tab responses.
- No duplicate approval commits or reject requests from repeated taps, even if chat rerenders.
- Closing uploads stops further file-chunk requests; users may reopen a fresh upload form.
- Every error leaves an actionable interface, never a stranded loading dialog.
- No schema changes, API contract changes, or deletions of household history.
- Desktop and Android remain covered by the established browser suite; add targeted tests in `test/browser-workspace.mjs`.

## Deferred / manual validation

A physical Android handset is still required for vendor-specific PDF viewers, keyboard resize, screen readers, file-picking behavior and OS Back gesture. Avoid promising a physical-device pass from Chromium emulation.
