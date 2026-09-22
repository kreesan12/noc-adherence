#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=/home/ubuntu/apps/noc-adherence
SYSTEMD_ROOT="$APP_ROOT/ops/xneelo/systemd"

cd "$APP_ROOT"
git fetch origin main
git reset --hard origin/main

cd server
npm ci
npx prisma generate

sudo install -m 0644 "$SYSTEMD_ROOT/noc-ingest-daily-light.service" /etc/systemd/system/noc-ingest-daily-light.service
sudo install -m 0644 "$SYSTEMD_ROOT/noc-ingest-daily-light.timer" /etc/systemd/system/noc-ingest-daily-light.timer
sudo install -m 0644 "$SYSTEMD_ROOT/noc-generate-stock-redistribution.service" /etc/systemd/system/noc-generate-stock-redistribution.service
sudo install -m 0644 "$SYSTEMD_ROOT/noc-generate-stock-redistribution.timer" /etc/systemd/system/noc-generate-stock-redistribution.timer
sudo systemctl daemon-reload
sudo systemctl enable --now noc-ingest-daily-light.timer
sudo systemctl enable --now noc-generate-stock-redistribution.timer
sudo systemctl restart noc-ingest-daily-light.timer
sudo systemctl restart noc-generate-stock-redistribution.timer
sudo systemctl restart noc-automation
