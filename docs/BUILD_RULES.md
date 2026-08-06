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
- Heavy page tabs should be lazy-loaded when they can stand alone cleanly, especially on analytics pages.
- Browser-side export libraries like `xlsx` should be loaded on demand inside export handlers instead of at route load.
- Avoid adding browser-side libraries casually when the same task can be done with current tooling.
- Reuse shared helpers before introducing new utility packages.

## Shared Frontend Patterns

- Use `PageShell`, `FilterStrip`, and shared access helpers first.
- Use `frontend/src/config/brand.js` as the single source for shell/login product naming.
- Use `frontend/src/components/ui/AnalyticsPrimitives.jsx` before creating new dashboard card/fallback variants.
- Prefer shared formatting helpers for money, dates, percentages, and counts.
- If the same card or panel appears in multiple features, extract it.

## Dialogs And Drawers

- Keep detail modals focused on one evidence chain or action.
- Move large edit flows into dedicated sections or extracted components if the dialog grows too large.

## Before Merging New Work

1. Run a frontend build.
2. Check for new large chunk warnings.
3. Check whether new imports belong in a manual chunk or a lazy-loaded panel.
4. Run the browser smoke harness locally:
   `npm --prefix frontend run smoke:local-build`
5. Check the page at normal zoom.
6. Confirm loading and error states.
7. Confirm role access logic.
8. Update docs if the pattern changed.

## Before Deploying To xneelo

1. Make sure the branch is committed and pushed.
2. Run the local browser smoke harness:
   `npm --prefix frontend run smoke:local-build`
3. Deploy on the API host:
   `ssh -i <pem> ubuntu@154.65.108.106 "bash /home/ubuntu/bin/update-noc-api.sh"`
4. Run the live browser smoke harness against production:
   `npm --prefix frontend run smoke -- --url https://154-65-108-106.sslip.io/ --waitMs 3000`
5. If the live smoke fails, stop and fix the issue before moving on.
6. Keep the smoke screenshot/report from `.smoke-artifacts/` with the release notes when the deploy was risky or large.

## Recommended Direction For Engineering

- Keep the current navigation-based structure for major engineering areas.
- Use tabs inside pages like `NLD Services`, `Stock Management`, or `SLA Reporting` where the user is staying inside one bounded domain.
- Do not merge all engineering functions into one giant tab screen, because it would make both the code and the data-loading path too heavy.
