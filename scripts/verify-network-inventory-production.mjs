import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chromium } from '../frontend/node_modules/playwright-core/index.mjs'
import { buildTopology, intendedPaths, values } from '../frontend/src/features/networkInventory/domain.js'

const base = 'https://154-65-108-106.sslip.io', directory = path.resolve('.artifacts/network-inventory-production')
fs.mkdirSync(directory, { recursive: true })
const ssh = ['-i', 'C:/Users/Kreesan Govender/Downloads/FF-Platform.pem', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', 'ubuntu@154.65.108.106']
function token(role) {
  return execFileSync('ssh.exe', [...ssh, `cd /home/ubuntu/apps/noc-adherence/server && node scripts/issueSmokeToken.js --role ${role} --name NetworkInventoryReleaseCheck`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
const auth = token('admin'), reader = token('supervisor')
const response = await fetch(base + '/api/network-inventory', { headers: { Authorization: `Bearer ${auth}` } })
assert.equal(response.status, 200)
const snapshot = await response.json()
assert.deepEqual(Object.fromEntries(Object.entries(snapshot.summary).filter(([k]) => ['ladders','nodes','devices','backhauls','olts','upToDate'].includes(k))), { ladders: 48, upToDate: 0, nodes: 543, devices: 1121, backhauls: 415, olts: 355 })
assert.equal((await fetch(base + '/api/network-inventory')).status, 401)
const readerResponse = await fetch(base + '/api/network-inventory', { headers: { Authorization: `Bearer ${reader}` } })
assert.equal(readerResponse.status, 200); assert.equal((await readerResponse.json()).canEdit, false)
assert.equal((await fetch(base + '/api/network-inventory/records/sites', { method: 'POST', headers: { Authorization: `Bearer ${reader}`, 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
const topologyChecks = values(snapshot, 'ladders').map(l => {
  const graph = buildTopology(snapshot, l.id)
  assert.equal(new Set(graph.nodes.map(n => n.id)).size, graph.nodes.length)
  assert.equal(new Set(graph.edges.map(e => e.id)).size, graph.edges.length)
  return { ladder: l.data.name, nodes: graph.nodes.length, edges: graph.edges.length, memberships: graph.members.length, unresolvedNodes: graph.nodes.filter(n => n.unresolved).length }
})
const bfn = buildTopology(snapshot, 'ladders:bfnladder1')
for (const core of ['bfn-is-mpls-r1','bfn-fprk-mpls-r1']) assert.ok(bfn.nodes.some(n => n.label === core))
assert.equal(bfn.edges.find(e => e.code === 'DK2A95').blocked, true)
const paths = intendedPaths(bfn, bfn.members.find(m => m.data.role === 'Master').id)
assert.ok(paths.primary && paths.backup)
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } })
await context.addInitScript(value => localStorage.setItem('token', value), auth)
const page = await context.newPage(), pageErrors = [], apiErrors = []
page.on('pageerror', e => pageErrors.push(e.message))
page.on('response', r => { if (r.url().includes('/api/network-inventory') && r.status() >= 400) apiErrors.push({ url: r.url(), status: r.status() }) })
try {
  await page.goto(base + '/network-inventory/ladder')
  await page.getByRole('heading', { name: 'Network Inventory', exact: true }).waitFor({ timeout: 45000 })
  await page.locator('svg[aria-label="BFN Ladder 1 inventory ring diagram"]').waitFor()
  await page.screenshot({ path: path.join(directory, 'ladder-bfn-production.png'), fullPage: true })
  await page.getByRole('button', { name: 'Backup scenario', exact: true }).click()
  assert.ok((await page.locator('svg.ni-svg').textContent()).includes('BLOCK RELEASED'))
  await page.getByRole('button', { name: 'Normal', exact: true }).click()
  for (const scope of ['OLT', 'NLD', 'RISE']) {
    await page.getByRole('tab', { name: `${scope} Audits`, exact: true }).click()
    await page.waitForTimeout(400)
    if (scope === 'OLT') await page.getByLabel('Select OLT').waitFor()
    if (scope === 'RISE') await page.getByText('The workbook has no explicit RISE classification.', { exact: false }).waitFor()
    await page.screenshot({ path: path.join(directory, `${scope.toLowerCase()}-production.png`), fullPage: true })
  }
  await page.getByRole('tab', { name: 'Ladder Audits', exact: true }).click()
  const select = page.getByLabel('Select ladder or scoped backhaul')
  await select.fill('CPT Ladder 1')
  await page.getByRole('option', { name: 'CPT Ladder 1', exact: true }).click()
  await page.locator('svg[aria-label="CPT Ladder 1 inventory ring diagram"]').waitFor()
  await page.screenshot({ path: path.join(directory, 'ladder-cpt-production.png'), fullPage: true })
  assert.deepEqual(pageErrors, []); assert.deepEqual(apiErrors, [])
  const report = { verifiedAt: new Date().toISOString(), baseUrl: base, summary: snapshot.summary,
    recordCounts: Object.fromEntries(Object.entries(snapshot.records).map(([k,v]) => [k,v.length])), sourceSheets: snapshot.imports[0].counts,
    allLadders: topologyChecks, bfnPrimary: paths.primary, bfnBackup: paths.backup,
    permissions: { unauthenticatedRejected: true, readerCanView: true, readerCannotEdit: true },
    pageErrors, apiErrors, screenshots: directory, productionChecksReadOnly: true }
  fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ verified: true, summary: report.summary, ladderTopologiesChecked: topologyChecks.length, pageErrors, apiErrors, report: path.join(directory, 'verification.json') }))
} catch (e) { await page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }); throw e }
finally { await browser.close() }
