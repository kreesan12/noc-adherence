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
3. Run the xneelo API deploy helper:
   `ssh -i <pem> ubuntu@154.65.108.106 "bash /home/ubuntu/bin/update-noc-api.sh"`
4. If the release touches WhatsApp watchers, Gmail imports, or any timer-driven automation, also run the automation deploy helper:
   `ssh -i <pem> ubuntu@154.65.102.21 "bash /home/ubuntu/bin/update-noc-automation.sh"`
5. If the release touches the native `NOC Monitoring Hub`, make sure the API host has the optional telephony env vars if you expect queue data to light up.

## Post-Deploy Verification

1. Run the live browser smoke harness:
   `npm --prefix frontend run smoke -- --url https://154-65-108-106.sslip.io/ --waitMs 3000`
2. If the release touched the native monitoring route, run an authenticated smoke against `/noc-monitoring`:
   - issue a short-lived smoke token on the API host:
     `ssh -i <pem> ubuntu@154.65.108.106 "cd /home/ubuntu/apps/noc-adherence/server && node scripts/issueSmokeToken.js --role admin --name 'Release Smoke'"`
   - then use that token locally:
     `npm --prefix frontend run smoke -- --url https://154-65-108-106.sslip.io/ --route /noc-monitoring --authToken <token> --expectText "NOC Monitoring Hub" --waitMs 4000`
3. Confirm the smoke result is a pass.
4. Spot-check:
   - login screen
   - authenticated landing page
   - `/noc-monitoring` and a manual snapshot refresh
   - one heavy reporting page like `SLA Reporting` or `Stock Management`
   - `/settings/whatsapp-watchers` if watcher routing or template changes were included
5. If the smoke report or the browser console shows a new runtime error, treat the deploy as unhealthy even if nginx and the API are up.

## Notes

- The smoke harness uses a local installed Chromium-based browser such as Microsoft Edge.
- If the live site looks blank but `/` still returns `200`, run the smoke harness first before assuming nginx is the problem.
- Keep this file aligned with `docs/BUILD_RULES.md` whenever the deployment path changes.
