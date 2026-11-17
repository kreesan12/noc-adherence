// Narrow production release. Preserves unrelated work; no git reset, package install,
// operational migrations, device connections, automation restart or message sending.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = process.cwd(), mode = process.argv[2]
if (!['prepare', 'preflight', 'deploy'].includes(mode)) throw Error('Use prepare, preflight or deploy.')
const release = 'network-inventory-20261117-v1'
const local = path.join(root, '.artifacts', release)
const remote = `/home/ubuntu/deploy-staging/${release}`
const app = '/home/ubuntu/apps/noc-adherence'
const key = 'C:/Users/Kreesan Govender/Downloads/FF-Platform.pem', host = 'ubuntu@154.65.108.106'
const sshArgs = ['-i', key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15']
function run(binary, args, capture = false) {
  const r = spawnSync(binary, args, { cwd: root, encoding: capture ? 'utf8' : undefined, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
  if (r.status !== 0) { if (capture) process.stderr.write(r.stderr || ''); throw Error(`${binary} failed (${r.status}).`) }
  return capture ? r.stdout : null
}
const ssh = command => run('ssh.exe', [...sshArgs, host, command])
const scp = (file, destination) => run('scp.exe', ['-i', key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', file, `${host}:${destination}`])
fs.mkdirSync(local, { recursive: true })
const files = ['frontend/src/App.jsx', 'frontend/src/config/navigation.jsx', 'frontend/src/features/networkInventory', 'frontend/src/pages/NetworkInventoryPage.jsx',
  'server/app.js', 'server/routes/networkInventory.js', 'server/tools/networkInventory', 'server/migrations/network-inventory', 'server/scripts/networkInventory.js', 'docs/network-inventory']
const preflight = `import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const app=${JSON.stringify(app)};
const require=createRequire(app+'/server/package.json');const {Pool}=require('pg');
const {loadServerEnv}=await import(app+'/server/lib/loadEnv.js');loadServerEnv();
const u=new URL(process.env.NETWORK_INVENTORY_DATABASE_URL||process.env.DATABASE_URL);
const p=new Pool({connectionString:u.href,connectionTimeoutMillis:10000});
try{
 const meta=await p.query("SELECT current_database() AS database, to_regnamespace('network_inventory')::text AS schema,has_database_privilege(current_user,current_database(),'CREATE') AS can_create");
 const hashes=Object.fromEntries(['server/app.js','frontend/src/App.jsx','frontend/src/config/navigation.jsx'].map(f=>[f,createHash('sha256').update(fs.readFileSync(app+'/'+f)).digest('hex')]));
 const result={node:process.version,databaseHost:u.hostname,databasePort:u.port,inventoryDatabaseOverride:!!process.env.NETWORK_INVENTORY_DATABASE_URL,...meta.rows[0],hashes};
 if(meta.rows[0].schema){const counts={};for(const k of ['sites','devices','ladders','memberships','backhauls','segments','olts','reviews']){counts[k]=(await p.query('SELECT count(*)::int AS n FROM network_inventory.'+k)).rows[0].n;}result.inventoryCounts=counts;}
 fs.writeFileSync(${JSON.stringify(remote + '/preflight-result.json')},JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await p.end();}
`
if (mode === 'prepare') {
  run('tar.exe', ['-czf', path.join(local, 'feature.tar.gz'), ...files])
  run('tar.exe', ['-czf', path.join(local, 'frontend-dist.tar.gz'), '-C', 'frontend/dist', '.'])
  fs.copyFileSync('C:/Users/Kreesan Govender/Downloads/2. Network Links DB (1).xlsx', path.join(local, 'network-links-source.xlsx'))
  fs.writeFileSync(path.join(local, 'preflight.mjs'), preflight)
  const baseHashes = Object.fromEntries(['server/app.js', 'frontend/src/App.jsx', 'frontend/src/config/navigation.jsx'].map(f => {
    const r = spawnSync('git', ['show', `HEAD:${f}`], { cwd: root }); if (r.status) throw Error('Cannot read base file.')
    return [f, createHash('sha256').update(r.stdout).digest('hex')]
  }))
  fs.writeFileSync(path.join(local, 'manifest.json'), JSON.stringify({ release, app, files, baseHashes, sourceSha256: createHash('sha256').update(fs.readFileSync(path.join(local, 'network-links-source.xlsx'))).digest('hex') }, null, 2))
  console.log(`Prepared release ${release}; no production changes.`)
} else if (mode === 'preflight') {
  ssh(`mkdir -p ${remote}`)
  scp(path.join(local, 'preflight.mjs'), remote + '/preflight.mjs')
  ssh(`cd ${app}/server && node ${remote}/preflight.mjs`)
  run('scp.exe', ['-i', key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', `${host}:${remote}/preflight-result.json`, path.join(local, 'preflight-result.json')])
  const observed = JSON.parse(fs.readFileSync(path.join(local, 'preflight-result.json'))), manifest = JSON.parse(fs.readFileSync(path.join(local, 'manifest.json')))
  for (const [file, hash] of Object.entries(manifest.baseHashes)) if (observed.hashes[file] !== hash) throw Error(`Production file differs from the reviewed base: ${file}. Reconcile before deploying.`)
  if (!observed.can_create && !observed.schema) throw Error('Application database role cannot create the isolated inventory schema.')
  console.log('Preflight passed; production application/data not changed.')
} else {
  const observed = JSON.parse(fs.readFileSync(path.join(local, 'preflight-result.json')))
  if (observed.schema) throw Error('Existing production inventory detected. Review it explicitly before this initial release/import.')
  for (const name of ['feature.tar.gz', 'frontend-dist.tar.gz', 'network-links-source.xlsx']) scp(path.join(local, name), remote + '/' + name)
  const shell = `#!/usr/bin/env bash
set -euo pipefail
APP=${app}
STAGE=${remote}
BACKUP=/home/ubuntu/deploy-backups/${release}
if [ -e "$BACKUP/release-applied" ]; then echo 'Release already applied; verify instead of replaying.'; exit 1; fi
mkdir -p "$BACKUP" "$STAGE/frontend-dist"
tar -czf "$BACKUP/app-before.tar.gz" -C "$APP" server/app.js frontend/src/App.jsx frontend/src/config/navigation.jsx
sudo tar -czf "$BACKUP/frontend-before.tar.gz" -C /var/www/noc-adherence/current .
tar -xzf "$STAGE/feature.tar.gz" -C "$APP"
# Windows tar can record new directories as read-only; keep future git updates writable.
chmod u+w "$APP/docs/network-inventory" "$APP/frontend/src/features/networkInventory" "$APP/server/migrations/network-inventory" "$APP/server/tools/networkInventory"
cd "$APP/server"
node --check app.js
node --check routes/networkInventory.js
node scripts/networkInventory.js setup
node scripts/networkInventory.js import "$STAGE/network-links-source.xlsx"
tar -xzf "$STAGE/frontend-dist.tar.gz" -C "$STAGE/frontend-dist"
sudo nginx -t
sudo systemctl restart noc-api
sudo systemctl is-active --quiet noc-api
# Publish assets first, index last. Retain old hashed assets for existing browser sessions.
sudo rsync -a "$STAGE/frontend-dist/assets/" /var/www/noc-adherence/current/assets/
sudo install -m 0644 "$STAGE/frontend-dist/404.html" /var/www/noc-adherence/current/404.html
sudo install -m 0644 "$STAGE/frontend-dist/index.html" /var/www/noc-adherence/current/.network-inventory-index-next
sudo mv /var/www/noc-adherence/current/.network-inventory-index-next /var/www/noc-adherence/current/index.html
date -u +%FT%TZ > "$BACKUP/release-applied"
echo "Release applied. Backups: $BACKUP"
`
  fs.writeFileSync(path.join(local, 'apply.sh'), shell)
  scp(path.join(local, 'apply.sh'), remote + '/apply.sh')
  ssh(`bash ${remote}/apply.sh`)
}
