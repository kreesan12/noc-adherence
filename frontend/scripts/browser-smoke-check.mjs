import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { chromium } from 'playwright-core'

const __filename = fileURLToPath(import.meta.url)
const scriptDir = dirname(__filename)
const frontendRoot = resolve(scriptDir, '..')
const repoRoot = resolve(frontendRoot, '..')
const artifactDir = resolve(repoRoot, '.smoke-artifacts')

const args = parseArgs(process.argv.slice(2))
const waitMs = Number(args.waitMs || 5000)
const screenshotPath = resolve(args.screenshot || join(artifactDir, 'smoke-check.png'))
const reportPath = resolve(args.report || join(artifactDir, 'smoke-report.json'))

mkdirSync(artifactDir, { recursive: true })

let previewProc = null

try {
  const previewPort = args.preview ? await findAvailablePort(Number(args.port || 4173)) : Number(args.port || 4173)
  const targetUrl = args.url || `http://127.0.0.1:${previewPort}/`

  if (args.preview) {
    previewProc = startPreview(previewPort)
    await waitForHttp(targetUrl, 45000)
  }

  const executablePath = resolveBrowserPath(args.browserPath || process.env.SMOKE_BROWSER_PATH)
  if (!executablePath) {
    throw new Error('No supported browser executable found. Set SMOKE_BROWSER_PATH to Edge, Chrome, or Chromium.')
  }

  const report = await runBrowserCheck({
    executablePath,
    targetUrl,
    waitMs,
    screenshotPath
  })

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  printSummary(report, screenshotPath, reportPath)

  if (!report.ok) {
    process.exitCode = 1
  }
} finally {
  stopPreview(previewProc)
}

function parseArgs(argv) {
  const parsed = { preview: false }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (token === '--preview') {
      parsed.preview = true
      continue
    }

    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = true
      continue
    }
    parsed[key] = next
    index += 1
  }

  return parsed
}

function startPreview(port) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(npmCmd, ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: frontendRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32'
  })

  child.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`))

  return child
}

function stopPreview(child) {
  if (!child || child.killed) return

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    return
  }

  child.kill('SIGTERM')
}

async function waitForHttp(url, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {}
    await sleep(750)
  }
  throw new Error(`Timed out waiting for preview server at ${url}`)
}

function resolveBrowserPath(preferred) {
  const candidates = []
  if (preferred) candidates.push(preferred)

  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    )
  } else {
    candidates.push(
      '/usr/bin/microsoft-edge',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser'
    )
  }

  return candidates.find((candidate) => candidate && existsSync(candidate))
}

async function runBrowserCheck({ executablePath, targetUrl, waitMs, screenshotPath }) {
  const browser = await chromium.launch({
    headless: true,
    executablePath
  })

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const consoleEntries = []
  const pageErrors = []
  const requestFailures = []
  const responseErrors = []

  page.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text() }
    consoleEntries.push(entry)
  })

  page.on('pageerror', (error) => {
    pageErrors.push(error?.stack || error?.message || String(error))
  })

  page.on('requestfailed', (request) => {
    requestFailures.push({
      url: request.url(),
      errorText: request.failure()?.errorText || 'Unknown request failure'
    })
  })

  page.on('response', (response) => {
    const url = response.url()
    const status = response.status()
    const isCriticalAsset = url.includes('/assets/') || url.includes('/api/')
    if (isCriticalAsset && status >= 400) {
      responseErrors.push({ status, url })
    }
  })

  const initialResponse = await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 })

  try {
    await page.waitForFunction(() => {
      const root = document.getElementById('root')
      return Boolean(root && root.innerHTML.trim().length > 0)
    }, { timeout: waitMs })
  } catch {}

  await page.waitForTimeout(waitMs)

  const title = await page.title()
  const bodyText = await page.locator('body').innerText().catch(() => '')
  const rootHtml = await page.locator('#root').innerHTML().catch(() => '')

  await page.screenshot({ path: screenshotPath, fullPage: true })
  await browser.close()

  const ok = pageErrors.length === 0 &&
    requestFailures.length === 0 &&
    responseErrors.length === 0 &&
    (rootHtml.trim().length > 0 || bodyText.trim().length > 0)

  return {
    ok,
    url: targetUrl,
    title,
    status: initialResponse?.status() ?? null,
    bodyTextLength: bodyText.length,
    rootHtmlLength: rootHtml.length,
    consoleEntries,
    pageErrors,
    requestFailures,
    responseErrors,
    checkedAt: new Date().toISOString()
  }
}

function printSummary(report, screenshotPath, reportPath) {
  console.log(`SMOKE URL: ${report.url}`)
  console.log(`SMOKE STATUS: ${report.status}`)
  console.log(`SMOKE TITLE: ${report.title}`)
  console.log(`SMOKE BODY LENGTH: ${report.bodyTextLength}`)
  console.log(`SMOKE ROOT LENGTH: ${report.rootHtmlLength}`)

  if (report.pageErrors.length) {
    console.log('SMOKE PAGE ERRORS:')
    for (const entry of report.pageErrors) console.log(`- ${entry}`)
  }

  if (report.requestFailures.length) {
    console.log('SMOKE REQUEST FAILURES:')
    for (const entry of report.requestFailures) console.log(`- ${entry.url} :: ${entry.errorText}`)
  }

  if (report.responseErrors.length) {
    console.log('SMOKE RESPONSE ERRORS:')
    for (const entry of report.responseErrors) console.log(`- ${entry.status} :: ${entry.url}`)
  }

  const consoleProblems = report.consoleEntries.filter((entry) => ['error', 'warning'].includes(entry.type))
  if (consoleProblems.length) {
    console.log('SMOKE CONSOLE WARNINGS/ERRORS:')
    for (const entry of consoleProblems) console.log(`- [${entry.type}] ${entry.text}`)
  }

  console.log(`SMOKE SCREENSHOT: ${screenshotPath}`)
  console.log(`SMOKE REPORT: ${reportPath}`)

  if (!report.ok) {
    console.error('Smoke check failed.')
  } else {
    console.log('Smoke check passed.')
  }
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function findAvailablePort(startPort) {
  let port = startPort
  while (!(await isPortFree(port))) {
    port += 1
  }
  return port
}

function isPortFree(port) {
  return new Promise((resolvePromise) => {
    const server = net.createServer()
    server.unref()
    server.on('error', () => resolvePromise(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolvePromise(true))
    })
  })
}
