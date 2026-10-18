# Homely canonical product model — 2026-10-04

Homely is the persistent operating memory for one physical home.

## Product promise

Years later, Homely should be able to answer what happened to the home, which asset was involved, when it happened, what evidence exists, what it cost, what was decided, what was repaired or replaced, and what is due next. The AI layer reasons over structured home state. It is not the source of truth.

## Primary user-facing records

- **Issues** — faults or problems. Issue identity/history is retained after resolution.
- **Repairs** — completed repair events with date, cost, contractor, outcome, linked issue/asset and evidence. Repair records are append-only from normal product flows.
- **Appliances and furniture / assets** — purchase/acquisition timing, price, condition, location, model/serial/warranty, related issues, repairs and files.
- **Files** — receipts, invoices, manuals, photos, videos, links and other household evidence with provenance, timestamps and associations.
- **Charges** — recurring household costs.
- **Potential purchases** — saved research/shortlists tied to a budget and source.
- **Timeline** — unified historical projection over all important records.

Maintenance, projects and transactions remain domain capabilities but do not need to dominate the primary navigation.

## Agent contract

The agent may explain recorded state/evidence, accept natural-language issue descriptions, propose state changes, search for local services using a location supplied by the user, search for products under a stated budget, read selected web pages, surface urgent actions, and help plan how to stock or furnish the home.

The agent may not directly commit authoritative state. Mutations remain **propose → human approval → commit → audit**, with undo where the record type is reversible.

## Interface contract

Primary navigation: Home, Issues, Repairs, Appliances, Files. A compact Homely chat surface should remain available throughout normal tabs. The dedicated file viewer is intentionally simple and does not need AI controls.

Turso is the required authoritative database; the local replica is a disposable cache. Only Turso URL/token, Groq key and Exa key require application configuration.

The UI should be minimal, modern and readable, prioritizing current home state, active problems and evidence rather than visual noise. Home keeps compact summaries; Charges, Potential Purchases and full History open from Home. The POC opens without a shared-password gate. Branding is a stick-house outline, including the browser-tab favicon.

A new empty household should have a calm, action-oriented starting point that links to the existing asset registration, evidence capture, and household settings flows. It should encourage starting with known details, make clear that invitations are optional, and yield to the real household overview after records are added.
