# UI Standards

## Purpose

This document keeps the frontend visually consistent as new modules are added.

## Page Structure

- Use `PageShell` for every major page route.
- Use `FilterStrip` for top-level controls, filters, refresh actions, and export actions.
- Use `SectionCard` or a local card wrapper only when the content area needs a titled panel.
- Reuse `AnalyticsPrimitives` for metric cards, chart fallbacks, and table empty/loading states before creating one-off dashboard widgets.
- Keep one clear page title and short description. Avoid repeating large hero headers inside the page body.
- Keep shared branding text in `frontend/src/config/brand.js` so login, shell, and landing copy stay aligned.

## Navigation Pattern

- Keep major work areas as separate routes in the left navigation.
- Use tabs inside a page only when the tabs are part of one bounded workflow or one data domain.
- Do not collapse the whole Engineering area into one mega tab page.
- Preferred pattern:
  - nav route per major capability
  - tabs within that capability page if the tabs share the same data context

## Layout Rules

- Optimize for normal desktop viewing at `100%` browser zoom.
- Prefer tighter spacing and smaller controls over oversized cards.
- Avoid full-page horizontal scrolling.
- If a table needs extra width, keep the scroll inside the table area rather than on the whole screen.
- Keep page-level spacing compact and consistent with the current shell.

## Card And Panel Style

- Rounded corners should stay soft, not overly pill-shaped.
- Use subtle gradients and restrained shadows.
- Lead metrics should be readable quickly, but not oversized.
- Supportive labels should use lighter text and tighter copy.
- Reuse the current teal/blue/slate visual system unless there is a deliberate feature reason to diverge.
- Login and landing screens should feel like part of the same product family as the authenticated shell, not like a separate app.

## Tables And Dense Data

- Default to compact rows.
- Tighten fixed-width columns aggressively where values are predictable.
- Wrap long descriptive text instead of letting it force the whole layout wider.
- Place filters above the table, not inside a large separate hero block.

## Charts

- Prefer fewer, clearer charts over many weak visuals.
- Use backend summaries where possible so charts load quickly.
- Keep chart headings and helper text to one line where practical.
- If a visual is not helping a decision, remove or simplify it.

## States

Every page should handle:

- loading
- empty state
- error state
- refresh state

These states should look intentional and not feel like fallback debug output.

## Admin And Access

- Admin users should inherit lower-role frontend access where appropriate.
- Do not duplicate access logic page by page.
- Use shared access helpers from `frontend/src/utils/access.js`.

## Before Shipping A New Page

1. Start with `PageShell`.
2. Add a compact control strip.
3. Reuse shared analytics primitives where they fit.
3. Check the page at normal zoom.
4. Confirm no page-level horizontal scroll.
5. Confirm loading, empty, and error states exist.
6. Confirm admin access inheritance behaves correctly.
