#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=/home/ubuntu/apps/noc-adherence
FRONTEND_ROOT="$APP_ROOT/frontend"
SERVER_ROOT="$APP_ROOT/server"
WEB_ROOT=/var/www/noc-adherence/current

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

sudo nginx -t
sudo systemctl restart noc-api
sudo systemctl reload nginx
