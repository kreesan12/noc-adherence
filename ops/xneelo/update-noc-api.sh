#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=/home/ubuntu/apps/noc-adherence
FRONTEND_ROOT="$APP_ROOT/frontend"
SERVER_ROOT="$APP_ROOT/server"
WEB_ROOT=/var/www/noc-adherence/current
SYSTEMD_ROOT="$APP_ROOT/ops/xneelo/systemd"

cd "$APP_ROOT"
git fetch origin main
git reset --hard origin/main

cd "$FRONTEND_ROOT"
npm ci
npm run build
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete dist/ "$WEB_ROOT"/

cd "$SERVER_ROOT"
npm ci
npx prisma generate
npx prisma migrate deploy

sudo install -m 0644 "$SYSTEMD_ROOT/noc-monitoring-warm-cache.service" /etc/systemd/system/noc-monitoring-warm-cache.service
sudo install -m 0644 "$SYSTEMD_ROOT/noc-monitoring-warm-cache.timer" /etc/systemd/system/noc-monitoring-warm-cache.timer
sudo systemctl daemon-reload
sudo systemctl enable --now noc-monitoring-warm-cache.timer

sudo nginx -t
sudo systemctl restart noc-api
sudo systemctl reload nginx
