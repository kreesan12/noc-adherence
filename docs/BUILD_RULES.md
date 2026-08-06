# Build Rules

## Purpose

This document keeps the codebase modular so new features do not turn into large slow-loading pages.

## Route And Module Boundaries

- Keep one route per major capability.
- Avoid mega pages that load unrelated workflows together.
- Use route-level lazy loading for major screens.
- If a page grows beyond a comfortable review size, split it into feature components.

## Page Size Guidance

- Prefer keeping page files under roughly `700` lines.
- When a page passes that size, extract:
  - metrics/header blocks
  - filters
  - table sections
  - dialogs
  - chart panels
- Heavy tabs should live in separate components when possible.

## Data Loading Rules

- Prefer backend summary endpoints for dashboard cards and charts.
- Avoid making the frontend aggregate very large raw datasets.
- For slow sections, load per tab or per drilldown instead of all at once.
- Use server-side pagination or capped result sets for dense tables.

## Query Rules

- Expensive SLA and stock reporting views should read from prepared summary tables where practical.
- Keep filtering logic on the backend if it materially reduces payload size.
- Avoid duplicate fetches for the same date range and filter set.

## Bundle Discipline

- Watch the Vite chunk warnings during build.
- Prefer lazy imports for large feature pages and chart-heavy modules.
- Avoid adding browser-side libraries casually when the same task can be done with current tooling.
- Reuse shared helpers before introducing new utility packages.

## Shared Frontend Patterns

- Use `PageShell`, `FilterStrip`, and shared access helpers first.
- Prefer shared formatting helpers for money, dates, percentages, and counts.
- If the same card or panel appears in multiple features, extract it.

## Dialogs And Drawers

- Keep detail modals focused on one evidence chain or action.
- Move large edit flows into dedicated sections or extracted components if the dialog grows too large.

## Before Merging New Work

1. Run a frontend build.
2. Check for new large chunk warnings.
3. Check the page at normal zoom.
4. Confirm loading and error states.
5. Confirm role access logic.
6. Update docs if the pattern changed.

## Recommended Direction For Engineering

- Keep the current navigation-based structure for major engineering areas.
- Use tabs inside pages like `NLD Services`, `Stock Management`, or `SLA Reporting` where the user is staying inside one bounded domain.
- Do not merge all engineering functions into one giant tab screen, because it would make both the code and the data-loading path too heavy.
