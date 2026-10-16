# Homely Android ↔ desktop parity

## Product behavior, not pixel identity

Homely exposes the same five records tabs, account settings, sign-out, alerts (when present), file evidence, transaction previews, and AI conversation history on both surfaces.

Desktop retains an optional resizable docked assistant; handheld and tablets below 960 CSS pixels use a dismissible chat drawer with the same conversation state and controls. On Android, Browser Back should dismiss the open assistant **without changing the selected record tab**, and Forward may restore it.

File selection is a single tap/click; the same record opens by touch double-tap, mouse double-click or keyboard Enter. Files remain accessible after an interrupted upload or missing preview. PDFs provide both inline preview (where supported) and explicit Open/Download alternatives.

## Responsive contract

| Surface | Navigation and controls | Chat | Forms |
| --- | --- | --- | --- |
| Desktop >=960 CSS px | Five navigation tabs, account controls, alerts | Dockable/resizable/full-width | Existing compact typography |
| Android/tablet <=959 CSS px | Same five tabs, same account and alerts controls | Visual-viewport-sized overlay, close and Back navigation | 16px inputs for coarse touch, >=44px icon targets |
| Compact Android <=412 CSS px | Horizontally reachable nav; no body x-overflow | Fits dynamic viewport and bottom safe area | Accessible modal close and readable field labels |

Browser resize and device orientation must preserve data and navigation without crashing. Animations may not delay selected file feedback.

## Logic fixes checked with this pass

- Date-only evidence, issue and repair fields represent **local calendar days**, not UTC midnight (which shifts dates in negative-offset time zones).
- Stale alert fetches must not reopen a modal the user has dismissed.
- Repeated toast messages must not be cleared by the previous message's timer.
- PDF evidence must remain openable when Android's inline PDF renderer is unavailable.

## Automated verification

`test/browser-workspace.mjs` tests Android-like touch emulation at widths 320, 360, 390, 412, 768 and 959; verifies desktop transition at 960; checks controls, overflow, form typography, back/forward behavior and chat viewport. Existing tests cover desktop list/search/workspace resizing, file double-tap and keyboard use, and record approvals.

`test/ui-normalization.test.mjs` tests calendar-only date parsing and invalid dates.

**Device caveat:** CI emulates Android pointer/viewport behavior in Chromium; it cannot fully reproduce every manufacturer keyboard, OS Back gesture, PDF handler or safe-area inset. Actual handset testing is still warranted after deployment.
