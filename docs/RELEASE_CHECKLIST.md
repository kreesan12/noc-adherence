# Release Checklist

Use this checklist for every frontend or full-stack production release to xneelo.

## Local Verification

1. Install any new frontend dependencies:
   `npm --prefix frontend install`
2. Build the frontend:
   `npm --prefix frontend run build`
3. Run the local browser smoke harness:
   `npm --prefix frontend run smoke:local-build`
4. Review the generated artifacts if the change was risky:
   - `.smoke-artifacts/smoke-report.json`
   - `.smoke-artifacts/smoke-check.png`

## Deployment

1. Commit the changes.
2. Push to `main`.
3. Run the xneelo deploy helper:
   `ssh -i <pem> ubuntu@154.65.108.106 "bash /home/ubuntu/bin/update-noc-api.sh"`

## Post-Deploy Verification

1. Run the live browser smoke harness:
   `npm --prefix frontend run smoke -- --url https://154-65-108-106.sslip.io/ --waitMs 3000`
2. Confirm the smoke result is a pass.
3. Spot-check:
   - login screen
   - authenticated landing page
   - one heavy reporting page like `SLA Reporting` or `Stock Management`
4. If the smoke report or the browser console shows a new runtime error, treat the deploy as unhealthy even if nginx and the API are up.

## Notes

- The smoke harness uses a local installed Chromium-based browser such as Microsoft Edge.
- If the live site looks blank but `/` still returns `200`, run the smoke harness first before assuming nginx is the problem.
- Keep this file aligned with `docs/BUILD_RULES.md` whenever the deployment path changes.
