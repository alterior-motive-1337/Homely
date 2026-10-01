# Foundation verification

This pull request exists to exercise Homely's repository CI against the Phase 1–2 substrate already on `main`.

The workflow validates:

- TypeScript compilation
- deterministic health tests
- SQLite migrations
- seeded demo state
- server startup
- overview/API state
- asset history
- local document resolution

No product behavior is changed by this file.
