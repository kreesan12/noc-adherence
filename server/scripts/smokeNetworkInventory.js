import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import XLSX from 'xlsx'
import { loadServerEnv } from '../lib/loadEnv.js'
import { getJwtSecret } from '../lib/jwtSecret.js'
import { chromium } from '../../frontend/node_modules/playwright-core/index.mjs'

loadServerEnv()
const directory = path.resolve('../.artifacts/network-inventory'); fs.mkdirSync(directory, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true })
// Test-only browser identity against the isolated local module database; not an application login bypass.
const token = jwt.sign({ id: 0, name: 'Local visual smoke test', role: 'admin', kind: 'manager' }, getJwtSecret(), { expiresIn: '15m' })
await context.addInitScript(value => localStorage.setItem('token', value), token)
await context.route('**/api/vacancies*', route => route.fulfill({ json: [] }))
const page = await context.newPage(), errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto('http://127.0.0.1:5177/network-inventory/ladder')
  await page.getByRole('heading', { name: 'Network Inventory', exact: true }).waitFor({ timeout: 30000 })
  await page.locator('svg[aria-label="BFN Ladder 1 inventory ring diagram"]').waitFor()
  await page.locator('svg [aria-label="Inspect bfn-is-mpls-r1"]').waitFor()
  await page.locator('svg [aria-label="Inspect bfn-fprk-mpls-r1"]').waitFor()
  assert.ok((await page.locator('svg.ni-svg').textContent()).includes('SECONDARY BLOCK'))
  await page.screenshot({ path: path.join(directory, 'bfn-ladder-1.png'), fullPage: true })
  await page.getByRole('button', { name: 'Backup scenario', exact: true }).click()
  assert.ok((await page.locator('svg.ni-svg').textContent()).includes('BLOCK RELEASED'))
  await page.screenshot({ path: path.join(directory, 'bfn-backup-scenario.png'), fullPage: true })
  await page.getByRole('button', { name: 'Normal', exact: true }).click()
  await page.locator('svg [aria-label="Inspect bfn-gardenia-me-sw1"]').click()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Device hostname').waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Close inspector' }).click()
  await page.getByRole('tab', { name: 'OLT Audits', exact: true }).click()
  await page.getByLabel('Select OLT').waitFor()
  await page.screenshot({ path: path.join(directory, 'olt-audits.png'), fullPage: true })
  await page.getByRole('tab', { name: 'NLD Audits', exact: true }).click()
  await page.screenshot({ path: path.join(directory, 'nld-audits.png'), fullPage: true })
  await page.getByRole('tab', { name: 'RISE Audits', exact: true }).click()
  await page.getByText('The workbook has no explicit RISE classification.', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Assign inventory to RISE' }).click()
  await page.getByRole('dialog').getByLabel('Choose inventory').waitFor()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.screenshot({ path: path.join(directory, 'rise-audits.png'), fullPage: true })
  await page.getByRole('tab', { name: 'Ladder Audits', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles('C:/Users/Kreesan Govender/Downloads/2. Network Links DB (1).xlsx')
  await page.getByRole('dialog', { name: 'Review workbook import' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  const download = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export Excel', exact: true }).click()]).then(([d]) => d)
  const exportFile = path.join(directory, 'Network_Inventory.xlsx'); await download.saveAs(exportFile)
  assert.ok(XLSX.readFile(exportFile).SheetNames.includes('Inventory records'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(directory, 'mobile.png'), fullPage: true })
  const widths = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: innerWidth }))
  assert.ok(widths.body <= widths.viewport + 2, `Mobile page overflow: ${JSON.stringify(widths)}`)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, screenshots: directory, checked: ['BFN cores and block', 'inspector/editor', 'all four sections', 'RISE assignment dialog', 'import preview', 'Excel export', 'mobile overflow'], pageErrors: errors }))
} catch (error) {
  await page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }); throw error
} finally { await browser.close() }
